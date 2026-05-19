// app/api/auth/register/route.ts
// 회원가입 처리 API 엔드포인트

export const runtime = "nodejs";

import { NextResponse } from 'next/server';
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { loginId, password, userName, phoneNumber } = body;

    // 1. 중복 가입 체크
    const existingUser = await prisma.user.findUnique({
      where: { loginId },
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, message: '이미 가입된 아이디(전화번호)입니다.' },
        { status: 400 }
      );
    }

    // 2. 유저 생성 (스키마의 Enum 타입 반영)
    const newUser = await prisma.user.create({
      data: {
        loginId,
        password, // 현재는 직접 저장 (운영 시에는 bcrypt 등으로 암호화 권장)
        userName,
        phoneNumber,
        role: 'COACH',    // Enum: UserRole.COACH
        status: 'ACTIVE', // Enum: UserStatus.ACTIVE
      },
    });

    const { password: _, ...userInfo } = newUser;

    return NextResponse.json({
      success: true,
      message: '회원가입 성공!',
      user: userInfo,
    });
  } catch (error) {
    console.error('Registration Error:', error);
    return NextResponse.json({ success: false, message: '서버 오류 발생' }, { status: 500 });
  }
}