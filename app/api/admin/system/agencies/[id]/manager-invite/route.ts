// app/api/admin/system/agencies/[id]/manager-invite/route.ts
// 시스템 운영자 전용: 에이전시 관리자 초대 코드 발급

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import crypto from "crypto";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const agencyId = parseBigInt(id);
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "잘못된 에이전시 ID입니다." }, { status: 400 });
    }

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { id: true, name: true },
    });

    if (!agency) {
      return NextResponse.json({ success: false, message: "에이전시를 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const email = body?.email != null ? String(body.email).trim() : null;

    const code      = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

    const invite = await prisma.managerInvite.create({
      data: {
        agencyId:   agencyId,
        code,
        email:      email || null,
        expiresAt,
        createdById: scope.adminId,
      },
      select: {
        id:        true,
        code:      true,
        email:     true,
        expiresAt: true,
        createdAt: true,
      },
    });

    const appUrl     = process.env.NEXT_PUBLIC_APP_URL || "https://able-link.co.kr";
    const inviteUrl  = `${appUrl}/manager/invite/${invite.code}`;

    return NextResponse.json({
      success:   true,
      id:        String(invite.id),
      code:      invite.code,
      inviteUrl,
      email:     invite.email ?? null,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/agencies/[id]/manager-invite POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
