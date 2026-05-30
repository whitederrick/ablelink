// app/api/admin/docs/sign/route.ts
// 에이전시 관리자가 문서를 검토 후 명시적으로 서명하는 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer, normalizeDocType } from "@/lib/pdf";
import { sendEmailWithPdf } from "@/lib/email";

function fmtHHMM(d: Date) {
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}
function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number | null) {
  return n ? ({ 1: "매우못함", 2: "못함", 3: "보통", 4: "잘함", 5: "매우잘함" } as any)[n] || String(n) : "";
}
const ALLOWED_IMG_HOST = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname; } catch { return ""; }
})();

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

const DOC_LABELS: Record<string, string> = {
  ATTENDANCE_SHEET:      "직무지도원 출근부",
  TRAINING_DAILY_LOG:    "지원고용 훈련일지",
  TRAINEE_FINAL_EVAL:    "지원고용 훈련생 종합 평가기록부",
  ADAPTATION_DAILY_LOG:  "취업 후 적응지도 일지",
  ADAPTATION_FINAL_EVAL: "적응지도 대상자 종합 평가기록부",
};

export async function POST(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const body = await request.json();
    const { workerUserId, docType: rawDocType, periodStart, periodEnd, traineeId, toEmail } = body;

    const docType = normalizeDocType(rawDocType);
    if (!docType || !workerUserId || !periodStart || !periodEnd)
      return NextResponse.json({ success: false, message: "필수 파라미터 누락" }, { status: 400 });

    const userId = BigInt(workerUserId);
    const start = periodStart, end = periodEnd;

    // 서명하는 관리자 본인의 서명 이미지 사용
    const admin = await prisma.manager.findUnique({
      where: { id: scope.managerId },
      select: { signatureUrl: true, displayName: true },
    });
    if (!admin?.signatureUrl)
      return NextResponse.json({ success: false, message: "관리자 서명이 등록되지 않았습니다. 서명 설정에서 먼저 서명을 등록해주세요." }, { status: 400 });

    const user = await prisma.worker.findUnique({
      where: { id: userId },
      select: { userName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] }, agencyId: scope.agencyId },
      include: { site: true },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment?.site)
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });

    const [workerImg, govImg] = await Promise.all([
      toBase64DataUri(user?.signatureUrl),
      toBase64DataUri(admin.signatureUrl),
    ]);

    const sigs = {
      worker:       { name: user?.userName || "",       imageUrl: workerImg },
      govAgent:    { name: admin.displayName || "",    imageUrl: govImg },
      agencyAgent: { name: admin.displayName || "",    imageUrl: govImg },
      companyManager: { name: "", imageUrl: undefined as string | undefined },
    };

    const site = assignment.site;
    let payload: any;
    let fileName: string;

    if (docType === "ATTENDANCE_SHEET") {
      const attendances = await prisma.dailyAttendance.findMany({
        where: { userId, workDate: { gte: start, lte: end } },
        include: { logs: { select: { time1on1: true, timeGroup: true, extTime1on1: true, extTimeGroup: true } } },
        orderBy: { workDate: "asc" },
      });
      const entries = attendances.map(a => ({
        date: a.workDate,
        start: a.startTime ? fmtHHMM(a.startTime) : "",
        end:   a.endTime   ? fmtHHMM(a.endTime)   : "",
        hours:      a.logs.reduce((s, l) => s + Number(l.time1on1) + Number(l.extTime1on1), 0),
        multiHours: a.logs.reduce((s, l) => s + Number(l.timeGroup) + Number(l.extTimeGroup), 0),
      }));
      const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0);
      const oneToMany  = entries.reduce((s, e) => s + Number(e.multiHours), 0);
      payload = {
        workerName: user?.userName || "", workerPhone: user?.phoneNumber || user?.loginId || "",
        companyName: site.companyName, periodStartYMD: fmtDot(start), periodEndYMD: fmtDot(end),
        totalDays: entries.length, totalHours, weeklyHolidayCount: 0, monthlyLeaveCount: 0,
        allowanceTotalWon: "0", oneToOneHours: totalHours - oneToMany, oneToManyHours: oneToMany,
        otOneToOneHours: 0, otOneToManyHours: 0, entries,
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      };
      fileName = `출근부_${site.companyName}_${start}_${end}_서명완료.pdf`;

    } else if (docType === "TRAINING_DAILY_LOG") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where: { id: tid }, select: { name: true } }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where: { writerId: userId, traineeId: tid, trainingType: { in: ["PRE", "FIELD"] }, attendance: { workDate: { gte: start, lte: end } } },
        include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
      }) : [];
      payload = {
        traineeName: trainee?.name || "", companyName: site.companyName,
        periodPreText:   fmtPeriod(assignment.stepStart?.toISOString().slice(0, 10) || start, start),
        periodFieldText: fmtPeriod(start, end),
        rows: logs.map(l => ({
          section: l.trainingType === "PRE" ? "PRE" : "FIELD",
          date: l.attendance.workDate, attendanceStatus: l.evaluation || "출석",
          trainingTime: `${Number(l.totalRecognizedTime)}H`, guidanceFlag: "Y",
          task: l.tasks[0]?.taskName || "", taskLevelMeasured: scoreLabel(l.tasks[0]?.performanceScore),
          evalGuidance: l.content || "",
        })),
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      };
      fileName = `훈련일지_${trainee?.name || "훈련생"}_${start}_${end}_서명완료.pdf`;

    } else if (docType === "TRAINEE_FINAL_EVAL") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where: { id: tid }, select: { name: true } }) : null;
      const ev = tid ? await prisma.traineeEvaluation.findFirst({
        where: { traineeId: tid, writerId: userId, evalType: "TRAINING" }, orderBy: { updatedAt: "desc" },
      }) : null;
      payload = {
        traineeName: trainee?.name || "", companyName: site.companyName,
        preTrainingStart:  assignment.stepStart?.toISOString().slice(0, 10) || start,
        preTrainingEnd:    start, fieldTrainingStart: start, fieldTrainingEnd: end,
        scores: (ev?.scores as any) || {}, comments: (ev?.comments as any) || {},
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      };
      fileName = `훈련생평가_${trainee?.name || "훈련생"}_${start}_${end}_서명완료.pdf`;

    } else if (docType === "ADAPTATION_DAILY_LOG") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where: { id: tid }, select: { name: true } }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where: { writerId: userId, traineeId: tid, trainingType: "ADAPTATION", attendance: { workDate: { gte: start, lte: end } } },
        include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
      }) : [];
      payload = {
        traineeName: trainee?.name || "", companyName: site.companyName, periodStart: start, periodEnd: end,
        entries: logs.map(l => ({
          dateISO: l.attendance.workDate, attendance: l.evaluation || "출석",
          workTime: "", guidance: "Y", task: l.tasks[0]?.taskName || "",
          performanceLabel: scoreLabel(l.tasks[0]?.performanceScore), performanceTime: "", coaching: l.content || "",
        })),
        signatures: { worker: sigs.worker, govAgent: sigs.govAgent },
      };
      fileName = `적응지도일지_${trainee?.name || "훈련생"}_${start}_${end}_서명완료.pdf`;

    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where: { id: tid }, select: { name: true } }) : null;
      const ev = tid ? await prisma.traineeEvaluation.findFirst({
        where: { traineeId: tid, writerId: userId, evalType: "ADAPTATION" }, orderBy: { updatedAt: "desc" },
      }) : null;
      payload = {
        traineeName: trainee?.name || "", companyName: site.companyName, periodStart: start, periodEnd: end,
        scores: (ev?.scores as any) || {}, comments: (ev?.comments as any) || {},
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      };
      fileName = `적응지도평가_${trainee?.name || "훈련생"}_${start}_${end}_서명완료.pdf`;

    } else {
      return NextResponse.json({ success: false, message: "지원하지 않는 문서 종류" }, { status: 400 });
    }

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    let emailSent = false;
    if (toEmail) {
      await sendEmailWithPdf({
        from: process.env.EMAIL_FROM || "AbleLink <noreply@able-link.co.kr>",
        to: toEmail,
        subject: `[AbleLink] ${DOC_LABELS[docType] || docType} - ${site.companyName} (${start} ~ ${end}) [서명완료]`,
        body: `안녕하세요.\n\n${site.companyName} 직무지도 ${DOC_LABELS[docType] || docType}를 첨부합니다.\n\n■ 직무지도원: ${user?.userName || ""}\n■ 기간: ${start} ~ ${end}\n■ 서명: ${admin.displayName || "에이전시 담당자"}\n\n감사합니다.\nAbleLink`,
        pdfBuffer,
        fileName,
      });
      emailSent = true;
    }

    return NextResponse.json({
      success: true,
      fileName,
      emailSent,
      pdfBase64: pdfBuffer.toString("base64"),
      message: emailSent ? `${toEmail}로 서명 완료 문서를 발송했습니다.` : "서명이 완료된 PDF가 생성되었습니다.",
    });

  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/sign]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
