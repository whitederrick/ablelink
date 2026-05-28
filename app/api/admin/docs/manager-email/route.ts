// app/api/admin/docs/manager-email/route.ts
// 직무지도원의 현장 담당자 이메일 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const scope = await requireAdminSession(request);
    const { searchParams } = new URL(request.url);
    const coachUserId = searchParams.get("coachUserId") ?? "";
    if (!coachUserId) return NextResponse.json({ success:false }, { status:400 });

    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId: BigInt(coachUserId), status:{ in:["ASSIGNED","CONFIRMED","ACTIVE"] }, ...(scope.agencyId ? { agencyId: scope.agencyId } : {}) },
      include: {
        site: {
          include: {
            agencyManager: { select:{ email:true, name:true } },
            contacts: { where:{ isActive:true }, select:{ email:true, name:true }, take:1 },
          },
        },
      },
      orderBy: { assignedAt:"desc" },
    });

    const email =
      assignment?.site?.agencyManager?.email ||
      assignment?.site?.contacts?.[0]?.email ||
      null;

    const name =
      assignment?.site?.agencyManager?.name ||
      assignment?.site?.contacts?.[0]?.name ||
      null;

    return NextResponse.json({ success:true, email, name });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success:false, message: "서버 오류" }, { status:500 });
  }
}
