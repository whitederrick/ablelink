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
import { findTraineeAtSiteInPeriod } from "@/lib/docs/traineeSiteGuard";
import { imageToDataUri } from "@/lib/signatureImage";

function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number|null) {
  return n ? ({1:"매우못함",2:"못함",3:"보통",4:"잘함",5:"매우잘함"} as any)[n]||String(n) : "";
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
    // 멀티현장: 클라가 선택 배정(assignmentId)을 주면 그 현장으로 미리보기(소유 검증). 없으면 최신 1건 폴백.
    let selAssignmentId: bigint | null = null;
    try { const raw = searchParams.get("assignmentId"); selAssignmentId = raw ? BigInt(raw) : null; } catch { selAssignmentId = null; }
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName:true, phoneNumber:true, signatureUrl:true, loginId:true },
    });
    // 딥링크가 배정을 '명시'하면 종료(ENDED)여도 그 배정으로(과거문서 미리보기·재제출) — generate/submit과 통일.
    //  ★근무 발생 가능 상태(ASSIGNED/CONFIRMED/ACTIVE/ENDED)만 허용 — 미근무 배정(REQUESTED 등) 문서 차단.
    const assignment = selAssignmentId != null
      ? await prisma.siteAssignment.findFirst({ where: { id: selAssignmentId, workerId, status:{ in:["ASSIGNED","CONFIRMED","ACTIVE","ENDED"] } }, include: { site:true, assignedByManager:{ select:{ signatureUrl:true, displayName:true } } } })
      : await prisma.siteAssignment.findFirst({
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
      imageToDataUri(user?.signatureUrl),
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

    // 훈련생 문서는 유효한 훈련생 필수 — generate/submit과 동일하게 미선택/미재적이면 400.
    //  (미선택 시 traineeName:''로 빈 훈련생 공식문서 PDF가 렌더되던 것 차단 — 문서 무결성.)
    const TRAINEE_DOC_TYPES = ["TRAINING_DAILY_LOG", "ADAPTATION_DAILY_LOG", "TRAINEE_FINAL_EVAL", "ADAPTATION_FINAL_EVAL"];
    let previewTrainee: { id: bigint; name: string } | null = null;
    if (TRAINEE_DOC_TYPES.includes(docType)) {
      let tid: bigint | null = null;
      try { tid = traineeId ? BigInt(traineeId) : null; } catch { tid = null; }
      previewTrainee = tid ? await findTraineeAtSiteInPeriod(tid, site.id, start, end) : null; // IDOR 방지: 배정 현장+기간 재적 훈련생만
      if (!previewTrainee) return NextResponse.json({ success: false, message: "훈련생을 선택해주세요." }, { status: 400 });
    }

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
      const trainee = previewTrainee!;
      const logs = trainee ? await prisma.traineeLog.findMany({
        where:{ writerId:workerId, traineeId:trainee.id, trainingType:{in:["PRE","FIELD"]}, attendance:{workDate:{gte:start,lte:end}} },
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
      const trainee = previewTrainee!;
      const logs = trainee ? await prisma.traineeLog.findMany({
        where:{ writerId:workerId, traineeId:trainee.id, trainingType:"ADAPTATION", attendance:{workDate:{gte:start,lte:end}} },
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
      const trainee = previewTrainee!;
      const ev = trainee ? await prisma.traineeEvaluation.findFirst({
        where:{ traineeId:trainee.id, writerId:workerId, evalType:"TRAINING" }, orderBy:{ updatedAt:"desc" },
      }) : null;
      payload = {
        traineeName:trainee?.name||"", companyName:site.companyName,
        preTrainingStart:assignment.stepStart?.toISOString().slice(0,10)||start,
        preTrainingEnd:start, fieldTrainingStart:start, fieldTrainingEnd:end,
        scores:(ev?.scores as any)||{}, comments:(ev?.comments as any)||{},
        signatures:{ worker:sigs.worker, agencyAgent:sigs.agencyAgent },
      };
    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      const trainee = previewTrainee!;
      const ev = trainee ? await prisma.traineeEvaluation.findFirst({
        where:{ traineeId:trainee.id, writerId:workerId, evalType:"ADAPTATION" }, orderBy:{ updatedAt:"desc" },
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
