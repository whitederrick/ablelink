// app/api/admin/payroll/deductions/route.ts
// 에이전시 커스텀 공제 항목 CRUD

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "에이전시 정보 없음" }, { status: 403 });
    }

    const deductions = await prisma.agencyDeduction.findMany({
      where: { agencyId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      data: deductions.map(d => ({
        id: d.id.toString(),
        name: d.name,
        type: d.type,
        amount: Number(d.amount),
        isActive: d.isActive,
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
    const { name, type, amount } = body;

    if (!name || !type || amount == null) {
      return NextResponse.json({ success: false, message: "필수 항목 누락" }, { status: 400 });
    }
    if (!["FIXED", "PERCENTAGE"].includes(type)) {
      return NextResponse.json({ success: false, message: "type은 FIXED 또는 PERCENTAGE여야 합니다." }, { status: 400 });
    }
    if (type === "PERCENTAGE" && (Number(amount) < 0 || Number(amount) > 1)) {
      return NextResponse.json({ success: false, message: "비율은 0~1 사이여야 합니다. (예: 1% = 0.01)" }, { status: 400 });
    }

    const deduction = await prisma.agencyDeduction.create({
      data: { agencyId, name, type, amount },
    });

    return NextResponse.json({ success: true, id: deduction.id.toString() });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
