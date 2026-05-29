export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);
    return NextResponse.json({
      success: true,
      session: {
        sub:      scope.managerId.toString(),
        agencyId: scope.agencyId.toString(),
        role:     "AGENCY",
        loginId:  scope.loginId,
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
