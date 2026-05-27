// app/api/worker/auth/reset-password/route.ts
// 비밀번호 찾기: 전화번호로 임시 비밀번호 SMS 발송

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";
import { sendSms, isSmsReady } from "@/lib/sms";
import { checkRateLimit } from "@/lib/rateLimit";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = checkRateLimit(`reset-pw:${ip}`);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil((rl.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { success: false, message: `잠시 후 다시 시도해주세요. (${retryAfterSec}초 후)` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const phone = String(body?.phone ?? "").replace(/-/g, "").trim();

    if (!phone || !/^01[0-9]{8,9}$/.test(phone)) {
      return NextResponse.json({ success: false, message: "올바른 휴대전화번호를 입력해주세요." }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { phoneNumber: { in: [phone, phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3")] } },
      select: { id: true, userName: true, phoneNumber: true, status: true },
    });

    // 사용자가 없어도 동일한 응답 (보안상 존재 여부 노출 금지)
    if (!user || user.status !== "ACTIVE") {
      return NextResponse.json({ success: true, message: "등록된 번호로 임시 비밀번호를 발송했습니다." });
    }

    const tempPw = generateTempPassword();
    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hash(tempPw, 10), isTemporary: true },
    });

    if (isSmsReady()) {
      await sendSms({
        phone: user.phoneNumber,
        message: `[AbleLink] 임시 비밀번호: ${tempPw}\n로그인 후 반드시 변경해주세요.`,
      });
    } else {
      // SMS 미설정: 비밀번호는 절대 로그에 기록하지 않음
      console.warn(`[reset-password] SMS 미설정 — userId: ${user.id} 비밀번호 초기화 완료`);
    }

    return NextResponse.json({ success: true, message: "등록된 번호로 임시 비밀번호를 발송했습니다." });
  } catch (e: any) {
    console.error("[reset-password]", e);
    return NextResponse.json({ success: false, message: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
