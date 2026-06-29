// app/api/admin/system/agencies/[id]/manager-invite/route.ts
// 시스템 운영자 전용: 위탁기관 관리자 초대 코드 발급

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { sendSimpleEmail } from "@/lib/email";
import crypto from "crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const agencyId = parseBigInt(id);
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "잘못된 위탁기관 ID입니다." }, { status: 400 });
    }

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { id: true, name: true },
    });

    if (!agency) {
      return NextResponse.json({ success: false, message: "위탁기관를 찾을 수 없습니다." }, { status: 404 });
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

    // 이메일이 입력된 경우 초대 링크를 자동 발송
    let emailSent = false;
    let emailError: string | null = null;
    if (email) {
      if (!EMAIL_RE.test(email)) {
        emailError = "이메일 형식이 올바르지 않아 발송하지 못했습니다. (링크는 발급됨)";
      } else {
        try {
          await sendSimpleEmail({
            to: email,
            subject: `[Able-Link] ${agency.name} 관리자 초대`,
            text:
              `${agency.name} 위탁기관 관리자로 초대되었습니다.\n\n` +
              `아래 링크에서 7일 이내에 가입을 완료해주세요.\n${inviteUrl}\n\n` +
              `만료: ${invite.expiresAt.toLocaleString("ko-KR")}\n\n` +
              `— Able-Link`,
          });
          emailSent = true;
        } catch (err: any) {
          console.error("[manager-invite email]", err);
          emailError = "메일 발송에 실패했습니다. 링크를 복사해 직접 전달해주세요. (링크는 발급됨)";
        }
      }
    }

    return NextResponse.json({
      success:   true,
      id:        String(invite.id),
      code:      invite.code,
      inviteUrl,
      email:     invite.email ?? null,
      emailSent,
      emailError,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/agencies/[id]/manager-invite POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
