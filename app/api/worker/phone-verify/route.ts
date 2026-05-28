// POST /api/worker/phone-verify
// action: "request" — OTP 발송
// action: "confirm" — OTP 검증

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/sms";

const PHONE_RE = /^01[0-9]{8,9}$/;
const OTP_TTL_MS = 5 * 60 * 1000; // 5분

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  if (action === "request") {
    const phone = String(body?.phoneNumber ?? "").replace(/-/g, "").trim();
    if (!PHONE_RE.test(phone)) {
      return NextResponse.json({ success: false, message: "올바른 휴대전화번호를 입력해주세요." }, { status: 400 });
    }

    // 기존 가입 여부 확인
    const existing = await prisma.user.findUnique({ where: { loginId: phone } });
    if (existing) {
      return NextResponse.json({ success: false, message: "이미 가입된 전화번호입니다." }, { status: 409 });
    }

    const code = randomCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // 기존 미인증 OTP 삭제 후 새로 생성
    await prisma.phoneVerification.deleteMany({ where: { phoneNumber: phone, verified: false } });
    await prisma.phoneVerification.create({ data: { phoneNumber: phone, code, expiresAt } });

    await sendSms({
      phone,
      message: `[AbleLink] 인증번호: ${code}\n5분 이내에 입력해주세요.`,
    });

    return NextResponse.json({ success: true });
  }

  if (action === "confirm") {
    const phone = String(body?.phoneNumber ?? "").replace(/-/g, "").trim();
    const code  = String(body?.code ?? "").trim();

    const record = await prisma.phoneVerification.findFirst({
      where: { phoneNumber: phone, code, verified: false },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return NextResponse.json({ success: false, message: "인증번호가 올바르지 않습니다." }, { status: 400 });
    }
    if (record.expiresAt < new Date()) {
      return NextResponse.json({ success: false, message: "인증번호가 만료되었습니다. 다시 요청해주세요." }, { status: 400 });
    }

    await prisma.phoneVerification.update({ where: { id: record.id }, data: { verified: true } });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
}
