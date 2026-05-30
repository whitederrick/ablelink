// app/api/worker/docs/generate/route.ts
// PDF 생성 + AWS SES 이메일 발송 (PREMIUM 전용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer } from "@/lib/pdf";
import { sendEmailWithPdf } from "@/lib/email";

// ── 유틸 ──────────────────────────────────────────────────────
function fmtHHMM(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2,"0")}:${String(kst.getUTCMinutes()).padStart(2,"0")}`;
}
function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number | null): string {
  if (!n) return "";
  return ({ 1:"매우못함", 2:"못함", 3:"보통", 4:"잘함", 5:"매우잘함" } as any)[n] || String(n);
}

const DOC_LABELS: Record<string, string> = {
  "ATTENDANCE_SHEET":      "직무지도원 출근부",
  "TRAINING_DAILY_LOG":    "지원고용 훈련일지",
  "TRAINEE_FINAL_EVAL":    "지원고용 훈련생 종합 평가기록부",
  "ADAPTATION_DAILY_LOG":  "취업 후 적응지도 일지",
  "ADAPTATION_FINAL_EVAL": "적응지도 대상자 종합 평가기록부",
};

const ALLOWED_IMG_HOST = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname; } catch { return ""; }
})();

// ── 서명 이미지 URL → base64 변환 ────────────────────────────
async function toBase64DataUri(url?: string | null): Promise<string | undefined> {
  if (!url || !url.startsWith("http")) return url || undefined;
  try {
    const host = new URL(url).hostname;
    if (ALLOWED_IMG_HOST && host !== ALLOWED_IMG_HOST) return undefined;
  } catch { return undefined; }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    const mime = res.headers.get("content-type") || "image/png";
    if (!mime.startsWith("image/")) return undefined;
    return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch { return undefined; }
}

// ── 메인 핸들러 ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const userId = BigInt(session.userId);
    const planCheck = await checkPlanAccess(userId, "PDF_GENERATE");
    if (!planCheck.allowed) return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });

    const body = await request.json();
    const { docType, periodStart, periodEnd, sendEmail, toEmail, traineeId, companyManagerSignToken } = body;

    if (!docType) return NextResponse.json({ success: false, message: "문서 종류를 선택해주세요." }, { status: 400 });

    // ── 기본 데이터 조회 ────────────────────────────────────
    const user = await prisma.worker.findUnique({
      where: { id: userId },
      select: { userName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });

    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] } },
      include: { site: true },
      orderBy: { assignedAt: "desc" },
    });

    if (!assignment?.site) return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 400 });

    const site = assignment.site;
    const start = periodStart || new Date().toISOString().slice(0,10);
    const end   = periodEnd   || new Date().toISOString().slice(0,10);

    // ── 사업체담당자 즉석 서명 확인 ────────────────────────
    let companyManagerSignatureUrl: string | null = null;
    let companyManagerSignerName = "";
    if (companyManagerSignToken) {
      const tokenRec = await prisma.siteSignToken.findUnique({
        where: { token: companyManagerSignToken },
        select: { signatureUrl: true, usedAt: true, signRole: true, signerName: true },
      });
      if (tokenRec?.usedAt && tokenRec.signRole === "company_manager") {
        companyManagerSignatureUrl = tokenRec.signatureUrl;
        companyManagerSignerName   = tokenRec.signerName || "";
      }
    }

    // 명시적 토큰 없을 때 같은 기간의 최근 서명 자동 조회
    if (!companyManagerSignatureUrl) {
      const recentToken = await prisma.siteSignToken.findFirst({
        where: {
          assignmentId: assignment.id,
          periodStart:  start,
          periodEnd:    end,
          signRole:     "company_manager",
          usedAt:       { not: null },
        },
        orderBy: { usedAt: "desc" },
      });
      if (recentToken) {
        companyManagerSignatureUrl = recentToken.signatureUrl;
        companyManagerSignerName   = recentToken.signerName || "";
      }
    }

    // 에이전시 관리자 서명은 관리자가 명시적으로 서명 후 첨부 — 여기서는 자동 삽입 안 함
    const [workerImg, companyImg] = await Promise.all([
      toBase64DataUri(user?.signatureUrl),
      toBase64DataUri(companyManagerSignatureUrl),
    ]);

    const sigs = {
      worker:          { name: user?.userName || "",        imageUrl: workerImg },
      govAgent:       { name: "",                          imageUrl: undefined as string | undefined },
      companyManager: { name: companyManagerSignerName,    imageUrl: companyImg },
      agencyAgent:    { name: "",                          imageUrl: undefined as string | undefined },
    };

    // ── 문서별 payload 빌드 ──────────────────────────────────
    let payload: any;
    let fileName: string;

    if (docType === "ATTENDANCE_SHEET") {
      const attendances = await prisma.dailyAttendance.findMany({
        where: { userId, workDate: { gte: start, lte: end } },
        include: { logs: { select: { time1on1:true, timeGroup:true, extTime1on1:true, extTimeGroup:true } } },
        orderBy: { workDate: "asc" },
      });

      const entries = attendances.map(a => ({
        date: a.workDate,
        start: a.startTime ? fmtHHMM(a.startTime) : "",
        end:   a.endTime   ? fmtHHMM(a.endTime)   : "",
        hours: a.logs.reduce((s,l) => s + Number(l.time1on1) + Number(l.extTime1on1), 0),
        multiHours: a.logs.reduce((s,l) => s + Number(l.timeGroup) + Number(l.extTimeGroup), 0),
      }));

      const totalHours = entries.reduce((s,e) => s + Number(e.hours), 0);
      const oneToMany  = entries.reduce((s,e) => s + Number(e.multiHours), 0);

      payload = {
        workerName: user?.userName || "",
        workerPhone: user?.phoneNumber || user?.loginId || "",
        companyName: site.companyName,
        periodStartYMD: fmtDot(start),
        periodEndYMD:   fmtDot(end),
        totalDays: entries.length,
        totalHours,
        weeklyHolidayCount: 0,
        monthlyLeaveCount: 0,
        allowanceTotalWon: "0",
        oneToOneHours: totalHours - oneToMany,
        oneToManyHours: oneToMany,
        otOneToOneHours: 0,
        otOneToManyHours: 0,
        entries,
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      };
      fileName = `출근부_${site.companyName}_${start}_${end}.pdf`;

    } else if (docType === "TRAINING_DAILY_LOG") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });

      const trainee = await prisma.trainee.findUnique({ where: { id: BigInt(traineeId) }, select: { name: true } });
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: userId, traineeId: BigInt(traineeId),
          trainingType: { in: ["PRE","FIELD"] },
          attendance: { workDate: { gte: start, lte: end } },
        },
        include: { attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });

      payload = {
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodPreText:   fmtPeriod(assignment.stepStart?.toISOString().slice(0,10) || start, start),
        periodFieldText: fmtPeriod(start, end),
        rows: logs.map(l => ({
          section: l.trainingType === "PRE" ? "PRE" : "FIELD",
          date: l.attendance.workDate,
          attendanceStatus: l.evaluation || "출석",
          trainingTime: `${Number(l.totalRecognizedTime)}H`,
          guidanceFlag: "Y",
          task: l.tasks[0]?.taskName || "",
          taskLevelMeasured: scoreLabel(l.tasks[0]?.performanceScore as any),
          evalGuidance: l.content || "",
        })),
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      };
      fileName = `훈련일지_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else if (docType === "TRAINEE_FINAL_EVAL") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await prisma.trainee.findUnique({ where: { id: BigInt(traineeId) }, select: { name: true } });
      const ev = await prisma.traineeEvaluation.findFirst({
        where: { traineeId: BigInt(traineeId), writerId: userId, evalType: "TRAINING" },
        orderBy: { updatedAt: "desc" },
      });
      if (!ev) return NextResponse.json({ success: false, message: "종합평가를 먼저 작성해주세요." }, { status: 400 });
      if (!ev.isConfirmed) return NextResponse.json({ success: false, message: "종합평가를 최종 확정한 후 PDF를 생성할 수 있습니다.\n평가 페이지에서 '최종 확정' 버튼을 눌러주세요.", evalNotConfirmed: true }, { status: 400 });

      payload = {
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        preTrainingStart:  assignment.stepStart?.toISOString().slice(0,10) || start,
        preTrainingEnd:    start,
        fieldTrainingStart: start,
        fieldTrainingEnd:   end,
        scores:   (ev?.scores as any)   || {},
        comments: (ev?.comments as any) || {},
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      };
      fileName = `훈련생평가_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else if (docType === "ADAPTATION_DAILY_LOG") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await prisma.trainee.findUnique({ where: { id: BigInt(traineeId) }, select: { name: true } });
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: userId, traineeId: BigInt(traineeId),
          trainingType: "ADAPTATION",
          attendance: { workDate: { gte: start, lte: end } },
        },
        include: { attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });

      payload = {
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodStart: start,
        periodEnd:   end,
        entries: logs.map(l => ({
          dateISO: l.attendance.workDate,
          attendance: l.evaluation || "출석",
          workTime: l.attendance.startTime ? `${fmtHHMM(l.attendance.startTime)}~${fmtHHMM(l.attendance.endTime!)}` : "",
          guidance: "Y",
          task: l.tasks[0]?.taskName || "",
          performanceLabel: scoreLabel(l.tasks[0]?.performanceScore as any),
          performanceTime: "",
          coaching: l.content || "",
        })),
        signatures: { worker: sigs.worker, govAgent: sigs.govAgent },
      };
      fileName = `적응지도일지_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await prisma.trainee.findUnique({ where: { id: BigInt(traineeId) }, select: { name: true } });
      const ev = await prisma.traineeEvaluation.findFirst({
        where: { traineeId: BigInt(traineeId), writerId: userId, evalType: "ADAPTATION" },
        orderBy: { updatedAt: "desc" },
      });
      if (!ev) return NextResponse.json({ success: false, message: "종합평가를 먼저 작성해주세요." }, { status: 400 });
      if (!ev.isConfirmed) return NextResponse.json({ success: false, message: "종합평가를 최종 확정한 후 PDF를 생성할 수 있습니다.\n평가 페이지에서 '최종 확정' 버튼을 눌러주세요.", evalNotConfirmed: true }, { status: 400 });

      payload = {
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodStart: start,
        periodEnd:   end,
        scores:   (ev?.scores as any)   || {},
        comments: (ev?.comments as any) || {},
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      };
      fileName = `적응지도평가_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else {
      return NextResponse.json({ success: false, message: `지원하지 않는 문서: ${docType}` }, { status: 400 });
    }

    // ── PDF 생성 ──────────────────────────────────────────
    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    // ── 이메일 발송 ───────────────────────────────────────
    let emailSent = false;
    let emailError: string | undefined;
    if (sendEmail && toEmail) {
      try {
        await sendEmailWithPdf({
          from: process.env.EMAIL_FROM || "AbleLink <noreply@able-link.co.kr>",
          to: toEmail,
          subject: `[AbleLink] ${DOC_LABELS[docType] || docType} - ${site.companyName} (${start} ~ ${end})`,
          body: `안녕하세요.\n\n${site.companyName} 직무지도 ${DOC_LABELS[docType]||docType}를 첨부합니다.\n\n■ 직무지도원: ${user?.userName||""}\n■ 기간: ${start} ~ ${end}\n\n감사합니다.\nAbleLink`,
          pdfBuffer,
          fileName,
        });
        emailSent = true;
      } catch (err: any) {
        console.error("[docs/generate] 이메일 발송 실패:", err?.message ?? err);
        emailError = "이메일 발송에 실패했습니다. PDF는 정상 생성되었습니다.";
      }
    }

    return NextResponse.json({
      success: true,
      fileName,
      emailSent,
      pdfBase64: pdfBuffer.toString("base64"),
      message: emailSent ? `${toEmail}로 발송되었습니다.` : (emailError ?? "PDF가 생성되었습니다."),
    });

  } catch (error: any) {
    console.error("[docs/generate]", error);
    return NextResponse.json({ success: false, message: error.message || "PDF 생성 오류" }, { status: 500 });
  }
}
