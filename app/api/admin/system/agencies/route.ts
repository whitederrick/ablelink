// 시스템 운영자 전용: 에이전시 목록 조회 + 신규 생성
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { logAudit } from "@/lib/auditLog";
import bcrypt from "bcryptjs";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);

    const agencies = await prisma.agency.findMany({
      include: {
        _count: { select: { managerAccounts: true, sites: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      agencies: agencies.map(a => ({
        id:          a.id.toString(),
        name:        a.name,
        planType:    a.planType,
        trialEndsAt: (a as any).trialEndsAt?.toISOString() ?? null,
        nextBillingAt: (a as any).nextBillingAt?.toISOString() ?? null,
        subscribedAt:  (a as any).subscribedAt?.toISOString() ?? null,
        maxCoaches:  a.maxCoaches,
        maxSites:    a.maxSites,
        createdAt:   a.createdAt.toISOString(),
        managerCount: a._count.managerAccounts,
        siteCount:    a._count.sites,
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
    const { name, planType, managerLoginId, managerPassword, managerDisplayName } = body;

    if (!name?.trim()) return NextResponse.json({ success: false, message: "에이전시 이름은 필수입니다." }, { status: 400 });
    if (!managerLoginId?.trim() || !managerPassword) {
      return NextResponse.json({ success: false, message: "최초 관리자 계정 정보가 필요합니다." }, { status: 400 });
    }

    const exists = await prisma.agency.findUnique({ where: { name: name.trim() } });
    if (exists) return NextResponse.json({ success: false, message: "이미 존재하는 에이전시 이름입니다." }, { status: 409 });

    // ManagerUser 테이블에서 중복 확인
    const loginExists = await prisma.manager.findUnique({ where: { loginId: managerLoginId.trim() } });
    if (loginExists) return NextResponse.json({ success: false, message: "이미 사용 중인 관리자 아이디입니다." }, { status: 409 });

    const passwordHash = await bcrypt.hash(managerPassword, 12);

    const agency = await prisma.$transaction(async (tx) => {
      const ag = await tx.agency.create({
        data: { name: name.trim(), planType: planType || "FREE" },
      });
      // AdminUser(ADMIN)와 완전 분리 — ManagerUser(managers) 테이블에 생성
      await tx.manager.create({
        data: {
          loginId:     managerLoginId.trim(),
          passwordHash,
          displayName: managerDisplayName?.trim() || null,
          agencyId:    ag.id,
        },
      });
      return ag;
    });

    await logAudit({
      adminId: scope.adminId,
      action: "AGENCY_CREATED",
      target: `Agency:${agency.id}`,
      detail: { name: agency.name, planType, managerLoginId },
    });

    return NextResponse.json({ success: true, id: agency.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
