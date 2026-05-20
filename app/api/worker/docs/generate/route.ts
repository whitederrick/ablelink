// app/api/worker/docs/generate/route.ts
// PDF 생성 + AWS SES 자동 이메일 발송 (PREMIUM 전용)
// ⚠️ jsreport 템플릿은 수정하지 않음 — 데이터만 정확히 구성해서 전달

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";
import {
  generatePdf, sendEmailWithPdf, DOC_LABELS,
  buildAttendanceSheetData, buildTrainingDailyLogData,
  buildTraineeFinalEvalData, buildAdaptationDailyLogData,
  buildAdaptationFinalEvalData,
  type DocType, type SignatureSet,
} from "@/lib/pdfGenerator";

function fmtHHMM(d: Date): string {
  const kst = new Date(d.getTime() + 9*60*60*1000);
  return `${String(kst.getUTCHours()).padStart(2,"0")}:${String(kst.getUTCMinutes()).padStart(2,"0")}`;
}
function fmtYMDDot(s: string): string { return s.replace(/-/g,"."); }
function fmtPeriod(s: string, e: string): string { return `${fmtYMDDot(s)} ~ ${fmtYMDDot(e)}`; }

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const userId = BigInt(session.userId);

    const planCheck = await checkPlanAccess(userId, "PDF_GENERATE");
    if (!planCheck.allowed) return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });

    const body = await request.json();
    const { docType, periodStart, periodEnd, sendEmail, toEmail,
            traineeId, companyManagerSignToken } = body;

    if (!docType) return NextResponse.json({ success: false, message: "문서 종류를 선택해주세요." }, { status: 400 });

    // ── 기본 데이터 조회 ────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });

    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] } },
      include: {
        site: true,
        assignedByAdmin: { select: { signatureUrl: true, displayName: true } },
      },
      orderBy: { assignedAt: "desc" },
    });

    if (!assignment?.site) return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 400 });

    const site = assignment.site;
    const start = periodStart || new Date().toISOString().slice(0,10);
    const end   = periodEnd   || new Date().toISOString().slice(0,10);
    const docLabel = DOC_LABELS[docType as DocType] || docType;

    // ── 서명 조합 ────────────────────────────────────────
    // 사업체담당자 즉석 서명 토큰 확인
    let companyManagerSignatureUrl: string | null = null;
    if (companyManagerSignToken) {
      const tokenRec = await (prisma as any).siteSignToken.findUnique({
        where: { token: companyManagerSignToken },
        select: { signatureUrl: true, usedAt: true, signRole: true },
      });
      if (tokenRec?.usedAt && tokenRec.signRole === "company_manager") {
        companyManagerSignatureUrl = tokenRec.signatureUrl;
      }
    }

    // govAgent: assignedByAdmin 우선, 없으면 같은 agency의 관리자 조회
    let adminForSign = assignment.assignedByAdmin as any;
    if (!adminForSign && assignment.agencyId) {
      adminForSign = await prisma.adminUser.findFirst({
        where: { agencyId: assignment.agencyId, isActive: true },
        select: { signatureUrl: true, displayName: true } as any,
        orderBy: { id: "asc" },
      });
    }

    const signatures: SignatureSet = {
      coachImageUrl:          user?.signatureUrl        || null,
      coachName:              user?.userName            || "",
      govAgentImageUrl:       adminForSign?.signatureUrl || null,
      govAgentName:           adminForSign?.displayName  || "",
      companyManagerImageUrl: companyManagerSignatureUrl,
      companyManagerName:     companyManagerSignerName   || "",
      agencyAgentImageUrl:    adminForSign?.signatureUrl || null,
      agencyAgentName:        adminForSign?.displayName  || "",
    };

    // ── 문서별 데이터 빌드 & PDF 생성 ────────────────────
    let pdfData: Record<string, any>;
    let fileName: string;

    if (docType === "attendance-sheet") {
      const attendances = await prisma.dailyAttendance.findMany({
        where: { userId, workDate: { gte: start, lte: end } },
        include: { logs: { select: { time1on1:true, timeGroup:true, extTime1on1:true, extTimeGroup:true } } },
        orderBy: { workDate: "asc" },
      });

      pdfData = buildAttendanceSheetData({
        coachName: user?.userName || "",
        coachPhone: user?.phoneNumber || user?.loginId || "",
        companyName: site.companyName,
        periodStart: start, periodEnd: end,
        attendances: attendances.map(a => ({
          workDate: a.workDate,
          startTime: a.startTime ? fmtHHMM(a.startTime) : null,
          endTime:   a.endTime   ? fmtHHMM(a.endTime)   : null,
          time1on1:    a.logs.reduce((s,l) => s+Number(l.time1on1),    0),
          timeGroup:   a.logs.reduce((s,l) => s+Number(l.timeGroup),   0),
          extTime1on1: a.logs.reduce((s,l) => s+Number(l.extTime1on1), 0),
          extTimeGroup:a.logs.reduce((s,l) => s+Number(l.extTimeGroup),0),
        })),
        signatures,
      });
      fileName = `출근부_${site.companyName}_${start}_${end}.pdf`;

    } else if (docType === "training-daily-log") {
      if (!traineeId) return NextResponse.json({ success: false, message: "traineeId 필요" }, { status: 400 });

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

      pdfData = buildTrainingDailyLogData({
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        preTrainingPeriod:   fmtPeriod(assignment.stepStart?.toISOString().slice(0,10) || start, start),
        fieldTrainingPeriod: fmtPeriod(start, end),
        entries: logs.map(l => ({
          trainingType: l.trainingType as "PRE"|"FIELD",
          date: l.attendance.workDate,
          attendance: l.evaluation || "출석",
          hours: `${Number(l.totalRecognizedTime)}H`,
          guidance: "Y",
          task: l.tasks[0]?.taskName || "",
          performanceLabel: scoreLabel(l.tasks[0]?.performanceScore),
          performanceTime: "",
          coaching: l.content || "",
        })),
        signatures,
      });
      fileName = `훈련일지_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else if (docType === "trainee-final-eval") {
      if (!traineeId) return NextResponse.json({ success: false, message: "traineeId 필요" }, { status: 400 });
      const trainee = await prisma.trainee.findUnique({ where: { id: BigInt(traineeId) }, select: { name: true } });

      pdfData = buildTraineeFinalEvalData({
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        prePeriod:    fmtPeriod(assignment.stepStart?.toISOString().slice(0,10) || start, start),
        fieldPeriod:  fmtPeriod(start, end),
        scores: {
          WORK_ATTITUDE:    defaultScores(),
          INTERPERSONAL:    defaultScores(),
          WORK_STYLE:       defaultScores(),
          WORK_PERFORMANCE: defaultScores(),
        },
        comments: {},
        signatures,
      });
      fileName = `훈련생평가_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else if (docType === "adaptation-daily-log") {
      if (!traineeId) return NextResponse.json({ success: false, message: "traineeId 필요" }, { status: 400 });
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

      pdfData = buildAdaptationDailyLogData({
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodStart: start, periodEnd: end,
        entries: logs.map(l => ({
          date: l.attendance.workDate,
          attendance: l.evaluation || "출석",
          workTime: "",
          guidance: "Y",
          task: l.tasks[0]?.taskName || "",
          performanceLabel: scoreLabel(l.tasks[0]?.performanceScore),
          performanceTime: "",
          coaching: l.content || "",
        })),
        signatures,
      });
      fileName = `적응지도일지_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else if (docType === "adaptation-final-eval") {
      if (!traineeId) return NextResponse.json({ success: false, message: "traineeId 필요" }, { status: 400 });
      const trainee = await prisma.trainee.findUnique({ where: { id: BigInt(traineeId) }, select: { name: true } });

      pdfData = buildAdaptationFinalEvalData({
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodStart: start, periodEnd: end,
        scores: {
          WORK_ATTITUDE:    defaultScores(),
          INTERPERSONAL:    defaultScores(),
          WORK_STYLE:       defaultScores(),
          WORK_PERFORMANCE: defaultScores(),
        },
        comments: {},
        signatures,
      });
      fileName = `적응지도평가_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else {
      return NextResponse.json({ success: false, message: `지원하지 않는 문서: ${docType}` }, { status: 400 });
    }

    // ── PDF 생성 ──────────────────────────────────────────
    const pdfBuffer = await generatePdf(docType as DocType, pdfData);

    // ── 이메일 발송 ───────────────────────────────────────
    let emailSent = false;
    if (sendEmail && toEmail) {
      await sendEmailWithPdf({
        from: process.env.EMAIL_FROM || "AbleLink <noreply@able-link.co.kr>",
        to: toEmail,
        subject: `[AbleLink] ${docLabel} 제출 - ${site.companyName} (${start} ~ ${end})`,
        body: `안녕하세요.\n\n${site.companyName} 직무지도 ${docLabel}를 첨부합니다.\n\n■ 직무지도원: ${user?.userName||""}\n■ 기간: ${start} ~ ${end}\n\n감사합니다.\nAbleLink`,
        pdfBuffer, fileName,
      });
      emailSent = true;
    }

    return NextResponse.json({
      success: true, fileName, emailSent,
      pdfBase64: pdfBuffer.toString("base64"),
      message: emailSent ? `${toEmail}로 발송되었습니다.` : "PDF가 생성되었습니다.",
    });

  } catch (error: any) {
    console.error("[docs/generate]", error);
    return NextResponse.json({ success: false, message: error.message || "PDF 생성 오류" }, { status: 500 });
  }
}

function scoreLabel(score?: number | null): string {
  if (!score) return "";
  const map: Record<number,string> = {1:"매우못함",2:"못함",3:"보통",4:"잘함",5:"매우잘함"};
  return map[score] || String(score);
}
function defaultScores() {
  return Array.from({length:5}, () => ({ initial: "", final: "" }));
}
