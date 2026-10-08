// lib/sms.ts — 알리고 SMS 발송 유틸
import { outboundAllowed, logOutboundSkip } from "./outboundGuard";

export async function sendSms(params: {
  phone: string;
  message: string;
}): Promise<void> {
  if (!outboundAllowed()) { logOutboundSkip("sms", `to=${params.phone}`); return; }
  const apiKey  = process.env.KAKAO_ALIMTALK_API_KEY;
  const userid  = process.env.KAKAO_ALIMTALK_USERID;
  const sender  = process.env.KAKAO_ALIMTALK_SENDER_PHONE;

  if (!apiKey || !userid || !sender) {
    // 키 미설정(개발/테스트 또는 운영 설정 누락): 발송하지 않는다. 본문에는 임시 비밀번호·인증번호가 들어갈 수 있고
    //  전화번호는 개인정보라 로그(운영에서는 Vercel 로그에 남음)에 원문을 쓰지 않는다 — 2026-10-08 감사 P3.
    //  개발 중 내용 확인이 필요하면 SMS_STUB_VERBOSE=1일 때만 개발 환경에서 원문을 출력한다.
    const verbose = process.env.SMS_STUB_VERBOSE === "1" && process.env.NODE_ENV !== "production";
    const tail = params.phone.replace(/\D/g, "").slice(-4);
    console.log(verbose
      ? `[SMS stub] to=${params.phone} | ${params.message}`
      : `[SMS stub] 발송 설정 없음 — 미발송 (수신 ***${tail}, ${params.message.length}자)`);
    return;
  }

  const res = await fetch("https://apis.aligo.in/send/", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      apikey:    apiKey,
      userid,
      sender,
      receiver: params.phone.replace(/-/g, ""),
      msg:      params.message,
      msg_type: "SMS",
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`SMS HTTP 오류: ${res.status}`);
  const data = await res.json();
  if (data.result_code !== "1") throw new Error(`SMS 발송 실패: ${data.message}`);
}

export function isSmsReady(): boolean {
  return (
    !!process.env.KAKAO_ALIMTALK_API_KEY &&
    !!process.env.KAKAO_ALIMTALK_USERID &&
    !!process.env.KAKAO_ALIMTALK_SENDER_PHONE
  );
}
