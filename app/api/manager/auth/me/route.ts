export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);

    const unreadNoticeCount = await prisma.managerNotice.count({
      where: { managerId: scope.managerId, readAt: null },
    });

    return NextResponse.json({
      success: true,
      session: {
        sub:      scope.managerId.toString(),
        agencyId: scope.agencyId.toString(),
        role:     "AGENCY",
        loginId:  scope.loginId,
      },
      unreadNoticeCount,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
