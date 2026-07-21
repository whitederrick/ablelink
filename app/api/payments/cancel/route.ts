// app/api/payments/cancel/route.ts
// 구독 해지 API — 해지 즉시 FREE 전환 + 잔여일 일할 부분환불(공제 없음).
// 토스 입점 기준: 구독 해지 시 잔여일 청약철회(부분 환불) 보장. 산식 = lib/payments/refund.ts,
// 환불 실행 = lib/payments/tossRefund.ts(claim 기반 — 멱등키 15일 만료·재시도 금액 드리프트·동시 해지 안전).
// 제3조: 결제 7일 이내 + 유료기능 미이용(lib/payments/paidUsage)이면 전액 환불.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { PLAN_LIMITS } from "@/lib/planGuard";
import { isPaidAgencyPlan } from "@/lib/plans";
import { computeProRataRefund, isWithinFullRefundWindow } from "@/lib/payments/refund";
import { refundSubscriptionPayment } from "@/lib/payments/tossRefund";
import { hasPaidUsageSince } from "@/lib/payments/paidUsage";
import { outboundAllowed } from "@/lib/outboundGuard";
import { checkRateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

const MS_DAY = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    // 구독 해지는 본인 위탁기관 매니저만. (이전: 워커 세션 + 스코프 미검증 → 임의 위탁기관 해지 가능 버그)
    const scope = await requireManagerSession(request);
    const now = new Date();

    // 외부 토스 호출을 유발하는 라우트 — 완만한 예산(환불 실패 반복 재시도 구간 한정 남용 방지).
    const rl = await checkRateLimit(`payments-cancel:${scope.agencyId}`, { max: 5, windowSec: 60, blockSec: 60 });
    if (!rl.allowed) {
      return NextResponse.json({ success: false, message: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }

    // 유료 플랜 게이트 — FREE/TRIAL 기관의 해지 호출은 무의미(잔존 결제행 반복 환불 차단, 2026-07-21 감사 P1).
    const agency = await prisma.agency.findUnique({
      where: { id: scope.agencyId },
      select: { planType: true },
    });
    if (!agency || !isPaidAgencyPlan(agency.planType)) {
      return NextResponse.json({ success: false, message: "현재 유료 구독 중이 아닙니다." }, { status: 400 });
    }

    // 현재 주기를 커버하는 가장 최근 결제 건 — 잔여일 부분환불 대상.
    //  supersededAt: 플랜 변경·강등으로 대표성을 잃은 행은 제외(변경 시점에 잔여분이 이미 환불/정리됨).
    const payment = await prisma.subscriptionPayment.findFirst({
      where: { agencyId: scope.agencyId, refundedAt: null, supersededAt: null, periodEnd: { gt: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    let refundAmount = 0;
    let remainingDays = 0;
    let fullRefund = false;
    let refundSkippedDev = false;
    // 실제 환불액이 방금 계산한 잔여일 기준액과 정확히 일치하는가 — 불일치(기존 claim 재사용·취소가능 잔액 캡)면
    //  "잔여 N일" 문구가 실환불액과 어긋나므로 금액만 안내한다(2026-07-21 P3 메시지 정합).
    let refundMatchesDays = true;

    if (payment) {
      // 제3조: 7일 이내 + 유료기능 미이용 → 전액 환불(청약철회). 그 외 일할.
      if (isWithinFullRefundWindow(payment.periodStart, now) && !(await hasPaidUsageSince(scope.agencyId, payment.periodStart))) {
        refundAmount = payment.amount;
        fullRefund = true;
      } else {
        const pro = computeProRataRefund({
          amount: payment.amount,
          periodStart: payment.periodStart,
          periodEnd: payment.periodEnd,
          at: now,
        });
        refundAmount = pro.refundAmount;
        remainingDays = pro.remainingDays;
      }
    }

    if (refundAmount > 0) {
      if (!outboundAllowed()) {
        // dev 안전모드: 실제 토스 부분취소가 나가지 않도록 차단(해지 자체는 진행, 환불 기록 안 함)
        refundSkippedDev = true;
        refundAmount = 0;
        console.log("[payments/cancel] dev 안전모드 — 토스 부분취소 건너뜀");
      } else {
        const outcome = await refundSubscriptionPayment({
          paymentId: payment!.id,
          amount: refundAmount,
          reason: fullRefund ? "청약철회 — 7일 이내 미이용 전액 환불" : "구독 중도 해지 — 잔여일 일할 환불",
        });
        if (!outcome.ok) {
          // 환불 실패 시 해지도 하지 않는다(구독 유지) — claim이 금액을 고정해 재시도는 동일 금액으로 안전.
          //  (환불 없는 해지 강행은 입점 기준 위반)
          return NextResponse.json({ success: false, message: outcome.reason }, { status: 502 });
        }
        refundMatchesDays = outcome.refundedAmount === refundAmount; // 요청액과 실환불액 일치 여부
        refundAmount = outcome.refundedAmount;
        // ★2026-07-21 P3: 환불(금전 이동)은 엔진이 이미 커밋됨 — 아래 강등 트랜잭션이 실패해도 이 사실은 남아야
        //  한다. 강등 tx 이후의 종합 감사로그가 tx 예외로 유실되는 창을 막기 위해, 실제 환불 시점에 별도 기록.
        //  (admin 강등 라우트의 환불 선기록과 동일 패턴.)
        if (refundAmount > 0) {
          await audit(scope, {
            entityType: "SubscriptionPayment",
            entityId: payment!.id,
            action: "refund",
            summary: `구독 해지 환불 실행 · ${fullRefund ? "전액" : "일할"} ${refundAmount.toLocaleString("ko-KR")}원`,
            payload: { refundAmount, fullRefund, remainingDays, orderId: payment!.orderId },
          });
        }
      }
    }

    const free = PLAN_LIMITS.FREE;
    // 해지(빌링키 제거·FREE 전환·FREE 한도 복원) + 잔존 미환불 행 supersede를 한 트랜잭션으로.
    //  환불(payment 행 finalize)은 엔진이 이미 커밋 — 여기서 실패해도 재시도 시 환불이 중복되지 않는다.
    await prisma.$transaction([
      prisma.agency.update({
        where: { id: scope.agencyId },
        data: {
          planType: "FREE",
          tossBillingKey: null,
          tossCustomerKey: null,
          nextBillingAt: null,
          subscriptionId: null,
          subscriptionCanceledAt: now,
          // ★10차#2: 협상가(customAmount)는 1회성 딜 → 해지 시 소멸시킨다. 남겨두면 재구독 때 운영자 저장등급이
          //  FREE인 상태와 결합해 '협상가 청구 + FREE 부여'가 된다. 재협상 시 운영자가 다시 설정.
          customAmount: null,
          // ★20차 형제갭: 딜 소멸 시 주기도 표준(MONTHLY)으로 복원(admin PATCH 강등과 정합).
          billingCycle: "MONTHLY",
          // 재구독이 새 orderId로 실결제되도록 이벤트 키를 올린다(같은 달 취소→재구독 무료사이클 방지).
          billingEpoch: { increment: 1 },
          maxWorkers: free.maxWorkers,
          maxSites: free.maxSites,
        },
      }),
      // 잔존 미환불 활성주기 행(비정상 상태의 흔적)은 대체 표기 — 이후 해지 재호출로 행마다 환불되는 것 차단.
      prisma.subscriptionPayment.updateMany({
        where: { agencyId: scope.agencyId, refundedAt: null, supersededAt: null, periodEnd: { gt: now } },
        data: { supersededAt: now },
      }),
    ]);

    // 감사로그 — 환불(금전 이동)·해지 기록. 실패해도 본 작업 무영향(lib/audit 내 try/catch).
    await audit(scope, {
      entityType: "SubscriptionPayment",
      entityId: payment?.id ?? null,
      action: "refund",
      summary: `구독 해지(${agency.planType}→FREE)${refundAmount > 0 ? ` · ${fullRefund ? "전액" : "일할"} 환불 ${refundAmount.toLocaleString("ko-KR")}원` : " · 환불 대상 없음"}`,
      payload: { refundAmount, fullRefund, remainingDays, orderId: payment?.orderId ?? null },
    });

    // 사이클링 남용 모니터링(정책 결정 2026-07-21): 90일 내 환불 3회 이상이면 운영 경보 로그.
    const recentRefunds = await prisma.subscriptionPayment.count({
      where: { agencyId: scope.agencyId, refundedAt: { gte: new Date(now.getTime() - 90 * MS_DAY) }, refundedAmount: { gt: 0 } },
    });
    if (recentRefunds >= 3) {
      console.warn(`[payments/cancel] 반복 구독-해지 의심: agencyId=${scope.agencyId} 90일 내 환불 ${recentRefunds}회`);
      await audit(scope, {
        entityType: "Agency",
        entityId: scope.agencyId,
        action: "refund-abuse-flag",
        summary: `90일 내 환불 ${recentRefunds}회 — 반복 구독-해지 패턴 점검 필요`,
        payload: { recentRefunds },
      });
    }

    const message =
      refundAmount > 0
        ? fullRefund
          ? `구독이 해지되었습니다. 7일 이내 미이용 청약철회로 ${refundAmount.toLocaleString("ko-KR")}원 전액이 결제 수단으로 환불됩니다.`
          : refundMatchesDays
            ? `구독이 해지되었습니다. 잔여 ${remainingDays}일에 대한 ${refundAmount.toLocaleString("ko-KR")}원이 결제 수단으로 부분 환불됩니다.`
            : `구독이 해지되었습니다. ${refundAmount.toLocaleString("ko-KR")}원이 결제 수단으로 부분 환불됩니다.`
        : refundSkippedDev
          ? "[dev 안전모드] 구독이 해지되었습니다. (실제 환불 호출은 차단됨)"
          : "구독이 해지되었습니다.";

    return NextResponse.json({ success: true, message, refundAmount, remainingDays, fullRefund });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("[payments/cancel]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
