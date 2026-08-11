// 위탁기관 관리자 전용 로그인 (Manager 테이블 — managers)
export const runtime = "nodejs";

import { getRateLimitIp } from "@/lib/clientIp";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { attachManagerSessionCookieToResponse } from "@/lib/managerCookies";
import { checkRateLimit, resetRateLimit, accountRateLimitKey, ACCOUNT_LOGIN_POLICY } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const ip = getRateLimitIp(req) ?? "unknown";
    const rl = await checkRateLimit(`manager-login:${ip}`);
    if (!rl.allowed) {
      const secs = Math.ceil((rl.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { success: false, message: `너무 많은 시도입니다. ${secs}초 후 다시 시도하세요.` },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const loginId  = String(body?.loginId  ?? "").trim();
    const password = String(body?.password ?? "");

    if (!loginId || !password)
      return NextResponse.json({ success: false, message: "loginId와 password가 필요합니다." }, { status: 400 });

    // 🔐 ②계정 축(B-2): IP 축만으로는 분산 IP에서 한 계정을 집중 공격할 때 예산이 누적되지 않는다.
    //  DB 조회 '전에' 검사해 존재하지 않는 계정도 동일하게 적용한다(429/401 패턴으로 계정 열거 불가).
    const acctKey = accountRateLimitKey("manager-login-acct", loginId);
    const acctRl = await checkRateLimit(acctKey, ACCOUNT_LOGIN_POLICY);
    if (!acctRl.allowed) {
      const secs = Math.ceil((acctRl.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { success: false, message: `너무 많은 시도입니다. ${secs}초 후 다시 시도하세요.` },
        { status: 429, headers: { "Retry-After": String(secs) } }
      );
    }

    const manager = await prisma.manager.findUnique({ where: { loginId } });
    // 타이밍 공격 방지: '유효한 60자' 더미 해시(cost 12=실해시와 동일)로 계정 부재 시에도 bcrypt 전 연산 수행.
    //  이전 상수는 60자가 아니라 bcryptjs가 KDF를 건너뛰어 계정 존재가 응답 시간으로 노출됐다.
    const hashToCompare = manager?.passwordHash ?? "$2b$12$vhWvgCV2BKFUKcayK8/3.OyHIPERoDzZkUlivnq07xkeDWJEQCeDu";
    const ok = await bcrypt.compare(password, hashToCompare);

    if (!manager || !manager.isActive || !ok)
      return NextResponse.json({ success: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });

    // 로그인 성공 → 계정 축만 초기화. IP 축은 초기화하지 않는다 — 성공 로그인을 사이에 끼워 스프레이를
    //  은폐하는 것을 막기 위함(worker 로그인과 동일 규칙).
    await resetRateLimit(acctKey);

    await prisma.manager.update({ where: { id: manager.id }, data: { lastLoginAt: new Date() } });

    const res = NextResponse.json({ success: true });
    await attachManagerSessionCookieToResponse(res, {
      sub:      manager.id.toString(),
      agencyId: manager.agencyId.toString(),
      loginId:  manager.loginId,
      sv:       manager.sessionVersion,
    });
    return res;
  } catch (e: any) {
    console.error("[manager/auth/login]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
