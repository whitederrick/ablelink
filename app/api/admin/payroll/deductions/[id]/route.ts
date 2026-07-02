// app/api/admin/payroll/deductions/[id]/route.ts
// 위탁기관 공제 항목 수정/삭제

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit, auditSnapshot } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "위탁기관 정보 없음" }, { status: 403 });
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

    const updateData: any = {
      ...(name != null && { name }),
      ...(type != null && { type }),
      ...(amount != null && { amount }),
      ...(isActive != null && { isActive }),
    };
    const auditBefore = await auditSnapshot("AgencyDeduction", { id }, updateData);
    const updated = await prisma.agencyDeduction.update({
      where: { id },
      data: updateData,
    });

    await audit(scope, { entityType: "AgencyDeduction", entityId: id, action: "update", before: auditBefore, after: updateData });
    return NextResponse.json({ success: true, id: updated.id.toString() });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "위탁기관 정보 없음" }, { status: 403 });
    }

    const { id: idStr } = await params;
    const id = BigInt(idStr);
    const existing = await prisma.agencyDeduction.findUnique({ where: { id } });
    if (!existing || existing.agencyId !== agencyId) {
      return NextResponse.json({ success: false, message: "항목을 찾을 수 없습니다." }, { status: 404 });
    }

    await prisma.agencyDeduction.delete({ where: { id } });
    await audit(scope, { entityType: "AgencyDeduction", entityId: id, action: "delete", summary: `공제 항목 삭제: ${existing.name}` });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
