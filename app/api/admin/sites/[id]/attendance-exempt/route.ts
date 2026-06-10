// app/api/admin/sites/[id]/attendance-exempt/route.ts
// 현장(site) 단위 출퇴근 버튼 면제 일괄 적용/해제 — 운영자 전용 편의(다수 직무지도원 동시 반영).
// PATCH { exempt: boolean } → 해당 현장의 활성 배정(ASSIGNED/CONFIRMED/ACTIVE) 전체에 반영.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) throw new Error("VALIDATION:siteId");
    const siteId = BigInt(id);

    const body = await req.json().catch(() => ({}));
    const exempt = body?.exempt === true;

    // 현장 검증 — manager는 본인 agency 소속만, admin은 임의
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { agencyId: true, isActive: true },
    });
    if (!site) throw new Error("NOT_FOUND");
    if (session.kind === "manager" && site.agencyId !== session.agencyId) throw new Error("FORBIDDEN");

    const result = await prisma.siteAssignment.updateMany({
      where: { siteId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      data: { attendanceButtonExempt: exempt },
    });

    return NextResponse.json({ success: true, updated: result.count, exempt });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
