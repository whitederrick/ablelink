// app/api/worker/auth/register/route.ts
// 직무지도원 회원가입
// 🔐 보안: bcrypt 해싱, 입력값 검증

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

const PHONE_RE = /^01[0-9]{8,9}$/;
const MIN_PW_LEN = 8;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const loginId = String(body?.loginId ?? "").trim().replace(/-/g, "");
    const password = String(body?.password ?? "");
    const userName = String(body?.userName ?? "").trim();
    const phoneNumber = String(body?.phoneNumber ?? "").trim().replace(/-/g, "");

    // 입력 검증
    if (!loginId || !password || !userName || !phoneNumber) {
      return NextResponse.json(
        { success: false, message: "모든 필드를 입력해주세요." },
        { status: 400 }
      );
    }

    if (!PHONE_RE.test(loginId)) {
      return NextResponse.json(
        { success: false, message: "아이디는 휴대전화번호 형식이어야 합니다. (예: 01012345678)" },
        { status: 400 }
      );
    }

    if (password.length < MIN_PW_LEN) {
      return NextResponse.json(
        { success: false, message: `비밀번호는 ${MIN_PW_LEN}자 이상이어야 합니다.` },
        { status: 400 }
      );
    }

    if (userName.length < 2) {
      return NextResponse.json(
        { success: false, message: "이름은 2자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    // 중복 확인
    const existing = await prisma.worker.findUnique({ where: { loginId } });
    if (existing) {
      return NextResponse.json(
        { success: false, message: "이미 가입된 전화번호입니다." },
        { status: 409 }
      );
    }

    // 🔐 bcrypt 해싱
    const hashed = await hashPassword(password);

    const newUser = await prisma.worker.create({
      data: {
        loginId,
        password: hashed,
        userName,
        phoneNumber,
        role: "COACH",
        status: "ACTIVE",
        planType: "FREE",
      },
    });

    return NextResponse.json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      user: {
        id: newUser.id.toString(),
        userName: newUser.userName,
        phoneNumber: newUser.phoneNumber,
      },
    });
  } catch (error) {
    console.error("[worker/auth/register]", error);
    return NextResponse.json(
      { success: false, message: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
