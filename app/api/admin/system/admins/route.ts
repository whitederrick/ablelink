// 시스템 운영자 계정 목록 조회 + 신규 생성 (ADMIN 전용)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import bcrypt from "bcryptjs";
import { logAudit } from "@/lib/auditLog";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

    const admins = await prisma.admin.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      admins: admins.map(a => ({
        id:          a.id.toString(),
        loginId:     a.loginId,
        displayName: a.displayName ?? "",
        isActive:    a.isActive,
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
        createdAt:   a.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);

    const body = await req.json();
    const { loginId, password, displayName } = body;

    if (!loginId?.trim() || !password)
      return NextResponse.json({ success: false, message: "loginId와 password는 필수입니다." }, { status: 400 });

    if (password.length < 8)
      return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });

    const exists = await prisma.admin.findUnique({ where: { loginId: loginId.trim() } });
    if (exists) return NextResponse.json({ success: false, message: "이미 사용 중인 아이디입니다." }, { status: 409 });

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.admin.create({
      data: {
        loginId:     loginId.trim(),
        passwordHash,
        displayName: displayName?.trim() || null,
      },
    });

    await logAudit({
      adminId: scope.adminId,
      action:  "ADMIN_CREATED",
      target:  `Admin:${admin.id}`,
      detail:  { loginId: admin.loginId },
    });
    return NextResponse.json({ success: true, id: admin.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
