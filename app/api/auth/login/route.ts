// app/api/auth/login/route.ts
// 로그인 처리 API 엔드포인트

// app/api/auth/login/route.ts
// 로그인 처리 API 엔드포인트

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const loginId = String(body?.loginId || "").trim();
    const password = String(body?.password || "");

    console.log(`[로그인 시도] ID: ${loginId}`);

    if (!loginId || !password) {
      return NextResponse.json(
        { success: false, message: "아이디와 비밀번호를 입력해 주세요." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { loginId },
    });

    if (!user || user.password !== password) {
      return NextResponse.json(
        { success: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." },
        { status: 401 }
      );
    }

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const activeAssignment = await prisma.siteAssignment.findFirst({
      where: {
        userId: user.id,
        status: "ACTIVE",
        startDate: {
          lte: startOfToday,
        },
        OR: [
          { endDate: null },
          {
            endDate: {
              gte: startOfToday,
            },
          },
        ],
      },
      include: {
        site: true,
      },
      orderBy: {
        startDate: "desc",
      },
    });

    console.log("체크 기준 날짜:", startOfToday);
    console.log("찾은 배정 정보 존재 여부:", !!activeAssignment);

    const { password: _, ...userInfo } = user;

    return NextResponse.json({
      success: true,
      message: "로그인 성공",
      user: userInfo,
      hasActiveSite: !!activeAssignment,
      activeAssignment: activeAssignment
        ? {
            id: activeAssignment.id.toString(),
            siteId: activeAssignment.siteId?.toString?.() ?? null,
            site: activeAssignment.site,
          }
        : null,
    });
  } catch (error) {
    console.error("로그인 에러:", error);
    return NextResponse.json(
      { success: false, message: "서버 에러가 발생했습니다." },
      { status: 500 }
    );
  }
}