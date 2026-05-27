// app/api/admin/payroll/contracts/route.ts
// 급여 계약 목록 조회 + 등록

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId && scope.role !== "ADMIN") {
      return NextResponse.json({ success: false, message: "에이전시 정보 없음" }, { status: 403 });
    }

    const where = agencyId ? { agencyId } : {};

    const contracts = await prisma.payContract.findMany({
      where,
      include: {
        user: { select: { id: true, userName: true, loginId: true } },
      },
      orderBy: [{ userId: "asc" }, { effectiveFrom: "desc" }],
    });

    return NextResponse.json({
      success: true,
      data: contracts.map(c => ({
        id: c.id.toString(),
        userId: c.userId.toString(),
        userName: c.user.userName,
        loginId: c.user.loginId,
        agencyId: c.agencyId.toString(),
        payType: c.payType,
        baseAmount: Number(c.baseAmount),
        currency: c.currency,
        effectiveFrom: c.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: c.effectiveTo ? c.effectiveTo.toISOString().slice(0, 10) : null,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "에이전시 정보 없음" }, { status: 403 });
    }

    const body = await req.json();
    const { userId, payType, baseAmount, effectiveFrom, effectiveTo } = body;

    if (!userId || !payType || !baseAmount || !effectiveFrom) {
      return NextResponse.json({ success: false, message: "필수 항목 누락" }, { status: 400 });
    }
    if (!["MONTHLY", "DAILY", "HOURLY"].includes(payType)) {
      return NextResponse.json({ success: false, message: "payType 오류" }, { status: 400 });
    }

    // 기존 유효 계약 종료 처리
    if (effectiveTo === undefined || effectiveTo === null) {
      await prisma.payContract.updateMany({
        where: { agencyId, userId: BigInt(userId), effectiveTo: null },
        data: { effectiveTo: new Date(effectiveFrom) },
      });
    }

    const contract = await prisma.payContract.create({
      data: {
        agencyId,
        userId: BigInt(userId),
        payType,
        baseAmount,
        currency: "KRW",
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
    });

    return NextResponse.json({ success: true, id: contract.id.toString() });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
