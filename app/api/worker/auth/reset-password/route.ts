// app/api/worker/auth/reset-password/route.ts
// 비밀번호 찾기: 전화번호 → 알림톡(SMS 대비 저가) / 이메일 → SES 임시 비밀번호 발송
// 비용 정책: 알림톡 실패 시 SMS 자동 폴백 금지(비용). 미설정 시 발송 보류 → 소속 기관 문의 동선.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";
import { sendAlimtalk, isAlimtalkReady } from "@/lib/kakao";
import { sendSimpleEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rateLimit";
import { getRateLimitIp } from "@/lib/clientIp";
import { outboundAllowed } from "@/lib/outboundGuard";

const RESET_PW_TEMPLATE = "KAKAO_RESET_PW_TEMPLATE_CODE";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");
}

export async function POST(req: NextRequest) {
  try {
    // 신뢰 IP(클라 조작 불가) 기준 레이트리밋. XFF 첫 홉은 스푸핑 가능하므로 쓰지 않는다.
    const ip = getRateLimitIp(req) ?? "unknown";
    const rl = await checkRateLimit(`reset-pw:${ip}`);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil((rl.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { success: false, message: `잠시 후 다시 시도해주세요. (${retryAfterSec}초 후)` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const raw   = String(body?.identifier ?? body?.phone ?? "").trim();
    const isEmail = raw.includes("@");
    const phone   = isEmail ? "" : raw.replace(/-/g, "");

    if (!raw) {
      return NextResponse.json({ success: false, message: "전화번호 또는 이메일을 입력해주세요." }, { status: 400 });
    }
    if (!isEmail && !/^01[0-9]{8,9}$/.test(phone)) {
      return NextResponse.json({ success: false, message: "올바른 전화번호를 입력해주세요." }, { status: 400 });
    }
    if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return NextResponse.json({ success: false, message: "올바른 이메일 주소를 입력해주세요." }, { status: 400 });
    }

    // 식별자별 스로틀 — IP를 바꿔가며 특정 대상(전화/이메일)의 비번 초기화를 반복 유발해
    //  계정 잠금·유료 발송 남용하는 것을 IP와 무관하게 차단.
    const idKey = isEmail ? raw.toLowerCase() : phone;
    const idRl = await checkRateLimit(`reset-pw-id:${idKey}`);
    if (!idRl.allowed) {
      const retryAfterSec = Math.ceil((idRl.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { success: false, message: `잠시 후 다시 시도해주세요. (${retryAfterSec}초 후)` },
        { status: 429 },
      );
    }

    const user = isEmail
      ? await prisma.worker.findUnique({
          where: { loginId: raw },
          select: { id: true, workerName: true, phoneNumber: true, loginId: true, status: true },
        })
      : await prisma.worker.findFirst({
          where: { phoneNumber: { in: [phone, phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3")] } },
          select: { id: true, workerName: true, phoneNumber: true, loginId: true, status: true },
        });

    const successMsg = isEmail
      ? "등록된 이메일로 임시 비밀번호를 발송했습니다."
      : "등록된 번호로 임시 비밀번호를 발송했습니다.";

    // 사용자가 없어도 동일한 응답 (보안상 존재 여부 노출 금지)
    if (!user || user.status !== "ACTIVE") {
      return NextResponse.json({ success: true, message: successMsg });
    }

    const tempPw = generateTempPassword();

    // ★임시비번을 '발송에 성공한 경우에만' 계정에 반영한다(P1). 과거엔 발송 전에 무조건 비번을 교체+세션
    //  무효화해서, 알림톡 템플릿/RESEND 미설정·발송 실패 시 옛 비번 무효+새 비번 미전달 = 계정 완전 잠김이었다.
    //  (존재 여부 비노출을 위해 응답 메시지는 성공/미발송 동일. 미발송 시엔 계정을 안 건드려 옛 비번 유지.)
    // ★outboundGuard가 차단(dev/preview)하면 send*가 미발송인데도 예외 없이 반환한다. 그 경우 delivered=true로
    //  계정을 바꾸면 사용자가 미전달 임시비번으로 잠긴다(이 라우트가 막으려던 바로 그 상황). 발송이 실제로
    //  나가는 환경일 때만 delivered를 세워 '진짜 발송 성공'과 '조용한 억제'를 구분한다.
    const canDeliver = outboundAllowed();
    let delivered = false;
    if (isEmail) {
      try {
        await sendSimpleEmail({
          to: raw,
          subject: "[Able-Link] 임시 비밀번호 안내",
          text: `안녕하세요, ${user.workerName || ""}님.\n\n임시 비밀번호: ${tempPw}\n\n로그인 후 반드시 비밀번호를 변경해주세요.\n\n- Able-Link 팀`,
        });
        delivered = canDeliver;
      } catch (e: any) {
        console.error("[reset-password] 이메일 발송 실패:", e?.message);
      }
    } else if (isAlimtalkReady(RESET_PW_TEMPLATE)) {
      const appUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
      try {
        await sendAlimtalk({
          phone: user.phoneNumber,
          name: user.workerName || "",
          templateCode: process.env[RESET_PW_TEMPLATE]!,
          subject: "Able-Link 임시 비밀번호 안내",
          message: `안녕하세요 ${user.workerName || ""}님,\n\n요청하신 임시 비밀번호를 안내드립니다.\n\n임시 비밀번호: ${tempPw}\n\n로그인 후 반드시 비밀번호를 변경해주세요.\n\n${appUrl}/worker/login`,
          buttons: [{ name: "로그인하기", linkType: "WL", linkMo: `${appUrl}/worker/login`, linkPc: `${appUrl}/worker/login` }],
        });
        delivered = canDeliver;
      } catch (e) {
        console.error("[reset-password] 알림톡 발송 실패:", e);
      }
    } else {
      // 알림톡 미설정 → 발송 불가. 계정을 건드리지 않는다(옛 비번 유지 = 잠김 방지). 매니저 콘솔 초기화 동선.
      console.warn(`[reset-password] 알림톡 미설정 — workerId: ${user.id} (발송 보류·계정 미변경)`);
    }

    if (delivered) {
      await prisma.worker.update({
        where: { id: user.id },
        // P2-16: 재설정 시 sessionVersion +1 → 기존 발급 토큰 전부 무효화(재설정=전 세션 로그아웃).
        // ★10차#3: 셀프 재설정 임시비번은 워커에게 발송(알림톡/이메일)되는 known 비번 → hasKnownPassword=true 전이
        //  (초대출신 워커가 재설정 후 계약 서명 시 이 비번이 폐기·락아웃되던 회귀 차단).
        data: { password: await hash(tempPw, 12), isTemporary: true, hasKnownPassword: true, sessionVersion: { increment: 1 } },
      });
    }

    return NextResponse.json({ success: true, message: successMsg });
  } catch (e: any) {
    console.error("[reset-password]", e);
    return NextResponse.json({ success: false, message: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
