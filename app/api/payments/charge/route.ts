// app/api/payments/charge/route.ts
// 토스페이먼츠 월 자동 결제 API
// 매월 nextBillingAt에 스케줄러(cron)가 호출

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_NAMES, effectiveBilling, advanceBilling, cycleLabel } from "@/lib/billing";
import { outboundAllowed } from "@/lib/outboundGuard";
import { PAID_AGENCY_PLANS } from "@/lib/plans";

const TOSS_SECRET_KEY = process.env.TOSS_PAYMENTS_SECRET_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const TOSS_API = "https://api.tosspayments.com/v1";

const MS_DAY = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 3; // 일시 결제 오류(토스 점검 등) 시 이 기간 동안 매일 재시도 후 강등

function tossAuth() {
  return "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
}

// 스케줄러에서 호출 (매일 UTC 01:00 = KST 10:00)
// 인증: 헤더 전용 — x-cron-secret 또는 Authorization: Bearer.
//  · 쿼리스트링(?secret=)은 프록시/브라우저/모니터링 로그에 남아 제거함.
export async function POST(request: NextRequest) {
  const secret =
    request.headers.get("x-cron-secret") ||
    (request.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  // dev 안전모드: 로컬에서 실제 토스 결제가 나가지 않도록 차단(OUTBOUND_LIVE=1로 강제 가능)
  if (!outboundAllowed()) {
    console.log("[charge] dev 안전모드 — 실제 결제 건너뜀");
    return NextResponse.json({ success: true, skipped: true, reason: "dev 안전모드(OUTBOUND_LIVE=1로 강제)" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 결제일이 도래했거나(오늘) 일시 오류로 밀린(연체) 위탁기관 조회 — 유예 재시도 포함
  const agencies = await prisma.agency.findMany({
    where: {
      planType: { in: PAID_AGENCY_PLANS },
      tossBillingKey: { not: null },
      tossCustomerKey: { not: null },
      nextBillingAt: { lt: tomorrow },
    },
  });

  const results = [];

  for (const agency of agencies) {
    try {
      // 운영자 딜(협상가·주기) 반영. 표준 월정액은 customAmount 없을 때만.
      const { amount, cycle } = effectiveBilling(agency);
      if (!amount) continue;

      const currentBillingAt = new Date(agency.nextBillingAt!);
      const nextBillingAt = advanceBilling(currentBillingAt, cycle);
      const daysOverdue = Math.floor((today.getTime() - currentBillingAt.getTime()) / MS_DAY);

      // 결제 대상 월(KST) 기준 결정적 orderId — 같은 달 재시도 시 Toss가 중복청구를 거부(멱등성)
      const kst = new Date(currentBillingAt.getTime() + 9 * 3600 * 1000);
      const period = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
      const orderId = `ablelink_${agency.id}_${period}`;

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
          orderName: `${PLAN_NAMES[agency.planType]} ${cycleLabel(cycle)} 구독`,
          taxFreeAmount: 0,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        // 결제 성공 → 다음 결제일 업데이트 (현재 결제일이 그대로일 때만 = 동시 실행 경합 방지)
        await prisma.agency.updateMany({
          where: { id: agency.id, nextBillingAt: currentBillingAt },
          data: { nextBillingAt },
        });
        results.push({ agencyId: agency.id.toString(), status: "success", amount });
        console.log(`[charge] 결제 성공: ${agency.name} ${amount}원`);
      } else {
        // 일시 오류(토스 점검/혼잡 = 5xx·429)는 유예기간 내 재시도, 그 외(카드 거절 등)·유예 초과 시에만 강등
        const transient = res.status >= 500 || res.status === 429;
        if (transient && daysOverdue < GRACE_DAYS) {
          // nextBillingAt 유지 → 다음 cron(내일)에 자동 재시도
          results.push({ agencyId: agency.id.toString(), status: "retry", reason: data.message });
          console.warn(`[charge] 일시 오류, 재시도(${daysOverdue + 1}/${GRACE_DAYS}일): ${agency.name}`, data.message);
        } else {
          await prisma.agency.updateMany({
            where: { id: agency.id, nextBillingAt: currentBillingAt },
            data: { planType: "FREE", tossBillingKey: null, nextBillingAt: null },
          });
          results.push({ agencyId: agency.id.toString(), status: "failed", reason: data.message });
          console.error(`[charge] 결제 실패 강등: ${agency.name}`, data.message);
        }
      }
    } catch (err: any) {
      // 네트워크/예외 = 일시 오류로 간주 → 유예 초과 시에만 강등, 아니면 다음 cron 재시도
      const billingAt = new Date(agency.nextBillingAt!);
      const overdue = Math.floor((today.getTime() - billingAt.getTime()) / MS_DAY);
      if (overdue >= GRACE_DAYS) {
        await prisma.agency.updateMany({
          where: { id: agency.id, nextBillingAt: billingAt },
          data: { planType: "FREE", tossBillingKey: null, nextBillingAt: null },
        });
        results.push({ agencyId: agency.id.toString(), status: "failed", reason: `유예초과: ${err.message}` });
      } else {
        results.push({ agencyId: agency.id.toString(), status: "retry", reason: err.message });
      }
    }
  }

  return NextResponse.json({ success: true, processed: results.length, results });
}
