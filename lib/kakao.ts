// lib/kakao.ts — 알리고 카카오 알림톡 공통 유틸
//
// 필요한 환경변수:
//   KAKAO_ALIMTALK_API_KEY          알리고 API 키
//   KAKAO_ALIMTALK_USERID           알리고 계정 ID
//   KAKAO_ALIMTALK_SENDER_KEY       카카오 채널 발신 키 (알리고 채널 등록 후 발급)
//   KAKAO_ALIMTALK_SENDER_PHONE     발신 번호 (예: 01012345678)
//
// 등록 필요한 알림톡 템플릿 코드 (알리고 콘솔에서 등록 후 아래 변수로 설정):
//   KAKAO_CONTRACT_TEMPLATE_CODE         계약서 서명 요청
//   KAKAO_SIGNUP_TEMPLATE_CODE           신규 가입 안내 (임시 비밀번호 발급)
//   KAKAO_CONTRACT_SIGNED_TEMPLATE_CODE  서명 완료 안내
//   KAKAO_CONTRACT_EXPIRY_TEMPLATE_CODE  계약 만료 D-30/7/1 알림

export interface AlimtalkButton {
  name: string;
  linkType: "WL" | "AL" | "BK" | "MD";
  linkMo?: string;
  linkPc?: string;
}

export interface AlimtalkParams {
  phone: string;
  name: string;
  templateCode: string;
  subject: string;
  message: string;
  buttons?: AlimtalkButton[];
}

/** 단건 알림톡 발송. 템플릿 미등록 또는 자격증명 없으면 throw. */
export async function sendAlimtalk(params: AlimtalkParams): Promise<void> {
  const apiKey    = process.env.KAKAO_ALIMTALK_API_KEY;
  const userid    = process.env.KAKAO_ALIMTALK_USERID;
  const senderKey = process.env.KAKAO_ALIMTALK_SENDER_KEY;
  const sender    = process.env.KAKAO_ALIMTALK_SENDER_PHONE;

  if (!apiKey || !userid || !senderKey || !sender) {
    throw new Error("카카오 알림톡 환경변수가 설정되지 않았습니다. (KAKAO_ALIMTALK_*)");
  }
  if (!params.templateCode) {
    throw new Error("templateCode가 없습니다.");
  }

  const body: Record<string, string> = {
    apikey:      apiKey,
    userid,
    senderkey:   senderKey,
    tpl_code:    params.templateCode,
    sender,
    receiver_1:  params.phone.replace(/-/g, ""),
    recvname_1:  params.name,
    subject_1:   params.subject,
    message_1:   params.message,
  };
  if (params.buttons?.length) {
    body.button_1 = JSON.stringify({ button: params.buttons });
  }

  const res = await fetch("https://kakaoapi.aligo.in/akv10/alimtalk/send/", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams(body).toString(),
    signal:  AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`알림톡 HTTP 오류: ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`알림톡 발송 실패 (code:${data.code}): ${data.message}`);
}

/** 자격증명 + 템플릿코드 설정 여부 확인 */
export function isAlimtalkReady(templateEnvKey?: string): boolean {
  const base =
    !!process.env.KAKAO_ALIMTALK_API_KEY &&
    !!process.env.KAKAO_ALIMTALK_USERID &&
    !!process.env.KAKAO_ALIMTALK_SENDER_KEY &&
    !!process.env.KAKAO_ALIMTALK_SENDER_PHONE;
  if (!templateEnvKey) return base;
  return base && !!process.env[templateEnvKey];
}
