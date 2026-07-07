// app/api/admin/docs/sign/route.ts
// 위탁기관 관리자가 문서를 검토 후 명시적으로 서명하는 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer, normalizeDocType } from "@/lib/pdf";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import { trainingDailyLogPayload, traineeFinalEvalPayload, adaptationDailyLogPayload, adaptationFinalEvalPayload } from "@/lib/docs/traineeDocPayload";
import { resolveDocTrainee } from "@/lib/docs/traineeSiteGuard";
import { sendEmailWithPdf } from "@/lib/email";
import { sigRequirement } from "@/lib/docs/requiredSignatures";
import { PDF_TO_PRISMA_DOCTYPE } from "@/lib/docs/docTypeMap";
import { imageToDataUri } from "@/lib/signatureImage";
import { logAccess } from "@/lib/accessLog";


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
    const { workerId: workerIdRaw, docType: rawDocType, periodStart, periodEnd, traineeId, toEmail, assignmentId: assignmentIdRaw } = body;

    const docType = normalizeDocType(rawDocType);
    if (!docType || !workerIdRaw || !periodStart || !periodEnd)
      return NextResponse.json({ success: false, message: "필수 파라미터 누락" }, { status: 400 });
    if (!/^[0-9]+$/.test(String(workerIdRaw)))
      return NextResponse.json({ success: false, message: "workerId 오류" }, { status: 400 });

    const workerId = BigInt(workerIdRaw);
    const start = periodStart, end = periodEnd;
    const assignmentId = assignmentIdRaw && /^[0-9]+$/.test(String(assignmentIdRaw)) ? BigInt(assignmentIdRaw) : null;

    // 서명하는 관리자 본인의 서명 이미지 사용
    const admin = await prisma.manager.findUnique({
      where: { id: scope.managerId },
      select: { signatureUrl: true, displayName: true },
    });
    if (!admin?.signatureUrl)
      return NextResponse.json({ success: false, message: "관리자 서명이 등록되지 않았습니다. 서명 설정에서 먼저 서명을 등록해주세요." }, { status: 400 });

    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });
    const assignment = await prisma.siteAssignment.findFirst({
      // C2: assignmentId 지정 시 그 배정(소유·기관 스코프 검증)으로 현장 결정, 미지정 시 최신 배정.
      where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] }, ...(assignmentId ? { id: assignmentId } : {}), agencyId: scope.agencyId },
      include: { site: true },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment?.site)
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });

    const [workerImg, govImg] = await Promise.all([
      imageToDataUri(user?.signatureUrl),
      imageToDataUri(admin.signatureUrl),
    ]);

    const sigs = {
      worker:       { name: user?.workerName || "",       imageUrl: workerImg },
      govAgent:    { name: admin.displayName || "",    imageUrl: govImg },
      agencyAgent: { name: admin.displayName || "",    imageUrl: govImg },
      companyManager: { name: "", imageUrl: undefined as string | undefined },
    };

    const site = assignment.site;
    const docTimes = dailyDocTimes((assignment as any).workType, (assignment as any).commuteGuidanceIncluded, (assignment as any).customWorkStart, (assignment as any).customWorkEnd);
    let payload: any;
    let fileName: string;

    // C1: 훈련생 문서는 이 현장·기간 재적 훈련생일 때만 서명·발송(빈 공식 PDF의 공단 발송 방지).
    const { required: traineeRequired, trainee: guardedTrainee } = await resolveDocTrainee(docType, traineeId, site.id, start, end);
    if (traineeRequired && !guardedTrainee) {
      return NextResponse.json({ success: false, message: "이 현장·기간에 배정된 훈련생이 아닙니다. 훈련생·현장·기간을 확인해주세요." }, { status: 400 });
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
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      }));
      fileName = `출근부_${site.companyName}_${start}_${end}_서명완료.pdf`;

    } else if (docType === "TRAINING_DAILY_LOG") {
      const trainee = guardedTrainee!; // C1 가드에서 이미 검증(null이면 위에서 400)
      const logs = trainee ? await prisma.traineeLog.findMany({
        where: { writerId: workerId, traineeId: trainee.id, trainingType: { in: ["PRE", "FIELD"] }, attendance: { workDate: { gte: start, lte: end } } },
        include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
      }) : [];
      payload = trainingDailyLogPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        preStartYmd: assignment.stepStart?.toISOString().slice(0, 10) || start,
        start, end, logs, docTimes,
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      });
      fileName = `훈련일지_${trainee?.name || "훈련생"}_${start}_${end}_서명완료.pdf`;

    } else if (docType === "TRAINEE_FINAL_EVAL") {
      const trainee = guardedTrainee!; // C1 가드에서 이미 검증(null이면 위에서 400)
      const ev = trainee ? await prisma.traineeEvaluation.findFirst({
        where: { traineeId: trainee.id, writerId: workerId, evalType: "TRAINING" }, orderBy: { updatedAt: "desc" },
      }) : null;
      payload = traineeFinalEvalPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        preStartYmd: assignment.stepStart?.toISOString().slice(0, 10) || start,
        start, end, ev,
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      });
      fileName = `훈련생평가_${trainee?.name || "훈련생"}_${start}_${end}_서명완료.pdf`;

    } else if (docType === "ADAPTATION_DAILY_LOG") {
      const trainee = guardedTrainee!; // C1 가드에서 이미 검증(null이면 위에서 400)
      const logs = trainee ? await prisma.traineeLog.findMany({
        where: { writerId: workerId, traineeId: trainee.id, trainingType: "ADAPTATION", attendance: { workDate: { gte: start, lte: end } } },
        include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
      }) : [];
      payload = adaptationDailyLogPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        start, end, logs, docTimes,
        signatures: { worker: sigs.worker, govAgent: sigs.govAgent },
      });
      fileName = `적응지도일지_${trainee?.name || "훈련생"}_${start}_${end}_서명완료.pdf`;

    } else if (docType === "ADAPTATION_FINAL_EVAL") {
      const trainee = guardedTrainee!; // C1 가드에서 이미 검증(null이면 위에서 400)
      const ev = trainee ? await prisma.traineeEvaluation.findFirst({
        where: { traineeId: trainee.id, writerId: workerId, evalType: "ADAPTATION" }, orderBy: { updatedAt: "desc" },
      }) : null;
      payload = adaptationFinalEvalPayload({
        traineeName: trainee?.name || "", companyName: site.companyName,
        start, end, ev,
        workedDays: await prisma.traineeLog.count({ where: { writerId: workerId, traineeId: trainee.id, trainingType: "ADAPTATION", attendance: { workDate: { gte: start, lte: end } } } }),
        signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
      });
      fileName = `적응지도평가_${trainee?.name || "훈련생"}_${start}_${end}_서명완료.pdf`;

    } else {
      return NextResponse.json({ success: false, message: "지원하지 않는 문서 종류" }, { status: 400 });
    }

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    let emailSent = false;
    if (toEmail) {
      // 발송 게이트: 매니저(관리자) 서명은 위에서 강제, 추가로 직무지도원/사업체 서명 누락 시 발송 차단.
      const reqS = sigRequirement(PDF_TO_PRISMA_DOCTYPE[docType] ?? docType);
      const lacks: string[] = [];
      if (reqS.worker && !sigs.worker?.imageUrl) lacks.push("직무지도원");
      if (reqS.companyManager && !(payload?.signatures?.companyManager?.imageUrl)) lacks.push("사업체 담당자");
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
        subject: `[Able-Link] ${DOC_LABELS[docType] || docType} - ${site.companyName} (${start} ~ ${end}) [서명완료]`,
        body: `안녕하세요.\n\n${site.companyName} 직무지도 ${DOC_LABELS[docType] || docType}를 첨부합니다.\n\n■ 직무지도원: ${user?.workerName || ""}\n■ 기간: ${start} ~ ${end}\n■ 서명: ${admin.displayName || "위탁기관 담당자"}\n\n감사합니다.\nAble-Link`,
        pdfBuffer,
        fileName,
      });
      emailSent = true;
    }

    // M10: 개인정보 접속기록(제8조) — 서명·발송도 PII PDF 렌더·제공 지점이라 기록(generate엔 있으나 sign은 누락돼 있었다).
    await logAccess(request, scope, {
      subjectType: "Worker",
      subjectId: workerId,
      subjectLabel: user?.workerName ?? null,
      resource: "official_document_sign",
      action: emailSent ? "export" : "print",
    });

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
