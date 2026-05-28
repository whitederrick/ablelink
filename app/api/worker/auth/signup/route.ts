// POST /api/worker/auth/signup — 전화번호 OTP 인증 후 계정 생성

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { signWorkerToken, WORKER_COOKIE } from "@/app/worker/_lib/session";

const PHONE_RE = /^01[0-9]{8,9}$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const phone    = String(body?.phoneNumber ?? "").replace(/-/g, "").trim();
    const name     = String(body?.userName    ?? "").trim();
    const password = String(body?.password    ?? "");
    const consentTerms    = body?.consentTerms    === true;
    const consentPrivacy  = body?.consentPrivacy  === true;
    const consentLocation = body?.consentLocation === true;

    if (!PHONE_RE.test(phone))     return NextResponse.json({ success: false, message: "올바른 휴대전화번호를 입력해주세요." }, { status: 400 });
    if (name.length < 2)           return NextResponse.json({ success: false, message: "이름은 2자 이상이어야 합니다." }, { status: 400 });
    if (password.length < 8)       return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    if (!consentTerms || !consentPrivacy) {
      return NextResponse.json({ success: false, message: "필수 약관에 동의해주세요." }, { status: 400 });
    }

    // OTP 인증 완료 여부 확인
    const verified = await prisma.phoneVerification.findFirst({
      where: { phoneNumber: phone, verified: true },
      orderBy: { createdAt: "desc" },
    });
    if (!verified) {
      return NextResponse.json({ success: false, message: "전화번호 인증을 먼저 완료해주세요." }, { status: 400 });
    }
    // 10분 이내 인증인지 확인
    if (Date.now() - verified.createdAt.getTime() > 10 * 60 * 1000) {
      return NextResponse.json({ success: false, message: "인증이 만료되었습니다. 다시 인증해주세요." }, { status: 400 });
    }

    // 중복 확인
    const existing = await prisma.user.findUnique({ where: { loginId: phone } });
    if (existing) return NextResponse.json({ success: false, message: "이미 가입된 전화번호입니다." }, { status: 409 });

    const now = new Date();
    const hashed = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        loginId:          phone,
        password:         hashed,
        userName:         name,
        phoneNumber:      phone,
        role:             "COACH",
        status:           "ACTIVE",
        planType:         "FREE",
        isTemporary:      false,
        consentTermsAt:   consentTerms    ? now : null,
        consentPrivacyAt: consentPrivacy  ? now : null,
        consentLocationAt:consentLocation ? now : null,
      },
    });

    // 인증 기록 정리
    await prisma.phoneVerification.deleteMany({ where: { phoneNumber: phone } });

    // 자동 로그인
    const token = await signWorkerToken({ userId: user.id.toString(), userName: user.userName, isTemporary: false });
    const res = NextResponse.json({ success: true, userId: user.id.toString() });
    res.cookies.set(WORKER_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (err) {
    console.error("[worker/auth/signup]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
