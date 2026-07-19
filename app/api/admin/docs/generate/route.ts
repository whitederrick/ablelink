// app/api/admin/docs/generate/route.ts
// 관리자가 직무지도원 문서를 PDF로 생성하고 이메일 발송

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer } from "@/lib/pdf";
import { sendEmailWithPdf } from "@/lib/email";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import { trainingDailyLogPayload, traineeFinalEvalPayload, adaptationDailyLogPayload, adaptationFinalEvalPayload } from "@/lib/docs/traineeDocPayload";
import { resolveDocTrainee } from "@/lib/docs/traineeSiteGuard";
import { sigRequirement } from "@/lib/docs/requiredSignatures";
import { PDF_TO_PRISMA_DOCTYPE } from "@/lib/docs/docTypeMap";
import { imageToDataUri } from "@/lib/signatureImage";
import { logAccess } from "@/lib/accessLog";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { isValidYmd } from "@/lib/time";


const DOC_LABELS: Record<string, string> = {
  "ATTENDANCE_SHEET":      "직무지도원 출근부",
  "TRAINING_DAILY_LOG":    "지원고용 훈련일지",
  "TRAINEE_FINAL_EVAL":    "지원고용 훈련생 종합 평가기록부",
  "ADAPTATION_DAILY_LOG":  "취업 후 적응지도 일지",
  "ADAPTATION_FINAL_EVAL": "적응지도 대상자 종합 평가기록부",
};

