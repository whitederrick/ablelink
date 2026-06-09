// app/api/worker/docs/generate/route.ts
// PDF 생성 + AWS SES 이메일 발송 (PREMIUM 전용)
// payload 빌드는 lib/docs/buildDocPayload 공용 출처 사용.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess } from "@/lib/planGuard";
import { renderPdfToBuffer } from "@/lib/pdf";
import { sendEmailWithPdf } from "@/lib/email";
import { buildDocPayload, DocPayloadError } from "@/lib/docs/buildDocPayload";

const DOC_LABELS: Record<string, string> = {
  "ATTENDANCE_SHEET":      "직무지도원 출근부",
  "TRAINING_DAILY_LOG":    "지원고용 훈련일지",
  "TRAINEE_FINAL_EVAL":    "지원고용 훈련생 종합 평가기록부",
  "ADAPTATION_DAILY_LOG":  "취업 후 적응지도 일지",
  "ADAPTATION_FINAL_EVAL": "적응지도 대상자 종합 평가기록부",
};

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const workerId = BigInt(session.workerId);
    const planCheck = await checkPlanAccess(workerId, "PDF_GENERATE");
    if (!planCheck.allowed) return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });

    const body = await request.json();
    const { docType, periodStart, periodEnd, sendEmail, toEmail, traineeId, companyManagerSignToken } = body;

    let built;
    try {
      built = await buildDocPayload({ workerId, docType, periodStart, periodEnd, traineeId, companyManagerSignToken });
    } catch (e: any) {
      if (e instanceof DocPayloadError) {
        return NextResponse.json({ success: false, message: e.message, ...(e.extra || {}) }, { status: e.status });
      }
      throw e;
    }
    const { payload, fileName, meta } = built;

    // ── PDF 생성 ──────────────────────────────────────────
    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    // ── 이메일 발송 ───────────────────────────────────────
    let emailSent = false;
    let emailError: string | undefined;
    if (sendEmail && toEmail) {
      try {
        await sendEmailWithPdf({
          from: process.env.EMAIL_FROM || "AbleLink <noreply@able-link.co.kr>",
          to: toEmail,
          subject: `[AbleLink] ${DOC_LABELS[docType] || docType} - ${meta.companyName} (${meta.start} ~ ${meta.end})`,
          body: `안녕하세요.\n\n${meta.companyName} 직무지도 ${DOC_LABELS[docType] || docType}를 첨부합니다.\n\n■ 직무지도원: ${meta.workerName}\n■ 기간: ${meta.start} ~ ${meta.end}\n\n감사합니다.\nAbleLink`,
          pdfBuffer,
          fileName,
        });
        emailSent = true;
      } catch (err: any) {
        console.error("[docs/generate] 이메일 발송 실패:", err?.message ?? err);
        emailError = "이메일 발송에 실패했습니다. PDF는 정상 생성되었습니다.";
      }
    }

    return NextResponse.json({
      success: true,
      fileName,
      emailSent,
      pdfBase64: pdfBuffer.toString("base64"),
      message: emailSent ? `${toEmail}로 발송되었습니다.` : (emailError ?? "PDF가 생성되었습니다."),
    });

  } catch (error: any) {
    console.error("[docs/generate]", error);
    return NextResponse.json({ success: false, message: error.message || "PDF 생성 오류" }, { status: 500 });
  }
}
