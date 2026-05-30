// app/api/worker/auth/reset-password/route.ts
// 비밀번호 찾기: 전화번호 → SMS / 이메일 → SES 임시 비밀번호 발송

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";
import { sendSms, isSmsReady } from "@/lib/sms";
import { sendSimpleEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rateLimit";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
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
    await prisma.worker.update({
      where: { id: user.id },
      data: { password: await hash(tempPw, 12), isTemporary: true },
    });

    if (isEmail) {
      try {
        await sendSimpleEmail({
          to: raw,
          subject: "[AbleLink] 임시 비밀번호 안내",
          text: `안녕하세요, ${user.workerName || ""}님.\n\n임시 비밀번호: ${tempPw}\n\n로그인 후 반드시 비밀번호를 변경해주세요.\n\n- AbleLink 팀`,
        });
      } catch (e: any) {
        console.error("[reset-password] 이메일 발송 실패:", e?.message);
      }
    } else if (isSmsReady()) {
      await sendSms({
        phone: user.phoneNumber,
        message: `[AbleLink] 임시 비밀번호: ${tempPw}\n로그인 후 반드시 변경해주세요.`,
      });
    } else {
      console.warn(`[reset-password] SMS/이메일 미설정 — workerId: ${user.id} 초기화 완료`);
    }

    return NextResponse.json({ success: true, message: successMsg });
  } catch (e: any) {
    console.error("[reset-password]", e);
    return NextResponse.json({ success: false, message: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
