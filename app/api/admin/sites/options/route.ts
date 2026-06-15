// app/api/admin/sites/options/route.ts
// 신규 등록 폼에서 사용할 기관(Agency) 옵션 조회

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

export async function GET(req: Request) {
  try {
    const session = await requireAdminOrManagerSession(req);

    // manager: 본인 agency만 / admin(운영자): 전체 위탁기관
    const agencyWhere = session.kind === "manager" ? { id: session.agencyId } : {};

    const agencies = await prisma.agency.findMany({
      where: agencyWhere,
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    });

    return NextResponse.json({
      success: true,
      agencies: agencies.map((a) => ({ id: String(a.id), name: a.name })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
