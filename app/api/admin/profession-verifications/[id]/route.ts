// app/api/admin/profession-verifications/[id]/route.ts
// 운영자 — 직종 자격 승인/반려
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { logAudit } from "@/lib/auditLog";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { id } = await params;
    const wpId = parseBigInt(id);
    if (!wpId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const body = await req.json();
    const action = String(body.action ?? "");
    if (!["approve", "reject"].includes(action))
      return NextResponse.json({ success: false, message: "action은 approve 또는 reject여야 합니다." }, { status: 400 });

    const wp = await prisma.workerProfession.findUnique({ where: { id: wpId } });
    if (!wp) return NextResponse.json({ success: false, message: "자격 신청을 찾을 수 없습니다." }, { status: 404 });

    await prisma.workerProfession.update({
      where: { id: wpId },
      data: {
        verifyStatus: action === "approve" ? "VERIFIED" : "REJECTED",
        verifiedAt: new Date(),
        verifiedByAdminId: scope.adminId,
      },
    });
    await logAudit({
      adminId: scope.adminId,
      action: action === "approve" ? "PROFESSION_VERIFIED" : "PROFESSION_REJECTED",
      target: `WorkerProfession:${wpId}`,
      detail: { workerId: wp.workerId.toString(), profession: wp.profession, certNumber: wp.certNumber },
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/profession-verifications/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
