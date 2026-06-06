export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);

    const [unreadNoticeCount, agency, manager] = await Promise.all([
      prisma.managerNotice.count({ where: { managerId: scope.managerId, readAt: null } }),
      prisma.agency.findUnique({ where: { id: scope.agencyId }, select: { name: true } }),
      prisma.manager.findUnique({ where: { id: scope.managerId }, select: { displayName: true } }),
    ]);

    return NextResponse.json({
      success: true,
      session: {
        sub:         scope.managerId.toString(),
        agencyId:    scope.agencyId.toString(),
        role:        "AGENCY",
        loginId:     scope.loginId,
        agencyName:  agency?.name ?? null,
        displayName: manager?.displayName || scope.loginId,
      },
      unreadNoticeCount,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
