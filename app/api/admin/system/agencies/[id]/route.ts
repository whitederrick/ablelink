// 시스템 운영자 전용: 에이전시 플랜 변경 / 정보 수정
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { logAudit } from "@/lib/auditLog";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireAdminSession(req);
    if (scope.role !== "ADMIN") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const { planType, trialEndsAt, maxCoaches, maxSites } = body;

    const agency = await prisma.agency.findUnique({ where: { id: BigInt(id) } });
    if (!agency) return NextResponse.json({ success: false, message: "에이전시를 찾을 수 없습니다." }, { status: 404 });

    const validPlans = ["FREE", "TRIAL", "STARTER", "STANDARD", "PRO"];
    if (planType && !validPlans.includes(planType)) {
      return NextResponse.json({ success: false, message: "유효하지 않은 플랜입니다." }, { status: 400 });
    }

    const updateData: any = {};
    if (planType !== undefined)     updateData.planType    = planType;
    if (trialEndsAt !== undefined)  updateData.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
    if (maxCoaches !== undefined)   updateData.maxCoaches  = Number(maxCoaches);
    if (maxSites !== undefined)     updateData.maxSites    = Number(maxSites);

    await prisma.agency.update({ where: { id: agency.id }, data: updateData });

    await logAudit({
      adminId: scope.userId,
      action: "AGENCY_PLAN_CHANGED",
      target: `Agency:${agency.id}`,
      detail: { before: { planType: agency.planType }, after: updateData },
    });

    return NextResponse.json({ success: true, message: "에이전시 정보가 업데이트되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