export async function POST(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    // 플랜 게이트: 공식문서 PDF 생성 = STANDARD 등급 기능(PDF_GENERATE). 워커측 docs/generate와 동일 기준 —
    //  매니저측만 무게이트라 FREE 기관이 우회 생성하던 갭 정렬(TRIAL 허용, 운영자 oversight(agencyId 없음)는 비대상).
    if (scope.agencyId) {
      const plan = await checkAgencyPlanAccess(scope.agencyId, "PDF_GENERATE");
      if (!plan.allowed) {
        return NextResponse.json({ success: false, message: plan.message, reason: plan.reason }, { status: 403 });
      }
    }
    const body = await request.json().catch(() => ({}));
    const { workerId: workerIdRaw, docType, periodStart, periodEnd, traineeId, toEmail, assignmentId: assignmentIdRaw } = body;

    if (!workerIdRaw || !docType || !periodStart || !periodEnd)
      return NextResponse.json({ success:false, message:"필수 파라미터 누락" }, { status:400 });
    if (!/^[0-9]+$/.test(String(workerIdRaw)))
      return NextResponse.json({ success:false, message:"workerId 오류" }, { status:400 });
    // 날짜 왕복검증(submit·preview와 통일) — 실존불가 날짜 Invalid Date 500 차단.
    if (!isValidYmd(String(periodStart)) || !isValidYmd(String(periodEnd)))
      return NextResponse.json({ success:false, message:"기간(YYYY-MM-DD)이 올바르지 않습니다." }, { status:400 });
    if (traineeId != null && !/^[0-9]+$/.test(String(traineeId)))
      return NextResponse.json({ success:false, message:"잘못된 훈련생 ID입니다." }, { status:400 });

    const workerId = BigInt(workerIdRaw);
    const start = periodStart, end = periodEnd;

    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName:true, phoneNumber:true, signatureUrl:true, loginId:true },
    });

    // C2: 멀티현장 워커는 assignmentId로 정확한 현장을 지정할 수 있게 한다(미지정 시 기존대로 최신 배정).
    //  지정 배정은 소유(같은 워커)·기관 스코프를 검증 — 임의 배정으로 타현장 문서를 만들지 못하도록.
    const assignmentId = assignmentIdRaw && /^[0-9]+$/.test(String(assignmentIdRaw)) ? BigInt(assignmentIdRaw) : null;
    const assignment = await prisma.siteAssignment.findFirst({
      where: {
        workerId,
        status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] },
        ...(assignmentId ? { id: assignmentId } : {}),
        ...(scope.agencyId ? { agencyId: scope.agencyId } : {}),
      },
      include: {
        site: true,
        assignedByManager: { select: { signatureUrl:true, displayName:true } },
      },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment?.site)
      return NextResponse.json({ success:false, message:"배정된 현장 없음" }, { status:404 });

    let adminForSign: any = assignment.assignedByManager;
    if (!adminForSign) {
      adminForSign = await prisma.manager.findUnique({
        where: { id: scope.managerId },
        select: { signatureUrl:true, displayName:true },
      });
    }
    if (!adminForSign && assignment.agencyId) {
      adminForSign = await prisma.manager.findFirst({
        where: { agencyId: assignment.agencyId, isActive: true },
        select: { signatureUrl:true, displayName:true },
        orderBy: { id: "asc" },
      });
    }

    const [workerImg] = await Promise.all([
      imageToDataUri(user?.signatureUrl),
    ]);

    // 매니저(govAgent/agencyAgent) 서명은 프로필에서 자동 주입하지 않는다(등록된 서명만 표시).
    //  → 매니저 서명은 일지 관리의 명시적 sign 액션을 거친 제출본에서만 들어간다.
    const sigs = {
      worker:       { name: user?.workerName || "",            imageUrl: workerImg },
      govAgent:    { name: adminForSign?.displayName || "", imageUrl: undefined as string | undefined },
      agencyAgent: { name: adminForSign?.displayName || "", imageUrl: undefined as string | undefined },
    };

    const site = assignment.site;
    const docTimes = dailyDocTimes(assignment.workType, assignment.commuteGuidanceIncluded, assignment.customWorkStart, assignment.customWorkEnd);
    let payload: any;
    let fileName: string;

    // C1: 훈련생 문서는 traineeId가 이 현장·기간에 재적한 훈련생일 때만 생성한다.
    //  (가드 null인데도 traineeName=""·logs=[]로 진행하면 빈 공식 PDF가 공단으로 이메일 발송되던 심각 버그.)
    const { required: traineeRequired, trainee: guardedTrainee } = await resolveDocTrainee(docType, traineeId, site.id, start, end);
    if (traineeRequired && !guardedTrainee) {
      return NextResponse.json({ success:false, message:"이 현장·기간에 배정된 훈련생이 아닙니다. 훈련생·현장·기간을 확인해주세요." }, { status:400 });
    }

    if (docType === "ATTENDANCE_SHEET") {
      ({ payload, fileName } = await buildAttendanceSheetPayload({
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
        signatures: { govAgent: sigs.govAgent, companyManager: { name: "", imageUrl: undefined }, worker: sigs.worker },
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
        signatures: { govAgent: sigs.govAgent, companyManager: { name: "", imageUrl: undefined }, worker: sigs.worker },
      });
      fileName = `훈련일지_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

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
      fileName = `훈련생평가_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

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
      fileName = `적응지도일지_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

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
      fileName = `적응지도평가_${trainee?.name||"훈련생"}_${start}_${end}.pdf`;

    } else {
      return NextResponse.json({ success:false, message:"지원하지 않는 문서" }, { status:400 });
    }

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    let emailSent = false;
    if (toEmail) {
      // 발송 게이트: 필수 서명(직무지도원/사업체) 누락 시 발송 차단(공단 발송 보호).
      const reqS = sigRequirement(PDF_TO_PRISMA_DOCTYPE[docType] ?? docType);
      const lacks: string[] = [];
      if (reqS.worker && !sigs.worker?.imageUrl) lacks.push("직무지도원");
      if (reqS.companyManager && !(payload?.signatures?.companyManager?.imageUrl)) lacks.push("사업체 담당자");
      // #11: 매니저 서명 요건 검사 — 이 라우트는 매니저 서명을 주입하지 않으므로(payload에 부재)
      //  매니저 필수 문서(최종평가·적응지도 등)는 여기서 차단되고 '일지 관리' 서명→발송 동선으로 유도된다.
      //  (공식 send 라우트 missingSignatureLabels와 동일 정책)
      if (reqS.manager && !(payload?.signatures?.manager?.imageUrl)) lacks.push("매니저");
      if (lacks.length) {
        return NextResponse.json(
          {
            success: false,
            code: "MISSING_SIGNATURES",
            message: `서명이 누락되어 발송할 수 없습니다: ${lacks.join("·")} 서명 미등록.\n해당 문서는 매니저 '일지 관리'에서 서명을 갖춰 발송해주세요.`,
          },
          { status: 400 },
        );
      }
      await sendEmailWithPdf({
        from: process.env.EMAIL_FROM || "Able-Link <noreply@able-link.co.kr>",
        to: toEmail,
        subject: `[Able-Link] ${DOC_LABELS[docType]||docType} - ${site.companyName} (${start} ~ ${end})`,
        body: `안녕하세요.\n\n${site.companyName} 직무지도 ${DOC_LABELS[docType]||docType}를 첨부합니다.\n\n■ 직무지도원: ${user?.workerName||""}\n■ 기간: ${start} ~ ${end}\n\n감사합니다.\nAble-Link`,
        pdfBuffer, fileName,
      });
      emailSent = true;
    }

    // 개인정보 접속기록: 취급자의 직무지도원/훈련생 공식문서 생성·출력(이메일 발송 시 export).
    await logAccess(request, scope, {
      subjectType: "Worker",
      subjectId: workerId,
      subjectLabel: user?.workerName ?? null,
      resource: "official_document",
      action: emailSent ? "export" : "print",
    });

    return NextResponse.json({
      success: true, fileName, emailSent,
      pdfBase64: pdfBuffer.toString("base64"),
      message: emailSent ? `${toEmail}으로 발송되었습니다.` : "PDF가 생성되었습니다.",
    });

  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/generate]", e);
    return NextResponse.json({ success:false, message: "서버 오류" }, { status:500 });
  }
}
