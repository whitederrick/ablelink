// app/api/worker/docs/generate/route.ts
// PDF 생성 + Resend 이메일 발송 (PREMIUM 전용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer } from "@/lib/pdf";
import { buildDocFileName } from "@/lib/pdf/filename";
import { sendEmailWithPdf } from "@/lib/email";
import { getKrHolidayDates } from "@/lib/krHolidays";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import { imageToDataUri } from "@/lib/signatureImage";

// ── 유틸 ──────────────────────────────────────────────────────
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

// ── 메인 핸들러 ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const workerId = BigInt(session.workerId);
    const planCheck = await checkPlanAccess(workerId, "PDF_GENERATE");
    if (!planCheck.allowed) return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });

    const body = await request.json();
    const { docType, periodStart, periodEnd, sendEmail, toEmail, traineeId, companyManagerSignToken } = body;

    if (!docType) return NextResponse.json({ success: false, message: "문서 종류를 선택해주세요." }, { status: 400 });

    // ── 기본 데이터 조회 ────────────────────────────────────
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });

    const assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] } },
      include: { site: true },
      orderBy: { assignedAt: "desc" },
    });

    if (!assignment?.site) return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 400 });

    const site = assignment.site;
    const start = periodStart || new Date().toISOString().slice(0,10);
    const end   = periodEnd   || new Date().toISOString().slice(0,10);

    // 일지 PDF용 근무형태 고정 시간값(훈련시간/측정시간/근무시간/Y·N) — 단일 출처
    const docTimes = dailyDocTimes(
      (assignment as any).workType,
      (assignment as any).commuteGuidanceIncluded,
      (assignment as any).customWorkStart,
      (assignment as any).customWorkEnd,
    );

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

    // 위탁기관 관리자 서명은 관리자가 명시적으로 서명 후 첨부 — 여기서는 자동 삽입 안 함
    const [workerImg, companyImg] = await Promise.all([
      imageToDataUri(user?.signatureUrl),
      imageToDataUri(companyManagerSignatureUrl),
    ]);

    const sigs = {
      worker:          { name: user?.workerName || "",        imageUrl: workerImg },
      govAgent:       { name: "",                          imageUrl: undefined as string | undefined },
      companyManager: { name: companyManagerSignerName,    imageUrl: companyImg },
      agencyAgent:    { name: "",                          imageUrl: undefined as string | undefined },
    };

    // ── 문서별 payload 빌드 ──────────────────────────────────
    let payload: any;
    let fileName: string;

    if (docType === "ATTENDANCE_SHEET") {
      ({ payload, fileName } = await buildAttendanceSheetPayload({
        workerId,
        start, end,
        siteId: site.id,
        companyName: site.companyName,
        workerName: user?.workerName || "",
        workerPhone: user?.phoneNumber || user?.loginId || "",
        fallbackAssignment: {
          workType: (assignment as any).workType ?? null,
          commuteGuidanceIncluded: (assignment as any).commuteGuidanceIncluded ?? null,
          customWorkStart: (assignment as any).customWorkStart ?? null,
          customWorkEnd: (assignment as any).customWorkEnd ?? null,
          attendanceButtonExempt: (assignment as any).attendanceButtonExempt ?? null,
        },
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      }));

    } else if (docType === "TRAINING_DAILY_LOG") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });

      const trainee = await prisma.trainee.findFirst({ where: { id: BigInt(traineeId), site: { agencyId: assignment.agencyId } }, select: { name: true } }); // IDOR 방지: 배정 기관 소속 훈련생만
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: workerId, traineeId: BigInt(traineeId),
          trainingType: { in: ["PRE","FIELD"] },
          attendance: { workDate: { gte: start, lte: end } },
        },
        include: { attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });

      // 자동 생성 행에서 제외할 휴무일 = 한국 공휴일 + 현장 커스텀 휴무(근무 미인정)
      const preStart = assignment.stepStart?.toISOString().slice(0, 10) || start;
      const siteHols = await prisma.siteHoliday.findMany({
        where: { assignmentId: assignment.id, countAsWorkday: false },
        select: { date: true },
      });
      const holidays = [...new Set([...getKrHolidayDates(preStart, end), ...siteHols.map(h => h.date)])];

      payload = {
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodPreText:   fmtPeriod(assignment.stepStart?.toISOString().slice(0,10) || start, start),
        periodFieldText: fmtPeriod(start, end),
        holidays,
        rows: logs.map(l => {
          const scoreText = scoreLabel(l.tasks[0]?.performanceScore as any);
          return {
            section: l.trainingType === "PRE" ? "PRE" : "FIELD",
            date: l.attendance.workDate,
            attendanceStatus: l.evaluation || "출석",        // 일지 출결 반영
            trainingTime: docTimes.trainingTimeH,            // 근무형태 고정(4H/8H)
            guidanceFlag: docTimes.guidanceYN,               // 출퇴근·휴게 지도 Y/N
            task: l.tasks[0]?.taskName || "",
            // 수행정도 = 점수 텍스트만 + 아래 측정시간(근무형태 고정)
            taskLevelMeasured: `${scoreText}\n(${docTimes.measTimeH})`,
            evalGuidance: l.content || "",                   // 평가·지도사항 = 일지 내용
          };
        }),
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      };
      fileName = buildDocFileName("TRAINING_DAILY_LOG", { traineeName: trainee?.name, companyName: site.companyName, start, end });

    } else if (docType === "TRAINEE_FINAL_EVAL") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await prisma.trainee.findFirst({ where: { id: BigInt(traineeId), site: { agencyId: assignment.agencyId } }, select: { name: true } }); // IDOR 방지: 배정 기관 소속 훈련생만
      const ev = await prisma.traineeEvaluation.findFirst({
        where: { traineeId: BigInt(traineeId), writerId: workerId, evalType: "TRAINING" },
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
      fileName = buildDocFileName("TRAINEE_FINAL_EVAL", { traineeName: trainee?.name, companyName: site.companyName, start, end });

    } else if (docType === "ADAPTATION_DAILY_LOG") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await prisma.trainee.findFirst({ where: { id: BigInt(traineeId), site: { agencyId: assignment.agencyId } }, select: { name: true } }); // IDOR 방지: 배정 기관 소속 훈련생만
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: workerId, traineeId: BigInt(traineeId),
          trainingType: "ADAPTATION",
          attendance: { workDate: { gte: start, lte: end } },
        },
        include: { attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });

      // 자동 생성 행에서 제외할 휴무일 = 한국 공휴일 + 현장 커스텀 휴무(근무 미인정)
      const siteHols = await prisma.siteHoliday.findMany({
        where: { assignmentId: assignment.id, countAsWorkday: false },
        select: { date: true },
      });
      const holidays = [...new Set([...getKrHolidayDates(start, end), ...siteHols.map(h => h.date)])];

      payload = {
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodStart: start,
        periodEnd:   end,
        holidays,
        entries: logs.map(l => ({
          dateISO: l.attendance.workDate,
          attendance: l.evaluation || "출석",              // 일지 출결 반영
          workTime: docTimes.workTimeRange,                 // 근무형태 고정 범위(08:30~13:30 등)
          guidance: docTimes.guidanceYN,                    // 출퇴근·휴게 지도 Y/N
          task: l.tasks[0]?.taskName || "",
          performanceLabel: scoreLabel(l.tasks[0]?.performanceScore as any),  // 점수 텍스트만
          performanceTime: docTimes.measTimeH,              // 측정시간(근무형태 고정)
          coaching: l.content || "",                        // 지도사항 = 일지 내용
        })),
        signatures: { worker: sigs.worker, govAgent: sigs.govAgent },
      };
      fileName = buildDocFileName("ADAPTATION_DAILY_LOG", { traineeName: trainee?.name, companyName: site.companyName, start, end });

    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      if (!traineeId) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
      const trainee = await prisma.trainee.findFirst({ where: { id: BigInt(traineeId), site: { agencyId: assignment.agencyId } }, select: { name: true } }); // IDOR 방지: 배정 기관 소속 훈련생만
      const ev = await prisma.traineeEvaluation.findFirst({
        where: { traineeId: BigInt(traineeId), writerId: workerId, evalType: "ADAPTATION" },
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
      fileName = buildDocFileName("ADAPTATION_FINAL_EVAL", { traineeName: trainee?.name, companyName: site.companyName, start, end });

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
          from: process.env.EMAIL_FROM || "Able-Link <noreply@able-link.co.kr>",
          to: toEmail,
          subject: `[Able-Link] ${DOC_LABELS[docType] || docType} - ${site.companyName} (${start} ~ ${end})`,
          body: `안녕하세요.\n\n${site.companyName} 직무지도 ${DOC_LABELS[docType]||docType}를 첨부합니다.\n\n■ 직무지도원: ${user?.workerName||""}\n■ 기간: ${start} ~ ${end}\n\n감사합니다.\nAble-Link`,
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
