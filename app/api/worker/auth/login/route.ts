// app/api/worker/auth/login/route.ts
// 직무지도원 로그인 API
// 🔐 보안: bcrypt 비밀번호 검증 + Rate limiting + JWT 쿠키 세션

export const runtime = "nodejs";

import { getRateLimitIp } from "@/lib/clientIp";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit, resetRateLimit } from "@/lib/rateLimit";
import { signWorkerToken, WORKER_COOKIE, workerCookieOptions } from "@/app/worker/_lib/session";

export async function POST(request: Request) {
  try {
    // 빈/비정상 본문(프리페치·중복요청 등)에도 JSON.parse가 throw하지 않도록 방어 — 이후 필수값 검사로 400 처리.
    const body = await request.json().catch(() => ({}));
    const loginId = String(body?.loginId ?? "").trim();
    const password = String(body?.password ?? "");

    if (!loginId || !password) {
      return NextResponse.json(
        { success: false, message: "아이디와 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    // 🔐 Rate limiting 2중 — ①IP 전역 예산(admin/manager와 동일 축): 한 IP가 여러 계정을 순회하는
    //  패스워드 스프레이 차단(계정별 키만 있으면 계정마다 예산이 새로 생겨 미차단). 여러 워커가 사무실
    //  공유 IP(NAT)로 동시 로그인하는 정상 사용을 막지 않도록 예산은 계정별보다 느슨하게. 성공해도
    //  리셋하지 않는다(성공 로그인 사이에 스프레이를 끼워 은폐하는 것 방지).
    const ip = getRateLimitIp(request) ?? "unknown";
    const ipRl = await checkRateLimit(`login-ip:${ip}`, { max: 30, windowSec: 15 * 60, blockSec: 30 * 60 });
    if (!ipRl.allowed) {
      const retryAfterSec = Math.ceil((ipRl.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { success: false, message: `로그인 시도가 너무 많습니다. ${Math.ceil(retryAfterSec / 60)}분 후 다시 시도해주세요.` },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }
    // ②IP+계정 조합(기존): 특정 계정 집중 브루트포스 차단(성공 시 리셋).
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
    const user = await prisma.worker.findUnique({ where: { loginId } });

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
        { success: false, message: "비활성화된 계정입니다. 담당 위탁기관에 문의하세요." },
        { status: 403 }
      );
    }

    // 로그인 성공 → rate limit 초기화
    await resetRateLimit(rateLimitKey);

    // 활동(휴면) 상태 판정용 마지막 로그인 시각 갱신
    await prisma.worker.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch((e) => { console.error("[worker/login lastLoginAt]", e); });

    // 활성 배정 조회
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeAssignment = await prisma.siteAssignment.findFirst({
      where: {
        workerId: user.id,
        status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: { site: true, agency: true },
      orderBy: { startDate: "desc" },
    });

    // JWT 발급
    const token = await signWorkerToken({
      workerId: user.id.toString(),
      workerName: user.workerName,
      isTemporary: user.isTemporary,
    });

    const res = NextResponse.json({
      success: true,
      user: {
        id: user.id.toString(),
        workerName: user.workerName,
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

    // 🔐 HttpOnly 쿠키로 토큰 저장 (XSS 방어). 90일 + 앱 사용 시 롤링 갱신.
    res.cookies.set(WORKER_COOKIE, token, workerCookieOptions());

    return res;
  } catch (error) {
    console.error("[worker/auth/login]", error);
    return NextResponse.json(
      { success: false, message: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
