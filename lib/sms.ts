// lib/sms.ts — 알리고 SMS 발송 유틸

export async function sendSms(params: {
  phone: string;
  message: string;
}): Promise<void> {
  const apiKey  = process.env.KAKAO_ALIMTALK_API_KEY;
  const userid  = process.env.KAKAO_ALIMTALK_USERID;
  const sender  = process.env.KAKAO_ALIMTALK_SENDER_PHONE;

  if (!apiKey || !userid || !sender) {
    throw new Error("SMS 발송 환경변수가 설정되지 않았습니다. (KAKAO_ALIMTALK_*)");
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
