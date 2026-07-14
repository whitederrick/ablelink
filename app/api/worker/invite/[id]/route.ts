// GET  /api/worker/invite/[id] — 초대 정보 조회
// POST /api/worker/invite/[id] — 초대 코드 인증 + 계정 생성

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { signWorkerToken, WORKER_COOKIE } from "@/app/worker/_lib/session";
import { checkRateLimit } from "@/lib/rateLimit";
import { getRateLimitIp } from "@/lib/clientIp";
import type { Prisma } from "@prisma/client";

// 표시용 전화번호 마스킹 — 비인증 GET이 순차 id 열거로 실전화번호를 수집당하지 않도록.
function maskPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length < 7) return "***";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // 무차별 열거 방어: 신뢰 IP(조작 불가) 기준 레이트리밋. IP 없으면 id별로라도 제한.
    const rl = await checkRateLimit(`invite-view:${getRateLimitIp(req) ?? id}`);
    if (!rl.allowed) {
      const mins = Math.ceil((rl.retryAfterMs ?? 0) / 60000);
      return NextResponse.json({ success: false, message: `요청이 너무 많습니다. ${mins}분 후 다시 시도해주세요.` }, { status: 429 });
    }

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
        phoneNumber: maskPhone(invite.phoneNumber), // 마스킹 표시(가입은 서버측 실번호 사용)
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
    // 무차별 대입 방어: 초대 ID당 코드 검증/가입 시도 횟수 제한
    const rl = await checkRateLimit(`worker-invite:${id}`);
    if (!rl.allowed) {
      const mins = Math.ceil((rl.retryAfterMs ?? 0) / 60000);
      return NextResponse.json(
        { success: false, message: `시도가 너무 많습니다. ${mins}분 후 다시 시도해주세요.` },
        { status: 429 },
      );
    }

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
    const workerName = String(body?.workerName ?? "").trim();
    const password = String(body?.password ?? "");
    const consentTerms    = body?.consentTerms    === true;
    const consentPrivacy  = body?.consentPrivacy  === true;
    const consentLocation = body?.consentLocation === true;

    if (!code || code.length !== 6)       return NextResponse.json({ success: false, message: "인증번호 6자리를 입력해주세요." }, { status: 400 });
    if (workerName.length < 2)              return NextResponse.json({ success: false, message: "이름은 2자 이상이어야 합니다." }, { status: 400 });
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

    const existing = await prisma.worker.findUnique({ where: { loginId: invite.phoneNumber } });
    if (existing) return NextResponse.json({ success: false, message: "이미 가입된 전화번호입니다." }, { status: 409 });

    const now = new Date();
    const hashed = await hashPassword(password);

    let siteAssigned = false;
    const runCreate = async (tx: Prisma.TransactionClient) => {
      const newUser = await tx.worker.create({
        data: {
          loginId:           invite.phoneNumber,
          password:          hashed,
          workerName,
          phoneNumber:       invite.phoneNumber,
          role:              "WORKER",
          status:            "ACTIVE",
          planType:          "FREE",
          isTemporary:       false,
          consentTermsAt:    consentTerms    ? now : null,
          consentPrivacyAt:  consentPrivacy  ? now : null,
          consentLocationAt: consentLocation ? now : null,
        },
      });

      // siteId가 있으면 SiteAssignment 자동 생성. ★invite는 매니저가 자기 현장(생성측 소유검증 P1)에 직접 온보딩하는
      //  행위라 정원으로 막지 않는다 — 비동기(수락 시점) 온보딩을 정원으로 무성(silent) 스킵하면 매니저가 신호 없이
      //  온보딩 실패를 겪는다(19차에 chokepoint 편입한 게 과했음). 정원 초과분은 매니저가 배정 관리에서 조정.
      if (invite.siteId) {
        await tx.siteAssignment.create({
          data: {
            workerId:  newUser.id,
            siteId:    invite.siteId,
            agencyId:  invite.agencyId,
            startDate: now,
            // 파이프라인: 초대 수락=ASSIGNED(계약 대기). 계약 서명→CONFIRMED, 연결+위치확정→ACTIVE.
            status:    "ASSIGNED",
            workType:  "FULL_DAY", // 슬롯 미정이면 정원 집계에서 안 보이는 유령배정이 되므로 기본 FULL_DAY(매니저 PATCH로 변경).
            commuteGuidanceIncluded: false,
          },
        });
        siteAssigned = true;
      }

      await tx.workerInvite.update({
        where: { id: invite.id },
        data: { usedAt: now, usedByWorkerId: newUser.id },
      });
      return newUser;
    };
    const user = await prisma.$transaction(runCreate);

    const token = await signWorkerToken({ workerId: user.id.toString(), workerName: user.workerName, isTemporary: false });
    const res = NextResponse.json({ success: true, workerId: user.id.toString(), hasSite: siteAssigned });
    res.cookies.set(WORKER_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (err) {
    console.error("[worker/invite/[id]]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
