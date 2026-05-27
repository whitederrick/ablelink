// app/api/admin/payroll/contracts/[id]/route.ts
// 급여 계약 삭제

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "에이전시 정보 없음" }, { status: 403 });
    }

    const { id: idStr } = await params;
    const id = BigInt(idStr);
    const contract = await prisma.payContract.findUnique({ where: { id } });
    if (!contract || contract.agencyId !== agencyId) {
      return NextResponse.json({ success: false, message: "계약을 찾을 수 없습니다." }, { status: 404 });
    }

    await prisma.payContract.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
