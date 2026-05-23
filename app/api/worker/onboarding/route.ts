// app/api/worker/onboarding/route.ts
// 직무지도원 최초 로그인 온보딩: 아이디 확정 + 비밀번호 변경

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";
import { getWorkerSessionFromReq, signWorkerToken, WORKER_COOKIE } from "@/app/worker/_lib/session";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "ap-northeast-2" });
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

async function getSession(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) throw new Response(JSON.stringify({ success: false, message: "인증이 필요합니다." }), { status: 401 });
  return session;
}

// GET: 현재 유저 정보 반환 (온보딩 페이지 초기 데이터)
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    const user = await prisma.user.findUnique({
      where: { id: BigInt(session.userId) },
      select: { loginId: true, userName: true, phoneNumber: true, isTemporary: true },
    });
    if (!user) return NextResponse.json({ success: false, message: "사용자를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ success: true, user });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}

// POST: action 별 처리
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    const userId = BigInt(session.userId);
    const body = await req.json();
    const { action } = body;

    // ── 전화번호를 loginId로 확정 (이미 phone이 loginId이므로 인증 생략) ──
    if (action === "confirm-phone") {
      return NextResponse.json({ success: true });
    }

    // ── 이메일로 loginId 변경 요청 → 인증 코드 발송 ───────────────────
    if (action === "request-email") {
      const { email } = body;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ success: false, message: "올바른 이메일 주소를 입력하세요." }, { status: 400 });
      }

      const conflict = await prisma.user.findFirst({ where: { loginId: email, id: { not: userId } } });
      if (conflict) {
        return NextResponse.json({ success: false, message: "이미 사용 중인 이메일입니다." }, { status: 409 });
      }

      const code = String(randomInt(100000, 999999));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10분

      await prisma.user.update({
        where: { id: userId },
        data: { pendingLoginId: email, verifyCode: code, verifyCodeExpiresAt: expiresAt },
      });

      const fromEmail = process.env.SES_FROM_EMAIL || "noreply@able-link.co.kr";
      await ses.send(new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: "[AbleLink] 이메일 인증 코드", Charset: "UTF-8" },
          Body: {
            Text: {
              Data: `AbleLink 이메일 인증 코드: ${code}\n\n이 코드는 10분간 유효합니다.`,
              Charset: "UTF-8",
            },
          },
        },
      }));

      return NextResponse.json({ success: true, message: "인증 코드가 발송되었습니다." });
    }

    // ── 이메일 인증 코드 확인 ─────────────────────────────────────────
    if (action === "verify-email") {
      const { code } = body;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pendingLoginId: true, verifyCode: true, verifyCodeExpiresAt: true },
      });

      if (!user?.pendingLoginId || !user.verifyCode) {
        return NextResponse.json({ success: false, message: "인증 요청 정보가 없습니다." }, { status: 400 });
      }
      if (new Date() > (user.verifyCodeExpiresAt ?? new Date(0))) {
        return NextResponse.json({ success: false, message: "인증 코드가 만료되었습니다. 다시 요청해 주세요." }, { status: 400 });
      }
      if (code !== user.verifyCode) {
        return NextResponse.json({ success: false, message: "인증 코드가 일치하지 않습니다." }, { status: 400 });
      }

      // 인증 성공 — loginId 변경 (비밀번호 변경은 다음 단계)
      await prisma.user.update({
        where: { id: userId },
        data: {
          loginId: user.pendingLoginId,
          pendingLoginId: null,
          verifyCode: null,
          verifyCodeExpiresAt: null,
        },
      });

      return NextResponse.json({ success: true, newLoginId: user.pendingLoginId });
    }

    // ── 비밀번호 변경 + 온보딩 완료 ─────────────────────────────────
    if (action === "set-password") {
      const { newPassword, confirmPassword } = body;

      if (!newPassword || newPassword.length < 8) {
        return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
      }
      if (newPassword !== confirmPassword) {
        return NextResponse.json({ success: false, message: "비밀번호가 일치하지 않습니다." }, { status: 400 });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          password: await hash(newPassword, 12),
          isTemporary: false,
        },
        select: { id: true, userName: true, phoneNumber: true },
      });

      // 새 JWT 발급 (isTemporary: false)
      const token = await signWorkerToken({
        userId: String(updated.id),
        userName: updated.userName,
        phoneNumber: updated.phoneNumber,
        isTemporary: false,
      });

      const res = NextResponse.json({ success: true, message: "온보딩이 완료되었습니다." });
      res.cookies.set(WORKER_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });
      return res;
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action입니다." }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[onboarding POST]", e);
    return NextResponse.json({ success: false, message: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
