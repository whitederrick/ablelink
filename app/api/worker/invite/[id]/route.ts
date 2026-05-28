// GET  /api/worker/invite/[id] — 초대 정보 조회
// POST /api/worker/invite/[id] — 초대 코드 인증 + 계정 생성

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { signWorkerToken, WORKER_COOKIE } from "@/app/worker/_lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const invite = await prisma.workerInvite.findUnique({
      where: { id: BigInt(id) },
      include: { agency: { select: { name: true } }, site: { select: { companyName: true } } },
    });

    if (!invite) return NextResponse.json({ success: false, message: "초대 링크가 유효하지 않습니다." }, { status: 404 });
    if (invite.usedAt) return NextResponse.json({ success: false, message: "이미 사용된 초대 링크입니다." }, { status: 410 });
    if (invite.expiresAt < new Date()) return NextResponse.json({ success: false, message: "만료된 초대 링크입니다." }, { status: 410 });

    return NextResponse.json({
      success: true,
      invite: {
        agencyName:  invite.agency.name,
        siteName:    invite.site?.companyName ?? null,
        phoneNumber: invite.phoneNumber,
        workerName:  invite.workerName ?? null,
        expiresAt:   invite.expiresAt.toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body   = await request.json();
    const action = String(body?.action ?? "signup");
    const code   = String(body?.code ?? "").trim();

    // ── action: "verify" — 코드만 확인, 계정 생성 없음 ──────────
    if (action === "verify") {
      if (!code || code.length !== 6) return NextResponse.json({ success: false, message: "6자리 인증번호를 입력해주세요." }, { status: 400 });
      const invite = await prisma.workerInvite.findUnique({ where: { id: BigInt(id) } });
      if (!invite)                     return NextResponse.json({ success: false, message: "초대 링크가 유효하지 않습니다." }, { status: 404 });
      if (invite.usedAt)               return NextResponse.json({ success: false, message: "이미 사용된 초대 링크입니다." }, { status: 410 });
      if (invite.expiresAt < new Date()) return NextResponse.json({ success: false, message: "만료된 초대 링크입니다." }, { status: 410 });
      if (invite.code !== code)        return NextResponse.json({ success: false, message: "인증번호가 올바르지 않습니다." }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    // ── action: "signup" — 계정 생성 ────────────────────────────
    const userName = String(body?.userName ?? "").trim();
    const password = String(body?.password ?? "");
    const consentTerms    = body?.consentTerms    === true;
    const consentPrivacy  = body?.consentPrivacy  === true;
    const consentLocation = body?.consentLocation === true;

    if (!code || code.length !== 6)       return NextResponse.json({ success: false, message: "인증번호 6자리를 입력해주세요." }, { status: 400 });
    if (userName.length < 2)              return NextResponse.json({ success: false, message: "이름은 2자 이상이어야 합니다." }, { status: 400 });
    if (password.length < 8)             return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    if (!consentTerms || !consentPrivacy) return NextResponse.json({ success: false, message: "필수 약관에 동의해주세요." }, { status: 400 });

    const invite = await prisma.workerInvite.findUnique({
      where: { id: BigInt(id) },
      include: { agency: { select: { name: true } } },
    });

    if (!invite)                       return NextResponse.json({ success: false, message: "초대 링크가 유효하지 않습니다." }, { status: 404 });
    if (invite.usedAt)                 return NextResponse.json({ success: false, message: "이미 사용된 초대 링크입니다." }, { status: 410 });
    if (invite.expiresAt < new Date()) return NextResponse.json({ success: false, message: "만료된 초대 링크입니다." }, { status: 410 });
    if (invite.code !== code)          return NextResponse.json({ success: false, message: "인증번호가 올바르지 않습니다." }, { status: 400 });

    const existing = await prisma.user.findUnique({ where: { loginId: invite.phoneNumber } });
    if (existing) return NextResponse.json({ success: false, message: "이미 가입된 전화번호입니다." }, { status: 409 });

    const now = new Date();
    const hashed = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          loginId:           invite.phoneNumber,
          password:          hashed,
          userName,
          phoneNumber:       invite.phoneNumber,
          role:              "COACH",
          status:            "ACTIVE",
          planType:          "FREE",
          isTemporary:       false,
          consentTermsAt:    consentTerms    ? now : null,
          consentPrivacyAt:  consentPrivacy  ? now : null,
          consentLocationAt: consentLocation ? now : null,
        },
      });

      // siteId가 있으면 SiteAssignment 자동 생성
      if (invite.siteId) {
        await tx.siteAssignment.create({
          data: {
            userId:    newUser.id,
            siteId:    invite.siteId,
            agencyId:  invite.agencyId,
            startDate: now,
            status:    "ACTIVE",
          },
        });
      }

      await tx.workerInvite.update({
        where: { id: invite.id },
        data: { usedAt: now, usedByUserId: newUser.id },
      });
      return newUser;
    });

    const token = await signWorkerToken({ userId: user.id.toString(), userName: user.userName, isTemporary: false });
    const res = NextResponse.json({ success: true, userId: user.id.toString(), hasSite: !!invite.siteId });
    res.cookies.set(WORKER_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (err) {
    console.error("[worker/invite/[id]]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
