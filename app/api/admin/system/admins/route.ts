// 시스템 운영자 전용: 어드민 계정 목록 조회 + 신규 생성
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import bcrypt from "bcryptjs";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);
    if (scope.role !== "ADMIN") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const admins = await prisma.adminUser.findMany({
      include: { agency: { select: { id: true, name: true, planType: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      admins: admins.map(a => ({
        id:          a.id.toString(),
        loginId:     a.loginId,
        role:        a.role,
        displayName: a.displayName ?? "",
        agencyId:    a.agencyId?.toString() ?? null,
        agencyName:  a.agency?.name ?? a.agencyName ?? null,
        planType:    a.agency?.planType ?? null,
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
    if (scope.role !== "ADMIN") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const body = await req.json();
    const { loginId, password, role, displayName, agencyId } = body;

    if (!loginId?.trim() || !password || !role) {
      return NextResponse.json({ success: false, message: "loginId, password, role은 필수입니다." }, { status: 400 });
    }
    if (!["ADMIN", "AGENCY"].includes(role)) {
      return NextResponse.json({ success: false, message: "role은 ADMIN 또는 AGENCY여야 합니다." }, { status: 400 });
    }
    if (role === "AGENCY" && !agencyId) {
      return NextResponse.json({ success: false, message: "AGENCY 역할은 agencyId가 필요합니다." }, { status: 400 });
    }

    const exists = await prisma.adminUser.findUnique({ where: { loginId: loginId.trim() } });
    if (exists) return NextResponse.json({ success: false, message: "이미 사용 중인 아이디입니다." }, { status: 409 });

    const passwordHash = await bcrypt.hash(password, 12);
    const agency = agencyId ? await prisma.agency.findUnique({ where: { id: BigInt(agencyId) }, select: { name: true } }) : null;

    const admin = await prisma.adminUser.create({
      data: {
        loginId:     loginId.trim(),
        passwordHash,
        role,
        displayName: displayName?.trim() || null,
        agencyId:    agencyId ? BigInt(agencyId) : null,
        agencyName:  agency?.name ?? null,
      },
    });

    return NextResponse.json({ success: true, id: admin.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
