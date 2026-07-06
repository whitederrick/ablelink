// app/api/admin/payroll/contracts/[id]/route.ts
// 급여 계약 삭제

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "위탁기관 정보 없음" }, { status: 403 });
    }

    const { id: idStr } = await params;
    if (!/^[0-9]+$/.test(String(idStr))) {
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
    }
    const id = BigInt(idStr);
    const contract = await prisma.payContract.findUnique({ where: { id } });
    if (!contract || contract.agencyId !== agencyId) {
      return NextResponse.json({ success: false, message: "계약을 찾을 수 없습니다." }, { status: 404 });
    }

    // A3: 기관 기본계약(siteId=null)은 현장별 금액 override가 남아있으면 삭제 금지.
    //  (삭제하면 computeRun이 고아 override를 기준 계약으로 오인해 그 금액이 전 현장을 지배하는 버그 — 복구 경로 없음.)
    //  M4: 단, '현재 유효한(effectiveTo=null 또는 미래)' 기본계약만 대상 — 이미 만료된(effectiveTo<오늘) 옛 기본계약은
    //   override를 더 이상 뒷받침하지 않으므로 정리(삭제) 허용. 과거엔 만료 계약까지 막혀 정리가 불가능했다.
    const nowD = new Date();
    const isCurrentBase = (contract as any).siteId == null &&
      ((contract as any).effectiveTo == null || (contract as any).effectiveTo >= nowD);
    if (isCurrentBase) {
      const override = await prisma.payContract.findFirst({
        where: { agencyId, workerId: contract.workerId, siteId: { not: null } } as any,
        select: { id: true },
      });
      if (override) {
        return NextResponse.json({ success: false, message: "현장별 금액 계약이 남아 있어 기관 기본 급여 기준을 삭제할 수 없습니다. 현장별 계약을 먼저 삭제하세요." }, { status: 400 });
      }
    }

    await prisma.payContract.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
