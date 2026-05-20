// app/api/worker/docs/preview/route.ts
// jsreport에서 PDF를 받아 브라우저로 스트리밍 (실제 양식 그대로 표시)

export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import {
  generatePdf,
  buildAttendanceSheetData,
  buildTrainingDailyLogData,
  buildTraineeFinalEvalData,
  buildAdaptationDailyLogData,
  buildAdaptationFinalEvalData,
  type DocType, type SignatureSet,
} from "@/lib/pdfGenerator";

function fmtHHMM(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2,"0")}:${String(kst.getUTCMinutes()).padStart(2,"0")}`;
}
function fmtPeriod(s: string, e: string) {
  return `${s.replace(/-/g,".")} ~ ${e.replace(/-/g,".")}`;
}
function defaultPeriod() {
  const n = new Date(), y = n.getFullYear(), m = String(n.getMonth()+1).padStart(2,"0");
  const last = new Date(y, n.getMonth()+1, 0).getDate();
  return { start:`${y}-${m}-01`, end:`${y}-${m}-${String(last).padStart(2,"0")}` };
}
function scoreLabel(score?: number|null) {
  if (!score) return "";
  return ({1:"매우못함",2:"못함",3:"보통",4:"잘함",5:"매우잘함"} as any)[score] || String(score);
}
function defaultScores() { return Array.from({length:5}, ()=>({initial:"",final:""})); }

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return new Response("Unauthorized", { status: 401 });

    const { searchParams } = new URL(request.url);
    const docType   = (searchParams.get("docType") ?? "attendance-sheet") as DocType;
    const traineeId = searchParams.get("traineeId") ?? "";
    const signToken = searchParams.get("signToken") ?? "";
    const def = defaultPeriod();
    const startStr = searchParams.get("periodStart") || def.start;
    const endStr   = searchParams.get("periodEnd")   || def.end;

    const userId = BigInt(session.userId);

    // 현장 배정 + 에이전시 관리자(govAgent) 정보
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] } },
      include: {
        site: true,
        assignedByAdmin: { select: { signatureUrl: true, displayName: true } },
      },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment?.site) return new Response("배정된 현장이 없습니다.", { status: 404 });

    // 직무지도원 정보
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });

    // 사업체담당자 즉석 서명 확인
    let companyManagerSignatureUrl: string|null = null;
    let companyManagerSignerName = "";
    if (signToken) {
      const tokenRec = await (prisma as any).siteSignToken.findUnique({
        where: { token: signToken },
        select: { signatureUrl: true, usedAt: true, signRole: true, signerName: true },
      });
      if (tokenRec?.usedAt && tokenRec.signRole === "company_manager") {
        companyManagerSignatureUrl = tokenRec.signatureUrl;
        companyManagerSignerName   = tokenRec.signerName || "";
      }
    }

    // govAgent: assignedByAdmin 우선, 없으면 같은 agency의 관리자 조회
    let admin = assignment.assignedByAdmin as any;
    if (!admin && assignment.agencyId) {
      admin = await prisma.adminUser.findFirst({
        where: { agencyId: assignment.agencyId, isActive: true },
        select: { signatureUrl: true, displayName: true } as any,
        orderBy: { id: "asc" },
      });
    }

    const signatures: SignatureSet = {
      coachImageUrl:          user?.signatureUrl  || null,
      coachName:              user?.userName      || "",
      govAgentImageUrl:       (admin as any)?.signatureUrl || null,
      govAgentName:           (admin as any)?.displayName  || "",
      companyManagerImageUrl: companyManagerSignatureUrl,
      companyManagerName:     companyManagerSignerName,
      agencyAgentImageUrl:    (admin as any)?.signatureUrl || null,
      agencyAgentName:        (admin as any)?.displayName  || "",
    };

    const site = assignment.site;
    let pdfData: Record<string, any>;

    if (docType === "attendance-sheet") {
      const attendances = await prisma.dailyAttendance.findMany({
        where: { userId, workDate: { gte: startStr, lte: endStr } },
        include: { logs: { select: { time1on1:true, timeGroup:true, extTime1on1:true, extTimeGroup:true } } },
        orderBy: { workDate: "asc" },
      });
      pdfData = buildAttendanceSheetData({
        coachName:   user?.userName || "",
        coachPhone:  user?.phoneNumber || user?.loginId || "",
        companyName: site.companyName,
        periodStart: startStr, periodEnd: endStr,
        attendances: attendances.map(a => ({
          workDate:    a.workDate,
          startTime:   a.startTime ? fmtHHMM(a.startTime) : null,
          endTime:     a.endTime   ? fmtHHMM(a.endTime)   : null,
          time1on1:    a.logs.reduce((s,l)=>s+Number(l.time1on1),0),
          timeGroup:   a.logs.reduce((s,l)=>s+Number(l.timeGroup),0),
          extTime1on1: a.logs.reduce((s,l)=>s+Number(l.extTime1on1),0),
          extTimeGroup:a.logs.reduce((s,l)=>s+Number(l.extTimeGroup),0),
        })),
        signatures,
      });

    } else if (docType === "training-daily-log") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where: { writerId:userId, traineeId:tid, trainingType:{in:["PRE","FIELD"]}, attendance:{workDate:{gte:startStr,lte:endStr}} },
        include: { attendance:true, tasks:true },
        orderBy: { attendance:{workDate:"asc"} },
      }) : [];
      pdfData = buildTrainingDailyLogData({
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        preTrainingPeriod:   fmtPeriod(assignment.stepStart?.toISOString().slice(0,10)||startStr, startStr),
        fieldTrainingPeriod: fmtPeriod(startStr, endStr),
        entries: logs.map(l => ({
          trainingType:     l.trainingType as "PRE"|"FIELD",
          date:             l.attendance.workDate,
          attendance:       l.evaluation || "출석",
          hours:            `${Number(l.totalRecognizedTime)}H`,
          guidance:         "Y",
          task:             l.tasks[0]?.taskName || "",
          performanceLabel: scoreLabel(l.tasks[0]?.performanceScore),
          performanceTime:  "",
          coaching:         l.content || "",
        })),
        signatures,
      });

    } else if (docType === "trainee-final-eval") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      pdfData = buildTraineeFinalEvalData({
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        prePeriod:   fmtPeriod(assignment.stepStart?.toISOString().slice(0,10)||startStr, startStr),
        fieldPeriod: fmtPeriod(startStr, endStr),
        scores:   { WORK_ATTITUDE:defaultScores(), INTERPERSONAL:defaultScores(), WORK_STYLE:defaultScores(), WORK_PERFORMANCE:defaultScores() },
        comments: {},
        signatures,
      });

    } else if (docType === "adaptation-daily-log") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where: { writerId:userId, traineeId:tid, trainingType:"ADAPTATION", attendance:{workDate:{gte:startStr,lte:endStr}} },
        include: { attendance:true, tasks:true },
        orderBy: { attendance:{workDate:"asc"} },
      }) : [];
      pdfData = buildAdaptationDailyLogData({
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodStart: startStr, periodEnd: endStr,
        entries: logs.map(l => ({
          date:             l.attendance.workDate,
          attendance:       l.evaluation || "출석",
          workTime:         "",
          guidance:         "Y",
          task:             l.tasks[0]?.taskName || "",
          performanceLabel: scoreLabel(l.tasks[0]?.performanceScore),
          performanceTime:  "",
          coaching:         l.content || "",
        })),
        signatures,
      });

    } else if (docType === "adaptation-final-eval") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      pdfData = buildAdaptationFinalEvalData({
        traineeName: trainee?.name || "",
        companyName: site.companyName,
        periodStart: startStr, periodEnd: endStr,
        scores:   { WORK_ATTITUDE:defaultScores(), INTERPERSONAL:defaultScores(), WORK_STYLE:defaultScores(), WORK_PERFORMANCE:defaultScores() },
        comments: {},
        signatures,
      });

    } else {
      return new Response("지원하지 않는 문서 유형", { status: 400 });
    }

    // jsreport에서 PDF 생성 → 브라우저에서 inline 표시
    const pdfBuffer = await generatePdf(docType, pdfData);
    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
      },
    });

  } catch (error: any) {
    console.error("[docs/preview]", error);
    const msg = error?.message || "오류가 발생했습니다.";
    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;">
      <p style="font-size:40px">⚠️</p>
      <p style="font-size:16px;color:#dc2626;font-weight:700">문서 생성 실패</p>
      <p style="font-size:14px;color:#6b7280">${msg}</p>
      <p style="font-size:12px;color:#9ca3af">jsreport 서버가 실행 중인지 확인해주세요.</p>
    </body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 500 });
  }
}
