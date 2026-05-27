// app/api/payments/charge/route.ts
// 토스페이먼츠 월 자동 결제 API
// 매월 nextBillingAt에 스케줄러(cron)가 호출

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const TOSS_SECRET_KEY = process.env.TOSS_PAYMENTS_SECRET_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const TOSS_API = "https://api.tosspayments.com/v1";

const PLAN_PRICES: Record<string, number> = {
  STARTER:  30000,
  STANDARD: 80000,
  PRO:      150000,
};
const PLAN_NAMES: Record<string, string> = {
  STARTER:  "AbleLink 스타터",
  STANDARD: "AbleLink 스탠다드",
  PRO:      "AbleLink 프로",
};

function tossAuth() {
  return "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
}

// 스케줄러에서 호출 (매일 UTC 01:00 = KST 10:00)
// x-cron-secret 헤더 또는 Authorization: Bearer 또는 ?secret= 쿼리 파라미터 중 하나
export async function POST(request: NextRequest) {
  const secret =
    request.headers.get("x-cron-secret") ||
    (request.headers.get("Authorization") || "").replace("Bearer ", "") ||
    new URL(request.url).searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 오늘 결제일인 에이전시 조회
  const agencies = await prisma.agency.findMany({
    where: {
      planType: { in: ["STARTER", "STANDARD", "PRO"] },
      tossBillingKey: { not: null },
      tossCustomerKey: { not: null },
      nextBillingAt: { gte: today, lt: tomorrow },
    },
  });

  const results = [];

  for (const agency of agencies) {
    try {
      const amount = PLAN_PRICES[agency.planType];
      if (!amount) continue;

      const orderId = `ablelink_${agency.id}_${Date.now()}`;
      const nextBillingAt = new Date(agency.nextBillingAt!);
      nextBillingAt.setMonth(nextBillingAt.getMonth() + 1);

      const res = await fetch(`${TOSS_API}/billing/${agency.tossBillingKey}`, {
        method: "POST",
        headers: {
          Authorization: tossAuth(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerKey: agency.tossCustomerKey,
          amount,
          orderId,
          orderName: `${PLAN_NAMES[agency.planType]} 월 구독`,
          taxFreeAmount: 0,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        // 결제 성공 → 다음 결제일 업데이트
        await prisma.agency.update({
          where: { id: agency.id },
          data: { nextBillingAt },
        });
        results.push({ agencyId: agency.id.toString(), status: "success", amount });
        console.log(`[charge] 결제 성공: ${agency.name} ${amount}원`);
      } else {
        // 결제 실패 → 플랜 FREE로 강등
        await prisma.agency.update({
          where: { id: agency.id },
          data: {
            planType: "FREE",
            tossBillingKey: null,
            nextBillingAt: null,
          },
        });
        results.push({ agencyId: agency.id.toString(), status: "failed", reason: data.message });
        console.error(`[charge] 결제 실패: ${agency.name}`, data.message);
      }
    } catch (err: any) {
      results.push({ agencyId: agency.id.toString(), status: "error", reason: err.message });
    }
  }

  return NextResponse.json({ success: true, processed: results.length, results });
}
