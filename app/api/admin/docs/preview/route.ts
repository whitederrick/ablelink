// app/api/admin/docs/preview/route.ts
// 관리자 PDF 미리보기 — worker preview와 동일 로직

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer, normalizeDocType } from "@/lib/pdf";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import { trainingDailyLogPayload, traineeFinalEvalPayload, adaptationDailyLogPayload, adaptationFinalEvalPayload } from "@/lib/docs/traineeDocPayload";
import { resolveDocTrainee } from "@/lib/docs/traineeSiteGuard";
import { imageToDataUri } from "@/lib/signatureImage";
import { logAccess } from "@/lib/accessLog";
import { checkAgencyPlanAccess } from "@/lib/planGuard";


export async function GET(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    // 플랜 게이트: 미리보기도 generate와 동일한 완성 PDF를 렌더·스트리밍하므로 동일 기준(PDF_GENERATE=STANDARD)으로
    //  게이트한다(발송만 뺀 우회로였음). 운영자 oversight(agencyId 없음)는 비대상.
    if (scope.agencyId) {
      const plan = await checkAgencyPlanAccess(scope.agencyId, "PDF_GENERATE");
      if (!plan.allowed) return NextResponse.json({ success: false, message: plan.message, reason: plan.reason }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const docType    = normalizeDocType(searchParams.get("docType"));
    const periodStart = searchParams.get("periodStart") || new Date().toISOString().slice(0,10);
    const periodEnd   = searchParams.get("periodEnd")   || periodStart;
    const traineeId   = searchParams.get("traineeId");
    const workerIdRaw = searchParams.get("workerId");
    const assignmentIdRaw = searchParams.get("assignmentId");

    if (!docType || !workerIdRaw || !/^[0-9]+$/.test(workerIdRaw)) return NextResponse.json({ success:false, message:"docType, workerId 필요" }, { status:400 });

    const workerId = BigInt(workerIdRaw);
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName:true, phoneNumber:true, signatureUrl:true, loginId:true },
    });
    // C2: 멀티현장 워커는 assignmentId로 현장 지정(미지정 시 최신 배정). 지정 배정은 소유·기관 스코프 검증.
    const assignmentId = assignmentIdRaw && /^[0-9]+$/.test(assignmentIdRaw) ? BigInt(assignmentIdRaw) : null;
    const assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status:{ in:["ASSIGNED","CONFIRMED","ACTIVE"] }, ...(assignmentId ? { id: assignmentId } : {}), ...(scope.agencyId ? { agencyId: scope.agencyId } : {}) },
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
    // 사업체 담당자 인-퍼슨 서명 조회 (가장 최근 완료된 토큰)
    const managerToken = await prisma.siteSignToken.findFirst({
      where: {
        assignmentId: assignment.id,
        docType,
        periodStart,
        periodEnd,
        signRole: "company_manager",
        usedAt: { not: null },
      },
      orderBy: { usedAt: "desc" },
    });

    const [workerImg, companyImg] = await Promise.all([
      imageToDataUri(user?.signatureUrl),
      imageToDataUri(managerToken?.signatureUrl),
    ]);
    // 매니저(govAgent/agencyAgent) 서명은 실시간 미리보기/조회에서 자동 주입하지 않는다.
    //  → 매니저 서명은 '일지 관리'의 명시적 서명 액션(DocumentRun.managerSignatureUrl)을 거친
    //    제출본 스냅샷 렌더에서만 표시된다. (이름만 표기, 서명 이미지는 비움)
    const sigs = {
      worker:          { name: user?.workerName||"",            imageUrl: workerImg },
      govAgent:       { name: adminForSign?.displayName||"",  imageUrl: undefined },
      agencyAgent:    { name: adminForSign?.displayName||"",  imageUrl: undefined },
      companyManager: { name: managerToken?.signerName||"",   imageUrl: companyImg },
    };

    const site = assignment.site;
    const docTimes = dailyDocTimes(assignment.workType, assignment.commuteGuidanceIncluded, assignment.customWorkStart, assignment.customWorkEnd);
    const start = periodStart, end = periodEnd;
    let payload: any;

    // C1: 훈련생 문서는 이 현장·기간 재적 훈련생일 때만 렌더(빈 공식문서 미리보기 방지).
    const { required: traineeRequired, trainee: guardedTrainee } = await resolveDocTrainee(docType, traineeId, site.id, start, end);
    if (traineeRequired && !guardedTrainee) {
      return NextResponse.json({ success:false, message:"이 현장·기간에 배정된 훈련생이 아닙니다. 훈련생·현장·기간을 확인해주세요." }, { status:400 });
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
          workType: assignment.workType ?? null,
          commuteGuidanceIncluded: assignment.commuteGuidanceIncluded ?? null,
          customWorkStart: assignment.customWorkStart ?? null,
          customWorkEnd: assignment.customWorkEnd ?? null,
          attendanceButtonExempt: assignment.attendanceButtonExempt ?? null,
        },
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      }));
    } else if (docType === "TRAINING_DAILY_LOG") {
      const trainee = guardedTrainee!; // C1 가드에서 이미 검증(null이면 위에서 400)
      const logs = trainee ? await prisma.traineeLog.findMany({
        where:{ writerId:workerId, traineeId:trainee.id, trainingType:{in:["PRE","FIELD"]}, attendance:{siteId:site.id,workDate:{gte:start,lte:end}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      payload = trainingDailyLogPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        preStartYmd: assignment.stepStart?.toISOString().slice(0, 10) || start,
        start, end, logs, docTimes,
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      });
    } else if (docType === "ADAPTATION_DAILY_LOG") {
      const trainee = guardedTrainee!; // C1 가드에서 이미 검증(null이면 위에서 400)
      const logs = trainee ? await prisma.traineeLog.findMany({
        where:{ writerId:workerId, traineeId:trainee.id, trainingType:"ADAPTATION", attendance:{siteId:site.id,workDate:{gte:start,lte:end}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      payload = adaptationDailyLogPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        start, end, logs, docTimes,
        signatures: { worker: sigs.worker, govAgent: sigs.govAgent },
      });
    } else if (docType === "TRAINEE_FINAL_EVAL") {
      const trainee = guardedTrainee!; // C1 가드에서 이미 검증(null이면 위에서 400)
      const ev = trainee ? await prisma.traineeEvaluation.findFirst({
        where:{ traineeId:trainee.id, writerId:workerId, evalType:"TRAINING", periodStart:{ lte:end }, periodEnd:{ gte:start } }, orderBy:{ updatedAt:"desc" }, // P2: 문서 기간 겹침
      }) : null;
      payload = traineeFinalEvalPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        preStartYmd: assignment.stepStart?.toISOString().slice(0, 10) || start,
        start, end, ev,
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      });
    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      const trainee = guardedTrainee!; // C1 가드에서 이미 검증(null이면 위에서 400)
      const ev = trainee ? await prisma.traineeEvaluation.findFirst({
        where:{ traineeId:trainee.id, writerId:workerId, evalType:"ADAPTATION", periodStart:{ lte:end }, periodEnd:{ gte:start } }, orderBy:{ updatedAt:"desc" }, // P2: 문서 기간 겹침
      }) : null;
      payload = adaptationFinalEvalPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        start, end, ev,
        workedDays: await prisma.traineeLog.count({ where: { writerId: workerId, traineeId: trainee.id, trainingType: "ADAPTATION", attendance: { siteId: site.id, workDate: { gte: start, lte: end } } } }),
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      });
    } else {
      payload = { traineeName:"", companyName:site.companyName, periodStart:start, periodEnd:end };
    }

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    // 개인정보 접속기록: 취급자의 직무지도원/훈련생 공식문서 미리보기 열람.
    await logAccess(request, scope, {
      subjectType: "Worker",
      subjectId: workerId,
      subjectLabel: user?.workerName ?? null,
      resource: "official_document_preview",
      action: "view",
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${docType}_preview.pdf"`,
        "Cache-Control": "no-store",
      },
    });

  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/preview]", e);
    return NextResponse.json({ success:false, message: "서버 오류" }, { status:500 });
  }
}
