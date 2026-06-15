// 시스템 운영자 전용: 위탁기관 플랜 변경 / 정보 수정
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { logAudit } from "@/lib/auditLog";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const agencyId = parseBigInt(id);
    if (!agencyId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const body = await req.json();
    const { planType, trialEndsAt, maxWorkers, maxSites, billingCycle, customAmount, billingNote } = body;

    const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
    if (!agency) return NextResponse.json({ success: false, message: "위탁기관를 찾을 수 없습니다." }, { status: 404 });

    const validPlans = ["FREE", "TRIAL", "STARTER", "STANDARD", "PRO"];
    if (planType && !validPlans.includes(planType)) {
      return NextResponse.json({ success: false, message: "유효하지 않은 플랜입니다." }, { status: 400 });
    }
    if (billingCycle !== undefined && !["MONTHLY", "ANNUAL"].includes(billingCycle)) {
      return NextResponse.json({ success: false, message: "결제 주기는 MONTHLY 또는 ANNUAL이어야 합니다." }, { status: 400 });
    }

    const updateData: any = {};
    if (planType !== undefined)     updateData.planType    = planType;
    if (trialEndsAt !== undefined)  updateData.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
    if (maxWorkers !== undefined)   updateData.maxWorkers  = Number(maxWorkers);
    if (maxSites !== undefined)     updateData.maxSites    = Number(maxSites);
    // 운영자 딜 설정 (건바이건 결제)
    if (billingCycle !== undefined) updateData.billingCycle = billingCycle;
    if (customAmount !== undefined) {
      const n = customAmount === null || customAmount === "" ? null : Math.round(Number(customAmount));
      if (n !== null && (!Number.isFinite(n) || n < 0)) {
        return NextResponse.json({ success: false, message: "협상가는 0 이상의 숫자여야 합니다." }, { status: 400 });
      }
      updateData.customAmount = n;
    }
    if (billingNote !== undefined)  updateData.billingNote = billingNote ? String(billingNote).slice(0, 500) : null;

    await prisma.agency.update({ where: { id: agency.id }, data: updateData });

    await logAudit({
      adminId: scope.adminId,
      action: "AGENCY_PLAN_CHANGED",
      target: `Agency:${agency.id}`,
      detail: { before: { planType: agency.planType }, after: updateData },
    });

    return NextResponse.json({ success: true, message: "위탁기관 정보가 업데이트되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
