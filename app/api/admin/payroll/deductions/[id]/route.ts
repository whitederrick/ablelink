// app/api/admin/payroll/deductions/[id]/route.ts
// 에이전시 공제 항목 수정/삭제

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "에이전시 정보 없음" }, { status: 403 });
    }

    const { id: idStr } = await params;
    const id = BigInt(idStr);
    const existing = await prisma.agencyDeduction.findUnique({ where: { id } });
    if (!existing || existing.agencyId !== agencyId) {
      return NextResponse.json({ success: false, message: "항목을 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await req.json();
    const { name, type, amount, isActive } = body;

    if (type && !["FIXED", "PERCENTAGE"].includes(type)) {
      return NextResponse.json({ success: false, message: "type 오류" }, { status: 400 });
    }

    const updated = await prisma.agencyDeduction.update({
      where: { id },
      data: {
        ...(name != null && { name }),
        ...(type != null && { type }),
        ...(amount != null && { amount }),
        ...(isActive != null && { isActive }),
      },
    });

    return NextResponse.json({ success: true, id: updated.id.toString() });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "에이전시 정보 없음" }, { status: 403 });
    }

    const { id: idStr } = await params;
    const id = BigInt(idStr);
    const existing = await prisma.agencyDeduction.findUnique({ where: { id } });
    if (!existing || existing.agencyId !== agencyId) {
      return NextResponse.json({ success: false, message: "항목을 찾을 수 없습니다." }, { status: 404 });
    }

    await prisma.agencyDeduction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
