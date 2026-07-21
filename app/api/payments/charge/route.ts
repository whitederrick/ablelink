// app/api/payments/charge/route.ts
// 토스페이먼츠 월 자동 결제 API
// 매월 nextBillingAt에 스케줄러(cron)가 호출

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_NAMES, effectiveBilling, advanceBilling, cycleLabel, buildBillingOrderId } from "@/lib/billing";
import { outboundAllowed } from "@/lib/outboundGuard";
import { PAID_AGENCY_PLANS, isPaidAgencyPlan } from "@/lib/plans";
import { refundSubscriptionPayment } from "@/lib/payments/tossRefund";
import { decideChargeOutcome, type ChargeOutcome } from "@/lib/payments/chargeDecision";
import { timingSafeEqual } from "crypto";

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
  // ★형제갭: cron/daily와 동일하게 상수시간 비교(타이밍 사이드채널 제거). 길이 다르면 timingSafeEqual throw → 선체크.
  const secretOk = CRON_SECRET.length > 0
    && secret.length === CRON_SECRET.length
    && timingSafeEqual(Buffer.from(secret), Buffer.from(CRON_SECRET));
  if (!secretOk) {
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
   // 기관 단위 예외 격리 — 계산·DB 등 예상 못한 예외가 직렬 크론 루프 전체를 죽여 이후 기관 청구를
   //  굶기지 않도록(fetch 예외는 내부에서 이미 처리). 예외 기관만 건너뛰고 다음으로.
   try {
    // 운영자 딜(협상가·주기) 반영. 표준 월정액은 customAmount 없을 때만.
    const { amount, cycle } = effectiveBilling(agency);
    if (!amount) continue;

    const currentBillingAt = new Date(agency.nextBillingAt!);
    // G: clamp 기준 = 가입 원일(subscribedAt). 저장된 결제일의 day를 쓰면 짧은 달 뒤 28일로 영구 고착됨.
    // ★20차 P3: 청구 기준일은 KST 벽시계일. raw getDate()는 UTC일이라 KST 새벽 구독 기관이 -1일 드리프트.
    const anchorDay = agency.subscribedAt ? new Date(new Date(agency.subscribedAt).getTime() + 9 * 3600 * 1000).getUTCDate() : undefined;
    const nextBillingAt = advanceBilling(currentBillingAt, cycle, anchorDay);
    const daysOverdue = Math.floor((today.getTime() - currentBillingAt.getTime()) / MS_DAY);

    // cron 반복결제: 결제일(KST yyyymmdd)×plan 기준 orderId — 안정된 nextBillingAt 기준이라 재시도
    //  멱등 유지 + 연속 두 주기가 같은 달로 접혀도 날짜가 달라 월충돌(bug B) 없음.
    const orderId = buildBillingOrderId(agency.id, currentBillingAt, agency.planType);

    // 시도 결과를 불확정(예외)/확정(HTTP)으로 분류. 타임아웃·네트워크 예외는 '결제 여부 모름'이므로
    //  절대 강등/빌링키 삭제하지 않는다(decideChargeOutcome). 카드 거절 등 4xx 응답만 확정 실패로 강등.
    let outcome: ChargeOutcome;
    let reasonMsg = "";
    let paymentKey: string | null = null; // 성공 응답의 paymentKey — 해지 시 잔여일 부분환불(부분취소)용 이력 기록
    try {
      const res = await fetch(`${TOSS_API}/billing/${agency.tossBillingKey}`, {
        method: "POST",
        // 벤더 스톨이 직렬 크론 루프 전체를 막아 이후 기관 청구를 굶기지 않도록 타임아웃(예외=불확정 처리).
        signal: AbortSignal.timeout(10000),
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
      const data: { code?: string; message?: string; paymentKey?: string } = await res.json().catch(() => ({}));
      if (res.ok) {
        outcome = { kind: "success" };
        paymentKey = data?.paymentKey ?? null;
      } else if (data?.code === "ALREADY_PROCESSED_PAYMENT") {
        outcome = { kind: "already_processed" };
      } else {
        // parsed = Toss 에러 본문(code)이 실제로 왔는가. 비-JSON/빈 본문(프록시·WAF 4xx)이면 false →
        //  확정 실패 아님(불확정)으로 취급해 즉시 강등+키삭제를 피한다.
        outcome = { kind: "http_error", status: res.status, parsed: !!data?.code };
        reasonMsg = data?.message ?? `HTTP ${res.status}${data?.code ? "" : "(본문 없음)"}`;
      }
    } catch (err: any) {
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      outcome = { kind: "exception", isTimeout };
      reasonMsg = `${isTimeout ? "타임아웃(불확정)" : "네트워크 오류"}: ${err?.message ?? err}`;
    }

    const decision = decideChargeOutcome(outcome, daysOverdue, GRACE_DAYS);
    if (decision.action === "advance") {
      // 결제 성공/멱등 → 다음 결제일로 진행(현재 결제일 그대로일 때만 = 동시 실행 경합 방지)
      //  + 결제 이력 기록(해지 시 잔여일 부분환불용). orderId가 멱등 키라 재시도는 upsert로 중복 없음.
      //  ALREADY_PROCESSED 복구 경로는 paymentKey 미제공 → 기존 값 보존(null이면 환불 시 orders/{orderId} 폴백).
      const [, advanced] = await prisma.$transaction([
        prisma.subscriptionPayment.upsert({
          where: { orderId },
          create: {
            agencyId: agency.id,
            orderId,
            paymentKey,
            planType: agency.planType,
            amount,
            cycle,
            periodStart: currentBillingAt,
            periodEnd: nextBillingAt,
          },
          update: paymentKey ? { paymentKey } : {},
        }),
        prisma.agency.updateMany({
          where: { id: agency.id, nextBillingAt: currentBillingAt },
          data: { nextBillingAt },
        }),
      ]);
      if (advanced.count === 0) {
        // 스냅샷 이후 이 기관의 결제 상태가 바뀜 — ①쌍둥이 cron이 이미 전진(무해) ②해지/변경으로 FREE 전환
        //  (= 방금 청구가 유령 결제: 돈은 나갔는데 서비스는 FREE). ②면 자동 전액 취소(2026-07-21 감사 P2).
        const fresh = await prisma.agency.findUnique({
          where: { id: agency.id },
          select: { planType: true, nextBillingAt: true },
        });
        const benign = fresh && isPaidAgencyPlan(fresh.planType) && fresh.nextBillingAt != null;
        if (!benign) {
          const row = await prisma.subscriptionPayment.findUnique({ where: { orderId } });
          if (row && !row.refundedAt) {
            const refund = await refundSubscriptionPayment({
              paymentId: row.id,
              amount: row.amount,
              reason: "구독 해지 경합 — 자동 전액 취소",
            });
            if (refund.ok) {
              console.warn(`[charge] 해지 경합 감지 — 자동 전액 취소: ${agency.name} ${row.amount}원`);
              results.push({ agencyId: agency.id.toString(), status: "conflict_refunded", amount: row.amount });
            } else {
              // 환불 실패 — claim은 남아 있으나 자동 재시도 주체가 없으므로 운영 경보(수동 확인 필요).
              console.error(`[charge] ★해지 경합 결제 자동취소 실패 — 수동 환불 필요: ${agency.name} orderId=${orderId}`, refund.reason);
              results.push({ agencyId: agency.id.toString(), status: "conflict_refund_failed", reason: refund.reason });
            }
            continue;
          }
        }
      }
      const already = outcome.kind === "already_processed";
      results.push({ agencyId: agency.id.toString(), status: "success", amount, ...(already ? { reason: "already_processed" } : {}) });
      console.log(`[charge] 결제 ${already ? "중복=성공간주" : "성공"}: ${agency.name} ${amount}원`);
    } else if (decision.action === "retry") {
      // nextBillingAt 유지 → 다음 cron 재시도(빌링키 보존 → 멱등 복구 경로 유지)
      results.push({ agencyId: agency.id.toString(), status: "retry", reason: reasonMsg });
      console.warn(`[charge] 재시도(연체 ${daysOverdue}일/유예 ${GRACE_DAYS}·또는 불확정): ${agency.name}`, reasonMsg);
    } else {
      // 확정 실패(카드 거절 등)·유예 초과 → 강등. wipeBillingKey일 때만 키 삭제(재등록 유도).
      await prisma.agency.updateMany({
        where: { id: agency.id, nextBillingAt: currentBillingAt },
        // ★10차#2: 카드거절 강등도 협상가(customAmount) 소멸(1회성 딜). 재구독 시 무결제-FREE 방지.
        data: { planType: "FREE", customAmount: null, billingCycle: "MONTHLY", nextBillingAt: null, ...(decision.wipeBillingKey ? { tossBillingKey: null } : {}) },
      });
      results.push({ agencyId: agency.id.toString(), status: "failed", reason: reasonMsg });
      console.error(`[charge] 결제 실패 강등: ${agency.name}`, reasonMsg);
    }
   } catch (err) {
      // 이 기관 처리 중 예상 못한 예외 → 격리하고 다음 기관 계속(결제일 미변경 = 다음 cron 재시도).
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[charge] 기관 처리 예외(건너뜀): ${agency.name}`, msg);
      results.push({ agencyId: agency.id.toString(), status: "error", reason: msg });
   }
  }

  return NextResponse.json({ success: true, processed: results.length, results });
}

// Vercel Cron 은 GET 으로 호출한다(vercel.json crons). POST만 있으면 405로 월 자동결제·재시도·강등이 실행되지 않음.
//  → 동일 헤더 시크릿 인증을 쓰는 POST 로 위임(GET 은 body를 읽지 않으므로 그대로 위임 가능).
export async function GET(request: NextRequest) {
  return POST(request);
}
