// app/api/admin/site-owners/route.ts
// 현장 '담당 관리자' 지정/이관 드롭다운용 — 에이전시의 Manager(로그인) 계정 목록
// GET → { managers: [{ id, name }] }  (manager: 본인 에이전시 / admin: ?agencyId)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);

    let agencyId: bigint | undefined;
    if (session.kind === "manager") {
      agencyId = session.agencyId;
    } else {
      const a = req.nextUrl.searchParams.get("agencyId");
      agencyId = a ? (parseBigInt(a) ?? undefined) : undefined;
    }

    const rows = await prisma.manager.findMany({
      where: { isActive: true, ...(agencyId ? { agencyId } : {}) },
      select: { id: true, displayName: true, loginId: true },
      orderBy: { id: "asc" },
    });

    return NextResponse.json({
      success: true,
      managers: rows.map((m) => ({
        id: String(m.id),
        name: m.displayName || m.loginId,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
