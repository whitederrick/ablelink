// app/api/admin/sites/options/route.ts
// 신규 등록/폼에서 사용할 기관/담당자 옵션 조회 (Site는 agencyId/managerId relation 기반)

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

export async function GET(req: Request) {
  try {
    const session = await requireAdminOrManagerSession(req);

    // manager: 본인 agency만 / admin(운영자): 전체 에이전시
    const agencyWhere = session.kind === "manager" ? { id: session.agencyId } : {};
    const mgrWhere = session.kind === "manager" ? { agencyId: session.agencyId } : {};

    const agencies = await prisma.agency.findMany({
      where: agencyWhere,
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    });

    const managers = await prisma.agencyManager.findMany({
      where: mgrWhere,
      orderBy: { id: "asc" },
      select: { id: true, agencyId: true, name: true, email: true, phoneNumber: true },
    });

    return NextResponse.json({
      success: true,
      agencies: agencies.map((a) => ({ id: String(a.id), name: a.name })),
      managers: managers.map((m) => ({
        id: String(m.id),
        agencyId: String(m.agencyId),
        name: m.name,
        email: m.email,
        phoneNumber: m.phoneNumber ?? null,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
