// lib/email.ts — Resend 이메일 발송 유틸
// (AWS SES 샌드박스 해제 반려로 Resend 전환. 함수 시그니처는 동일 → 호출부 무변경)
//
// 필요 환경변수:
//   RESEND_API_KEY    — Resend 대시보드에서 발급 (필수)
//   RESEND_FROM_EMAIL — 기본 발신자, 예: "AbleLink <noreply@able-link.co.kr>"
//                       (Resend에서 도메인 인증 완료 후 사용 가능)
import { Resend } from "resend";

// ⚠️ Resend는 API 키 없이 생성자를 호출하면 throw → 모듈 로드(빌드 시점)에 만들지 않고
//    실제 발송 시점에 지연 생성한다. (빌드의 page data 수집 단계에서 키 미주입으로 실패 방지)
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY가 설정되지 않았습니다.");
    _resend = new Resend(key);
  }
  return _resend;
}

const DEFAULT_FROM =
  process.env.RESEND_FROM_EMAIL ||
  process.env.EMAIL_FROM ||
  process.env.SES_FROM_EMAIL ||
  "AbleLink <noreply@able-link.co.kr>";

export async function sendEmailWithPdf(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  pdfBuffer: Buffer;
  fileName: string;
}) {
  const { error } = await getResend().emails.send({
    from: opts.from || DEFAULT_FROM,
    to: [opts.to],
    subject: opts.subject,
    text: opts.body,
    attachments: [{ filename: opts.fileName, content: opts.pdfBuffer }],
  });
  if (error) {
    throw new Error(`Resend 발송 실패: ${error.message ?? JSON.stringify(error)}`);
  }
}

export async function sendSimpleEmail(opts: {
  to: string;
  subject: string;
  text: string;
}) {
  const { error } = await getResend().emails.send({
    from: DEFAULT_FROM,
    to: [opts.to],
    subject: opts.subject,
    text: opts.text,
  });
  if (error) {
    throw new Error(`Resend 발송 실패: ${error.message ?? JSON.stringify(error)}`);
  }
}
