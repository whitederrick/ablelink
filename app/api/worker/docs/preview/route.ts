// app/api/worker/docs/preview/route.ts
// PDF 미리보기 스트리밍 — generate와 동일 payload 빌드, Response로 반환

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer, normalizeDocType } from "@/lib/pdf";
import { buildDocFileName, contentDisposition } from "@/lib/pdf/filename";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";

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

    const workerId = BigInt(session.workerId);
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName:true, phoneNumber:true, signatureUrl:true, loginId:true },
    });
    const assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status:{ in:["ASSIGNED","CONFIRMED","ACTIVE"] } },
      include: { site:true, assignedByManager:{ select:{ signatureUrl:true, displayName:true } } },
      orderBy: { assignedAt:"desc" },
    });
    if (!assignment?.site) return NextResponse.json({ success:false, message:"배정된 현장이 없습니다." }, { status:400 });

    let adminForSign: any = assignment.assignedByManager;
    if (!adminForSign && assignment.agencyId) {
      adminForSign = await prisma.manager.findFirst({
        where: { agencyId: assignment.agencyId, isActive:true },
        select: { signatureUrl:true, displayName:true },
        orderBy: { id:"asc" },
      });
    }
    const [workerImg] = await Promise.all([
      toBase64DataUri(user?.signatureUrl),
    ]);
    // 매니저(govAgent/agencyAgent) 서명은 실시간 미리보기에서 자동 주입하지 않는다.
    //  → 매니저 서명은 명시적 서명 액션을 거친 제출본 스냅샷에서만 표시된다.
    const sigs = {
      worker:       { name: user?.workerName||"",            imageUrl: workerImg },
      govAgent:    { name: adminForSign?.displayName||"", imageUrl: undefined },
      agencyAgent: { name: adminForSign?.displayName||"", imageUrl: undefined },
    };

    const site = assignment.site;
    const start = periodStart, end = periodEnd;
    const docTimes = dailyDocTimes((assignment as any).workType, (assignment as any).commuteGuidanceIncluded, (assignment as any).customWorkStart, (assignment as any).customWorkEnd);
    let payload: any;

    if (docType === "ATTENDANCE_SHEET") {
      ({ payload } = await buildAttendanceSheetPayload({
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
        // 미리보기는 사업체 담당자 서명 자동 주입 안 함(제출 스냅샷에서만 표시).
        signatures: { govAgent: sigs.govAgent, companyManager: { name: "", imageUrl: undefined }, worker: sigs.worker },
      }));
    } else if (docType === "TRAINING_DAILY_LOG") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where:{ writerId:workerId, traineeId:tid, trainingType:{in:["PRE","FIELD"]}, attendance:{workDate:{gte:start,lte:end}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName,
        periodPreText:fmtPeriod(assignment.stepStart?.toISOString().slice(0,10)||start,start),
        periodFieldText:fmtPeriod(start,end),
        rows:logs.map(l=>({ section:l.trainingType==="PRE"?"PRE":"FIELD", date:l.attendance.workDate,
          attendanceStatus:l.evaluation||"출석", trainingTime:docTimes.trainingTimeH,
          guidanceFlag:docTimes.guidanceYN, task:l.tasks[0]?.taskName||"",
          taskLevelMeasured:`${scoreLabel(l.tasks[0]?.performanceScore)}\n(${docTimes.measTimeH})`, evalGuidance:l.content||"" })),
        signatures:{ govAgent:sigs.govAgent, companyManager:{name:"",imageUrl:undefined}, worker:sigs.worker },
      };
    } else if (docType === "ADAPTATION_DAILY_LOG") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const logs = tid ? await prisma.traineeLog.findMany({
        where:{ writerId:workerId, traineeId:tid, trainingType:"ADAPTATION", attendance:{workDate:{gte:start,lte:end}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName, periodStart:start, periodEnd:end,
        entries:logs.map(l=>({ dateISO:l.attendance.workDate, attendance:l.evaluation||"출석",
          workTime:docTimes.workTimeRange, guidance:docTimes.guidanceYN, task:l.tasks[0]?.taskName||"",
          performanceLabel:scoreLabel(l.tasks[0]?.performanceScore), performanceTime:docTimes.measTimeH, coaching:l.content||"" })),
        signatures:{ worker:sigs.worker, govAgent:sigs.govAgent },
      };
    } else if (docType === "TRAINEE_FINAL_EVAL") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const ev = tid ? await prisma.traineeEvaluation.findFirst({
        where:{ traineeId:tid, writerId:workerId, evalType:"TRAINING" }, orderBy:{ updatedAt:"desc" },
      }) : null;
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName,
        preTrainingStart:assignment.stepStart?.toISOString().slice(0,10)||start,
        preTrainingEnd:start, fieldTrainingStart:start, fieldTrainingEnd:end,
        scores:(ev?.scores as any)||{}, comments:(ev?.comments as any)||{},
        signatures:{ worker:sigs.worker, agencyAgent:sigs.agencyAgent },
      };
    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      const tid = traineeId ? BigInt(traineeId) : null;
      const trainee = tid ? await prisma.trainee.findUnique({ where:{id:tid}, select:{name:true} }) : null;
      const ev = tid ? await prisma.traineeEvaluation.findFirst({
        where:{ traineeId:tid, writerId:workerId, evalType:"ADAPTATION" }, orderBy:{ updatedAt:"desc" },
      }) : null;
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName,
        periodStart:start, periodEnd:end,
        scores:(ev?.scores as any)||{}, comments:(ev?.comments as any)||{},
        signatures:{ worker:sigs.worker, agencyAgent:sigs.agencyAgent },
      };
    } else {
      payload = { traineeName:"", companyName:site.companyName, periodStart:start, periodEnd:end };
    }

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    // 훈련생별/기간별로 구분되는 파일명 (다운로드 시 중복 방지)
    const fileName = buildDocFileName(docType, {
      traineeName: payload?.traineeName ?? null,
      companyName: site.companyName,
      start, end,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(fileName, "inline"),
        "Cache-Control": "no-store",
      },
    });

  } catch (e: any) {
    console.error("[worker/docs/preview]", e);
    return NextResponse.json({ success:false, message: "서버 오류" }, { status:500 });
  }
}
