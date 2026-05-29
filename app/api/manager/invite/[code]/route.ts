// app/api/manager/invite/[code]/route.ts
// 초대 코드 기반 관리자 계정 가입

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { attachManagerSessionCookieToResponse } from "@/lib/managerCookies";

type Params = { params: Promise<{ code: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { code } = await params;

    const invite = await prisma.managerInvite.findUnique({
      where: { code },
      select: {
        id:        true,
        usedAt:    true,
        expiresAt: true,
        email:     true,
        agency: { select: { name: true } },
      },
    });

    if (!invite) {
      return NextResponse.json(
        { success: false, message: "유효하지 않은 초대 코드입니다." },
        { status: 410 }
      );
    }

    if (invite.usedAt) {
      return NextResponse.json(
        { success: false, message: "이미 사용된 초대 코드입니다." },
        { status: 410 }
      );
    }

    if (invite.expiresAt < new Date()) {
      return NextResponse.json(
        { success: false, message: "만료된 초대 코드입니다." },
        { status: 410 }
      );
    }

    return NextResponse.json({
      success:    true,
      agencyName: invite.agency.name,
      email:      invite.email ?? null,
      expiresAt:  invite.expiresAt.toISOString(),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[manager/invite/[code] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { code } = await params;

    const invite = await prisma.managerInvite.findUnique({
      where: { code },
      select: {
        id:        true,
        agencyId:  true,
        usedAt:    true,
        expiresAt: true,
        email:     true,
      },
    });

    if (!invite) {
      return NextResponse.json(
        { success: false, message: "유효하지 않은 초대 코드입니다." },
        { status: 410 }
      );
    }

    if (invite.usedAt) {
      return NextResponse.json(
        { success: false, message: "이미 사용된 초대 코드입니다." },
        { status: 410 }
      );
    }

    if (invite.expiresAt < new Date()) {
      return NextResponse.json(
        { success: false, message: "만료된 초대 코드입니다." },
        { status: 410 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const loginId     = String(body?.loginId ?? "").trim();
    const password    = String(body?.password ?? "");
    const displayName = body?.displayName != null ? String(body.displayName).trim() : null;
    const phoneNumber = body?.phoneNumber != null ? String(body.phoneNumber).trim() : null;

    if (loginId.length < 4) {
      return NextResponse.json(
        { success: false, message: "아이디는 4자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: "비밀번호는 8자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    // 중복 loginId 확인
    const existingManager = await prisma.manager.findUnique({
      where: { loginId },
      select: { id: true },
    });
    if (existingManager) {
      return NextResponse.json(
        { success: false, message: "이미 사용 중인 아이디입니다." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Manager 생성 + ManagerInvite 업데이트 트랜잭션
    const manager = await prisma.$transaction(async (tx) => {
      const newManager = await tx.manager.create({
        data: {
          loginId,
          passwordHash,
          displayName: displayName || null,
          agencyId:    invite.agencyId,
          isActive:    true,
        },
        select: { id: true, agencyId: true, loginId: true },
      });

      await tx.managerInvite.update({
        where: { id: invite.id },
        data: {
          usedAt:    new Date(),
          managerId: newManager.id,
        },
      });

      return newManager;
    });

    const res = NextResponse.json({
      success:   true,
      managerId: String(manager.id),
      agencyId:  String(manager.agencyId),
    });

    await attachManagerSessionCookieToResponse(res, {
      sub:      manager.id.toString(),
      agencyId: manager.agencyId.toString(),
      loginId:  manager.loginId,
    });

    return res;
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[manager/invite/[code] POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
