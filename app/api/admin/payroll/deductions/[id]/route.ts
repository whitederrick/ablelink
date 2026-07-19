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
    if (!/^\d+$/.test(idStr)) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const id = BigInt(idStr);
    const existing = await prisma.agencyDeduction.findUnique({ where: { id } });
    if (!existing || existing.agencyId !== agencyId) {
      return NextResponse.json({ success: false, message: "항목을 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const { name, type, amount, isActive } = body;

    if (type && !["FIXED", "PERCENTAGE"].includes(type)) {
      return NextResponse.json({ success: false, message: "type 오류" }, { status: 400 });
    }
    // ★18차(P3): PATCH도 POST와 동일하게 amount 범위를 검증한다. 누락 시 PERCENTAGE를 5.0 등으로 바꿔
    //  500% 공제→음수 순급여 명세서가 만들어질 수 있었다. 유효 type(변경값 우선, 없으면 기존값) 기준으로 판정.
    //  effAmount = 변경값 우선, 없으면 기존값 — ★type만 PERCENTAGE로 바꾸고 amount를 생략하면(부분 갱신) 기존
    //   FIXED 금액(예: 50000)이 그대로 비율로 재해석돼 5,000,000% 공제가 되던 형제갭 차단.
    const effType = String(type ?? existing.type);
    const effAmount = amount != null ? Number(amount) : Number(existing.amount);
    if (!Number.isFinite(effAmount) || effAmount < 0) {
      return NextResponse.json({ success: false, message: "공제 금액/비율은 0 이상이어야 합니다." }, { status: 400 });
    }
    if (effType === "PERCENTAGE" && effAmount > 1) {
      return NextResponse.json({ success: false, message: "비율 공제는 0~1 사이여야 합니다. (유형을 비율로 바꾸려면 0~1 값으로 금액도 함께 수정하세요.)" }, { status: 400 });
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
    if (!/^\d+$/.test(idStr)) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
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
