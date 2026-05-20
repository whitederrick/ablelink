// app/api/admin/docs/preview/route.ts
// 관리자가 직무지도원별 문서를 jsreport로 미리보기
// GET ?coachUserId=...&docType=...&periodStart=...&periodEnd=...&traineeId=...

export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
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

function fmtHHMM(d: Date) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2,"0")}:${String(kst.getUTCMinutes()).padStart(2,"0")}`;
}
function fmtPeriod(s: string, e: string) { return `${s.replace(/-/g,".")} ~ ${e.replace(/-/g,".")}`; }
function scoreLabel(n?: number|null) { return n ? ({1:"매우못함",2:"못함",3:"보통",4:"잘함",5:"매우잘함"} as any)[n]||String(n) : ""; }
function defaultScores() { return Array.from({length:5},()=>({initial:"",final:""})); }
function defaultPeriod() {
  const n=new Date(), y=n.getFullYear(), m=String(n.getMonth()+1).padStart(2,"0");
  const last=new Date(y,n.getMonth()+1,0).getDate();
  return { start:`${y}-${m}-01`, end:`${y}-${m}-${String(last).padStart(2,"0")}` };
}

export async function GET(request: NextRequest) {
  try {
    const scope = await requireAdminSession(request);
    const { searchParams } = new URL(request.url);
    const coachUserId = searchParams.get("coachUserId") ?? "";
    const docType     = (searchParams.get("docType") ?? "attendance-sheet") as DocType;
    const traineeId   = searchParams.get("traineeId") ?? "";
    const def = defaultPeriod();
    const startStr = searchParams.get("periodStart") || def.start;
    const endStr   = searchParams.get("periodEnd")   || def.end;

    if (!coachUserId) return new Response("coachUserId 필요", { status: 400 });

    const userId = BigInt(coachUserId);

    // 직무지도원 정보
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });

    // 현장 배정
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] } },
      include: {
        site: true,
        assignedByAdmin: { select: { signatureUrl: true, displayName: true } },
      },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment?.site) return new Response("배정된 현장이 없습니다.", { status: 404 });

    // 관리자 서명 (현재 로그인한 관리자 서명 사용)
    const currentAdmin = await prisma.adminUser.findUnique({
      where: { id: scope.userId },
      select: { signatureUrl: true, displayName: true } as any,
    });

    // govAgent: assignedByAdmin 우선, 없으면 현재 관리자
    let adminForSign = (assignment.assignedByAdmin as any) || currentAdmin;
    if (!adminForSign && assignment.agencyId) {
      adminForSign = await prisma.adminUser.findFirst({
        where: { agencyId: assignment.agencyId, isActive: true },
        select: { signatureUrl: true, displayName: true } as any,
        orderBy: { id: "asc" },
      });
    }

    const signatures: SignatureSet = {
      coachImageUrl:       user?.signatureUrl        || null,
      coachName:           user?.userName            || "",
      govAgentImageUrl:    (adminForSign as any)?.signatureUrl || null,
      govAgentName:        (adminForSign as any)?.displayName  || "",
      agencyAgentImageUrl: (adminForSign as any)?.signatureUrl || null,
      agencyAgentName:     (adminForSign as any)?.displayName  || "",
    };

    const site = assignment.site;
    let pdfData: Record<string,any>;

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

    const pdfBuffer = await generatePdf(docType, pdfData);
    return new Response(pdfBuffer, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline" },
    });

  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/preview]", e);
    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;">
      <p style="font-size:36px">⚠️</p>
      <p style="color:#dc2626;font-weight:700">${e.message || "오류"}</p>
    </body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 500 });
  }
}
