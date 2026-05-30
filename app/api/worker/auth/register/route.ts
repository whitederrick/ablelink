// app/api/worker/auth/register/route.ts
// 직무지도원 초대 코드 기반 회원가입 (OTP 없이 초대 코드로 신원 확인)

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

const PHONE_RE = /^01[0-9]{8,9}$/;
const MIN_PW_LEN = 8;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const loginId     = String(body?.loginId     ?? "").trim().replace(/-/g, "");
    const password    = String(body?.password    ?? "");
    const workerName    = String(body?.workerName    ?? "").trim();
    const phoneNumber = String(body?.phoneNumber ?? "").trim().replace(/-/g, "");
    const inviteCode  = String(body?.inviteCode  ?? "").trim();

    if (!loginId || !password || !workerName || !phoneNumber) {
      return NextResponse.json({ success: false, message: "모든 필드를 입력해주세요." }, { status: 400 });
    }
    if (!PHONE_RE.test(loginId)) {
      return NextResponse.json({ success: false, message: "아이디는 휴대전화번호 형식이어야 합니다." }, { status: 400 });
    }
    if (password.length < MIN_PW_LEN) {
      return NextResponse.json({ success: false, message: `비밀번호는 ${MIN_PW_LEN}자 이상이어야 합니다.` }, { status: 400 });
    }
    if (workerName.length < 2) {
      return NextResponse.json({ success: false, message: "이름은 2자 이상이어야 합니다." }, { status: 400 });
    }

    // 초대 코드 검증 (없으면 /api/worker/auth/signup 사용 필요)
    if (!inviteCode) {
      return NextResponse.json({ success: false, message: "초대 코드가 필요합니다." }, { status: 400 });
    }
    const invite = await prisma.workerInvite.findFirst({
      where: { code: inviteCode, phoneNumber, usedAt: null },
    });
    if (!invite || invite.expiresAt < new Date()) {
      return NextResponse.json({ success: false, message: "유효하지 않은 초대 코드입니다." }, { status: 400 });
    }

    const existing = await prisma.worker.findUnique({ where: { loginId } });
    if (existing) {
      return NextResponse.json({ success: false, message: "이미 가입된 전화번호입니다." }, { status: 409 });
    }

    const hashed = await hashPassword(password);

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.worker.create({
        data: { loginId, password: hashed, workerName, phoneNumber, role: "WORKER", status: "ACTIVE", planType: "FREE" },
      });
      await tx.workerInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedByWorkerId: user.id },
      });
      return user;
    });

    return NextResponse.json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      user: { id: newUser.id.toString(), workerName: newUser.workerName },
    });
  } catch (error) {
    console.error("[worker/auth/register]", error);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
