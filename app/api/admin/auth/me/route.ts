// app/api/admin/auth/me/route.ts
// 관리자 정보 조회 API 핸들러입니다.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);
    return NextResponse.json({
      success: true,
      session: {
        sub: scope.userId.toString(),
        role: scope.role,
        loginId: scope.loginId,
        agencyId: scope.agencyId ? scope.agencyId.toString() : null,
        agencyName: scope.agencyName,
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
