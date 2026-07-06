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
    //  (삭제하면 computeRun이 기본계약을 못 찾아 '급여 계약 없음'(급여0)이 되거나 고아 override 상태가 됨 — 복구 경로 없음.)
    //  현장별 계약을 먼저 삭제해야 기본계약 삭제 가능.
    //  ★M4 되돌림(2026-07-06): '만료된 옛 base는 삭제 허용'으로 좁혔더니, 만료 base 삭제 시 override만 남는 고아 상태가
    //   재개방돼 그 워커 급여가 0이 됐다. base(현재/만료 무관)는 override가 하나라도 남아있으면 삭제 금지가 안전하다.
    if ((contract as any).siteId == null) {
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
