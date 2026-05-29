// app/api/worker/auth/login/route.ts
// 직무지도원 로그인 API
// 🔐 보안: bcrypt 비밀번호 검증 + Rate limiting + JWT 쿠키 세션

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit, resetRateLimit } from "@/lib/rateLimit";
import { signWorkerToken, WORKER_COOKIE } from "@/app/worker/_lib/session";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7일

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const loginId = String(body?.loginId ?? "").trim();
    const password = String(body?.password ?? "");

    if (!loginId || !password) {
      return NextResponse.json(
        { success: false, message: "아이디와 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    // 🔐 Rate limiting: IP + loginId 조합으로 제한
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rateLimitKey = `login:${ip}:${loginId}`;
    const rl = await checkRateLimit(rateLimitKey);

    if (!rl.allowed) {
      const retryAfterSec = Math.ceil((rl.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        {
          success: false,
          message: `로그인 시도가 너무 많습니다. ${Math.ceil(retryAfterSec / 60)}분 후 다시 시도해주세요.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSec) },
        }
      );
    }

    // 사용자 조회
    const user = await prisma.user.findUnique({ where: { loginId } });

    // 🔐 타이밍 공격 방지: 사용자가 없어도 동일한 시간 소요되도록 더미 해시 비교
    const passwordToVerify = user?.password ?? "$2b$12$invalidhashfortimingatk";
    const isValid = await verifyPassword(password, passwordToVerify);

    if (!user || !isValid) {
      return NextResponse.json(
        { success: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." },
        { status: 401 }
      );
    }

    if (user.status !== "ACTIVE") {
      return NextResponse.json(
        { success: false, message: "비활성화된 계정입니다. 담당 에이전시에 문의하세요." },
        { status: 403 }
      );
    }

    // 로그인 성공 → rate limit 초기화
    await resetRateLimit(rateLimitKey);

    // 활성 배정 조회
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeAssignment = await prisma.siteAssignment.findFirst({
      where: {
        userId: user.id,
        status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: { site: true, agency: true },
      orderBy: { startDate: "desc" },
    });

    // JWT 발급
    const token = await signWorkerToken({
      userId: user.id.toString(),
      userName: user.userName,
      isTemporary: user.isTemporary,
    });

    const res = NextResponse.json({
      success: true,
      user: {
        id: user.id.toString(),
        userName: user.userName,
        planType: user.planType,
      },
      hasActiveSite: !!activeAssignment,
      activeAssignment: activeAssignment
        ? {
            id: activeAssignment.id.toString(),
            siteId: activeAssignment.siteId.toString(),
            siteName: activeAssignment.site?.companyName ?? null,
            agencyPlanType: activeAssignment.agency?.planType ?? "FREE",
            trialEndsAt: activeAssignment.agency?.trialEndsAt ?? null,
          }
        : null,
    });

    // 🔐 HttpOnly 쿠키로 토큰 저장 (XSS 방어)
    res.cookies.set(WORKER_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });

    return res;
  } catch (error) {
    console.error("[worker/auth/login]", error);
    return NextResponse.json(
      { success: false, message: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
