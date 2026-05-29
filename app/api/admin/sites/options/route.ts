// app/api/admin/sites/options/route.ts
// 신규 등록/폼에서 사용할 기관/담당자 옵션 조회 (Site는 agencyId/managerId relation 기반)

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);

    const agencyId = scope.agencyId;

    const agencies = await prisma.agency.findMany({
      where: { id: agencyId },
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    });

    const managers = await prisma.agencyManager.findMany({
      ...(agencyId ? { where: { agencyId } } : {}),
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
