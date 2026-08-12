// app/api/worker/docs/preview/route.ts
// PDF 미리보기 스트리밍 — generate와 동일 payload 빌드, Response로 반환

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer, normalizeDocType } from "@/lib/pdf";
import { isValidYmd } from "@/lib/time";
import { buildDocFileName, contentDisposition } from "@/lib/pdf/filename";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import { trainingDailyLogPayload, traineeFinalEvalPayload, adaptationDailyLogPayload, adaptationFinalEvalPayload } from "@/lib/docs/traineeDocPayload";
import { resolveDocAssignment } from "@/lib/docs/resolveDocAssignment";
import { findTraineeAtSiteInPeriod } from "@/lib/docs/traineeSiteGuard";
import { imageToDataUri } from "@/lib/signatureImage";
import { checkPlanAccess } from "@/lib/planGuard";
import { resolvePilotManagerSlotName } from "@/lib/pilot/capability"; // ★[PILOT]


export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success:false, message:"인증이 필요합니다." }, { status:401 });

    // 플랜 게이트: 미리보기도 generate와 동일 완성 PDF 렌더 — 동일 기준(PDF_GENERATE)으로 게이트(셀프등록 워커 허용 포함).
    const planCheck = await checkPlanAccess(BigInt(session.workerId), "PDF_GENERATE");
    if (!planCheck.allowed) return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const docType    = normalizeDocType(searchParams.get("docType"));
    const periodStart = searchParams.get("periodStart") || new Date().toISOString().slice(0,10);
    const periodEnd   = searchParams.get("periodEnd")   || periodStart;
    const traineeId   = searchParams.get("traineeId");

    if (!docType) return NextResponse.json({ success:false, message:"docType 필요" }, { status:400 });
    // 날짜 왕복검증(submit과 통일) — 실존불가 날짜가 findTraineeAtSiteInPeriod의 Invalid Date로 500나던 것 차단.
    if (!isValidYmd(periodStart) || !isValidYmd(periodEnd)) return NextResponse.json({ success:false, message:"기간(YYYY-MM-DD)이 올바르지 않습니다." }, { status:400 });

    const workerId = BigInt(session.workerId);
    // 멀티현장: 클라가 선택 배정(assignmentId)을 주면 그 현장으로 미리보기(소유 검증). 없으면 최신 1건 폴백.
    let selAssignmentId: bigint | null = null;
    try { const raw = searchParams.get("assignmentId"); selAssignmentId = raw ? BigInt(raw) : null; } catch { selAssignmentId = null; }
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName:true, phoneNumber:true, signatureUrl:true, loginId:true },
    });
    // 배정 결정은 단일 출처(resolveDocAssignment)로 통일 — 명시배정 유효→사용(ENDED 포함),
    //  없/무효면 활성1개→폴백·활성2개+→선택유도(409)·활성0개→최근ENDED(마감서류).
    const resolved = await resolveDocAssignment(workerId, selAssignmentId, {
      include: { site: true, assignedByManager: { select: { signatureUrl: true, displayName: true } } },
    });
    if (resolved.status === "ambiguous") {
      return NextResponse.json({ success: false, code: "SELECT_SITE", message: "여러 현장에 배정되어 있습니다. 현장을 선택한 뒤 다시 시도해주세요." }, { status: 409 });
    }
    const assignment = resolved.status === "resolved" ? resolved.assignment : null;
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

    // ─────────────────────────────────────────────────────────────────────────
    // ★[PILOT] 위탁기관 담당자 이름 — 파일럿에는 담당자 계정이 없다(v1.8 §9).
    //  운영자가 표시명을 입력했으면 인쇄하고, 아니면 수기 입력 공간을 남긴다.
    //  ★generate(다운로드)에도 **같은 함수**를 쓴다 — 미리보기와 결과가 달라지면 안 된다.
    //   (이 라우트는 매니저 displayName을 채우고 generate는 빈 값이라 원래 둘이 어긋나 있었다.)
    //  ★서명 이미지(imageUrl)는 건드리지 않는다 — 서명란은 이름과 무관하게 공란이다.
    //  회차 종료 시 이 블록과 위 import 1줄만 지우면 원복된다.
    // ─────────────────────────────────────────────────────────────────────────
    const pilotSlotName = await resolvePilotManagerSlotName(assignment.id);
    if (pilotSlotName !== null) {
      sigs.govAgent.name = pilotSlotName;
      sigs.agencyAgent.name = pilotSlotName;
    }
    // ★[PILOT] 끝

    const site = assignment.site;
    const start = periodStart, end = periodEnd;
    const docTimes = dailyDocTimes(assignment.workType, assignment.commuteGuidanceIncluded, assignment.customWorkStart, assignment.customWorkEnd);
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
          workType: assignment.workType ?? null,
          commuteGuidanceIncluded: assignment.commuteGuidanceIncluded ?? null,
          customWorkStart: assignment.customWorkStart ?? null,
          customWorkEnd: assignment.customWorkEnd ?? null,
          attendanceButtonExempt: assignment.attendanceButtonExempt ?? null,
        },
        // 미리보기는 사업체 담당자 서명 자동 주입 안 함(제출 스냅샷에서만 표시).
        signatures: { govAgent: sigs.govAgent, companyManager: { name: "", imageUrl: undefined }, worker: sigs.worker },
      }));
    } else if (docType === "TRAINING_DAILY_LOG") {
      const trainee = previewTrainee!;
      const logs = trainee ? await prisma.traineeLog.findMany({
        where:{ writerId:workerId, traineeId:trainee.id, trainingType:{in:["PRE","FIELD"]}, attendance:{siteId:site.id,workDate:{gte:start,lte:end}} },
        include:{ attendance:true, tasks:true }, orderBy:{ attendance:{workDate:"asc"} },
      }) : [];
      payload = trainingDailyLogPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        preStartYmd: assignment.stepStart?.toISOString().slice(0, 10) || start,
        start, end, logs, docTimes,
        signatures: { govAgent: sigs.govAgent, companyManager: { name: "", imageUrl: undefined }, worker: sigs.worker },
      });
    } else if (docType === "ADAPTATION_DAILY_LOG") {
      const trainee = previewTrainee!;
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
      const trainee = previewTrainee!;
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
      const trainee = previewTrainee!;
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
