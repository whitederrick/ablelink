// app/api/worker/docs/preview/route.ts
// PDF 미리보기 스트리밍 — generate와 동일 payload 빌드, Response로 반환

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer, normalizeDocType, type DocumentType } from "@/lib/pdf";

function fmtHHMM(d: Date): string {
  const kst = new Date(d.getTime() + 9*3600000);
  return `${String(kst.getUTCHours()).padStart(2,"0")}:${String(kst.getUTCMinutes()).padStart(2,"0")}`;
}
function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number|null) {
  return n ? ({1:"매우못함",2:"못함",3:"보통",4:"잘함",5:"매우잘함"} as any)[n]||String(n) : "";
}
async function toBase64DataUri(url?: string|null): Promise<string|undefined> {
  if (!url || !url.startsWith("http")) return url||undefined;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    return `data:${res.headers.get("content-type")||"image/png"};base64,${Buffer.from(buf).toString("base64")}`;
  } catch { return undefined; }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success:false, message:"인증이 필요합니다." }, { status:401 });

    const { searchParams } = new URL(request.url);
    const docType    = normalizeDocType(searchParams.get("docType"));
    const periodStart = searchParams.get("periodStart") || new Date().toISOString().slice(0,10);
    const periodEnd   = searchParams.get("periodEnd")   || periodStart;
    const traineeId   = searchParams.get("traineeId");

    if (!docType) return NextResponse.json({ success:false, message:"docType 필요" }, { status:400 });

    const userId = BigInt(session.userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userName:true, phoneNumber:true, signatureUrl:true, loginId:true },
    });
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status:{ in:["ASSIGNED","CONFIRMED","ACTIVE"] } },
      include: { site:true, assignedByAdmin:{ select:{ signatureUrl:true, displayName:true } } },
      orderBy: { assignedAt:"desc" },
    });
    if (!assignment?.site) return NextResponse.json({ success:false, message:"배정된 현장이 없습니다." }, { status:400 });

    let adminForSign: any = assignment.assignedByAdmin;
    if (!adminForSign && assignment.agencyId) {
      adminForSign = await prisma.adminUser.findFirst({
        where: { agencyId: assignment.agencyId, isActive:true },
        select: { signatureUrl:true, displayName:true } as any,
        orderBy: { id:"asc" },
      });
    }
    const [coachImg, govImg] = await Promise.all([
      toBase64DataUri(user?.signatureUrl),
      toBase64DataUri(adminForSign?.signatureUrl),
    ]);
    const sigs = {
      coach:       { name: user?.userName||"",            imageUrl: coachImg },
      govAgent:    { name: adminForSign?.displayName||"", imageUrl: govImg },
      agencyAgent: { name: adminForSign?.displayName||"", imageUrl: govImg },
    };

    const site = assignment.site;
    const start = periodStart, end = periodEnd;
    let payload: any;

    if (docType === "ATTENDANCE_SHEET") {
      const attendances = await prisma.dailyAttendance.findMany({
        where:{ userId, workDate:{ gte:start, lte:end } },
        include:{ logs:{ select:{ time1on1:true, timeGroup:true, extTime1on1:true, extTimeGroup:true } } },
        orderBy:{ workDate:"asc" },
      });
      const entries = attendances.map(a=>({
        date:a.workDate, start:a.startTime?fmtHHMM(a.startTime):"", end:a.endTime?fmtHHMM(a.endTime):"",
        hours:a.logs.reduce((s,l)=>s+Number(l.time1on1)+Number(l.extTime1on1),0),
        multiHours:a.logs.reduce((s,l)=>s+Number(l.timeGroup)+Number(l.extTimeGroup),0),
      }));
      const totalHours=entries.reduce((s,e)=>s+Number(e.hours),0);
      const oneToMany=entries.reduce((s,e)=>s+Number(e.multiHours),0);
      payload = {
        coachName:user?.userName||"", coachPhone:user?.phoneNumber||user?.loginId||"",
        companyName:site.companyName, periodStartYMD:fmtDot(start), periodEndYMD:fmtDot(end),
        totalDays:entries.length, totalHours, weeklyHolidayCount:0, monthlyLeaveCount:0,
        allowanceTotalWon:"0", oneToOneHours:totalHours-oneToMany, oneToManyHours:oneToMany,
        otOneToOneHours:0, otOneToManyHours:0, entries,
        signatures:{ govAgent:sigs.govAgent, companyManager:{name:"",imageUrl:undefined}, coach:sigs.coach },
      };
    } else if (docType === "TRAINING_DAILY_LOG") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where:{ writerId:userId, traineeId:tid, trainingType:{in:["PRE","FIELD"]}, attendance:{workDate:{gte:start,lte:end}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName,
        periodPreText:fmtPeriod(assignment.stepStart?.toISOString().slice(0,10)||start,start),
        periodFieldText:fmtPeriod(start,end),
        rows:logs.map(l=>({ section:l.trainingType==="PRE"?"PRE":"FIELD", date:l.attendance.workDate,
          attendanceStatus:l.evaluation||"출석", trainingTime:`${Number(l.totalRecognizedTime)}H`,
          guidanceFlag:"Y", task:l.tasks[0]?.taskName||"",
          taskLevelMeasured:scoreLabel(l.tasks[0]?.performanceScore), evalGuidance:l.content||"" })),
        signatures:{ govAgent:sigs.govAgent, companyManager:{name:"",imageUrl:undefined}, coach:sigs.coach },
      };
    } else if (docType === "ADAPTATION_DAILY_LOG") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where:{ writerId:userId, traineeId:tid, trainingType:"ADAPTATION", attendance:{workDate:{gte:start,lte:end}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName, periodStart:start, periodEnd:end,
        entries:logs.map(l=>({ dateISO:l.attendance.workDate, attendance:l.evaluation||"출석",
          workTime:"", guidance:"Y", task:l.tasks[0]?.taskName||"",
          performanceLabel:scoreLabel(l.tasks[0]?.performanceScore), performanceTime:"", coaching:l.content||"" })),
        signatures:{ coach:sigs.coach, govAgent:sigs.govAgent },
      };
    } else if (docType === "TRAINEE_FINAL_EVAL") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const ev = tid ? await prisma.traineeEvaluation.findFirst({
        where:{ traineeId:tid, writerId:userId, evalType:"TRAINING" }, orderBy:{ updatedAt:"desc" },
      }) : null;
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName,
        preTrainingStart:assignment.stepStart?.toISOString().slice(0,10)||start,
        preTrainingEnd:start, fieldTrainingStart:start, fieldTrainingEnd:end,
        scores:(ev?.scores as any)||{}, comments:(ev?.comments as any)||{},
        signatures:{ coach:sigs.coach, agencyAgent:sigs.agencyAgent },
      };
    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const ev = tid ? await prisma.traineeEvaluation.findFirst({
        where:{ traineeId:tid, writerId:userId, evalType:"ADAPTATION" }, orderBy:{ updatedAt:"desc" },
      }) : null;
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName,
        periodStart:start, periodEnd:end,
        scores:(ev?.scores as any)||{}, comments:(ev?.comments as any)||{},
        signatures:{ coach:sigs.coach, agencyAgent:sigs.agencyAgent },
      };
    } else {
      payload = { traineeName:"", companyName:site.companyName, periodStart:start, periodEnd:end };
    }

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${docType}_preview.pdf"`,
        "Cache-Control": "no-store",
      },
    });

  } catch (e: any) {
    console.error("[worker/docs/preview]", e);
    return NextResponse.json({ success:false, message: e.message||"오류" }, { status:500 });
  }
}
