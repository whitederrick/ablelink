// app/api/admin/sites/[id]/attendance-exempt/route.ts
// 현장(site) 단위 출퇴근 버튼 면제 일괄 적용/해제 — 운영자 전용 편의(다수 직무지도원 동시 반영).
// PATCH { exempt: boolean } → 해당 현장의 활성 배정(ASSIGNED/CONFIRMED/ACTIVE) 전체에 반영.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { audit } from "@/lib/audit";

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

    // 소유 축 = 배정의 agencyId(현장 agencyId 아님 — 현장은 기관 간 공유될 수 있다). 매니저는 자기 기관 배정만 바꾼다.
    //  예전엔 siteId만으로 갱신해, 같은 현장의 타 기관 배정까지 출퇴근 면제가 바뀌었다(근태·급여 영향). 운영자는 전체.
    const result = await prisma.siteAssignment.updateMany({
      where: {
        siteId,
        status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
        ...(session.kind === "manager" ? { agencyId: session.agencyId } : {}),
      },
      data: { attendanceButtonExempt: exempt },
    });
    await audit(session, {
      entityType: "Site", entityId: siteId, action: "update",
      summary: `현장 출퇴근 관리 면제 일괄 ${exempt ? "적용" : "해제"} (배정 ${result.count}건)`,
      after: { attendanceButtonExempt: exempt },
    });

    return NextResponse.json({ success: true, updated: result.count, exempt });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    const st = errToStatus(msg);
    return NextResponse.json({ success: false, message: st === 500 ? "서버 오류" : msg }, { status: st });
  }
}
