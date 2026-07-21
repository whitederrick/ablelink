// 시스템 운영자 전용: 위탁기관 플랜 변경 / 정보 수정
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { audit, auditSnapshot } from "@/lib/audit";
import { RESTRICTED_TEMPLATES } from "@/lib/contractTemplates";
import { isPaidAgencyPlan } from "@/lib/plans";
import { PLAN_LIMITS } from "@/lib/planGuard";
import { computeProRataRefund } from "@/lib/payments/refund";
import { refundSubscriptionPayment } from "@/lib/payments/tossRefund";
import { outboundAllowed } from "@/lib/outboundGuard";

const RESTRICTED_KEYS = new Set(RESTRICTED_TEMPLATES.map(t => t.key));

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
    const { planType, trialEndsAt, maxWorkers, maxSites, billingCycle, customAmount, billingNote, allowedContractTemplates } = body;

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
    // ★11차#2+12차: 무료 등급(FREE·TRIAL)으로 강등 시 협상가(customAmount) 소멸(1회성 딜 — cancel·charge·
    //  admin/subscription과 정합). 운영자 플랜 폼(savePlan)은 customAmount를 안 보내므로 명시 클리어가 필요하다.
    //  (남겨두면 재구독 시 resolveActivationPlan이 무료등급을 반환해 billing 백스톱이 정당한 재구독을 400으로 막음.
    //   FREE만 처리하면 TRIAL 강등에서 같은 잠금이 재발 → isPaidAgencyPlan로 무료등급 전체를 종결.)
    //  단 같은 요청에서 customAmount를 명시 전달했다면(딜 재설정) 그 값을 존중한다.
    if (updateData.planType !== undefined && !isPaidAgencyPlan(updateData.planType) && customAmount === undefined) {
      updateData.customAmount = null;
      // ★18차: 딜 소멸(무료 강등) 시 협상가뿐 아니라 주기도 표준(MONTHLY)으로 되돌린다. ANNUAL이 잔존하면
      //  강등→재구독 시 effectiveBilling이 협상가 없는 ANNUAL 상태가 되는데(소비측에서 MONTHLY로 방어하나),
      //  상태 자체를 딜 이전으로 정리해 '유료+ANNUAL+협상가없음' 조합이 애초에 남지 않게 한다. billingCycle을
      //  같은 요청에서 명시 전달했으면 그 값을 존중.
      if (billingCycle === undefined) updateData.billingCycle = "MONTHLY";
    }
    // #7(17차): ANNUAL 주기는 표준가(PLAN_PRICES)가 월정액뿐이라, 협상가(customAmount) 없이 ANNUAL로 두면
    //  effectiveBilling이 월정액을 반환하고 결제일만 +1년 → 월정액이 연 1회만 청구돼 ≈92% 미과금된다.
    //  유료 등급 + ANNUAL은 협상가(연 청구액)를 반드시 요구(운영자 오설정 차단). billingCycle/customAmount는
    //  이 라우트가 유일한 설정 경로라 여기서 게이트하면 충분.
    {
      const effCycle = billingCycle !== undefined ? billingCycle : agency.billingCycle;
      const effAmount = "customAmount" in updateData ? updateData.customAmount : agency.customAmount;
      const effPlan   = updateData.planType !== undefined ? updateData.planType : agency.planType;
      if (isPaidAgencyPlan(effPlan) && effCycle === "ANNUAL" && !(effAmount != null && effAmount > 0)) {
        return NextResponse.json(
          { success: false, message: "연 결제(ANNUAL)는 협상가(연 청구액)를 함께 설정해야 합니다. 협상가 없이 연 결제는 월정액이 연 1회만 청구되어 미과금됩니다." },
          { status: 400 },
        );
      }
    }
    if (billingNote !== undefined)  updateData.billingNote = billingNote ? String(billingNote).slice(0, 500) : null;
    // 위탁기관 전용 계약서 양식 부여(운영자만). 알려진 전용 양식 키만 허용.
    if (allowedContractTemplates !== undefined) {
      if (!Array.isArray(allowedContractTemplates)) {
        return NextResponse.json({ success: false, message: "부여 양식 목록 형식이 올바르지 않습니다." }, { status: 400 });
      }
      const cleaned = Array.from(new Set(
        allowedContractTemplates.filter((k: any) => typeof k === "string" && RESTRICTED_KEYS.has(k))
      ));
      updateData.allowedContractTemplates = cleaned;
    }

    // 유료 → 무료(FREE/TRIAL) 강등 = 실질 구독 종료(2026-07-21 감사 P2): 잔여일 자동 환불(해지와 동일 산식)
    //  + 빌링 상태 정리. 정리 없이 강등만 하면 ①고객이 잔여일을 환불받지 못하고(정책 §4 위반) ②tossBillingKey·
    //  nextBillingAt 잔존 → 이후 유료 복원 시 cron이 FREE였던 기간을 소급 청구한다.
    const isTermination = updateData.planType !== undefined
      && !isPaidAgencyPlan(updateData.planType)
      && isPaidAgencyPlan(agency.planType);
    if (isTermination) {
      const at = new Date();
      const prev = await prisma.subscriptionPayment.findFirst({
        where: { agencyId: agency.id, refundedAt: null, supersededAt: null, periodEnd: { gt: at } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (prev) {
        const pro = computeProRataRefund({ amount: prev.amount, periodStart: prev.periodStart, periodEnd: prev.periodEnd, at });
        if (pro.refundAmount > 0 && outboundAllowed()) {
          const outcome = await refundSubscriptionPayment({
            paymentId: prev.id,
            amount: pro.refundAmount,
            reason: "운영자 구독 종료 — 잔여일 일할 환불",
            kind: "ADMIN_TERMINATION",
          });
          if (!outcome.ok) {
            // 환불 실패 시 강등도 중단(재시도 가능 — claim이 금액 고정). 환불 없는 강등은 정책 위반.
            return NextResponse.json(
              { success: false, message: `잔여분 환불에 실패해 강등을 중단했습니다: ${outcome.reason}` },
              { status: 502 },
            );
          }
          await audit(scope, {
            entityType: "SubscriptionPayment",
            entityId: prev.id,
            action: "refund",
            summary: `운영자 강등(${agency.planType}→${updateData.planType}) · 일할 환불 ${outcome.refundedAmount.toLocaleString("ko-KR")}원`,
            payload: { refundAmount: outcome.refundedAmount, orderId: prev.orderId },
          });
        } else {
          // 잔여 0원 또는 dev 안전모드 — 대체 표기만(이후 해지 재호출로 반복 환불되는 것 차단).
          await prisma.subscriptionPayment.update({ where: { id: prev.id }, data: { supersededAt: at } });
        }
      }
      await prisma.subscriptionPayment.updateMany({
        where: { agencyId: agency.id, refundedAt: null, supersededAt: null, periodEnd: { gt: at } },
        data: { supersededAt: at },
      });
      // 빌링 상태 정리 — payments/cancel과 동등(소급 과청구·무결제 재활성 차단).
      updateData.tossBillingKey = null;
      updateData.tossCustomerKey = null;
      updateData.nextBillingAt = null;
      updateData.subscriptionId = null;
      updateData.subscriptionCanceledAt = at;
      updateData.billingEpoch = { increment: 1 };
      // ★2026-07-21 P3: FREE 강등 시 FREE 온램프 한도 복원(cancel·charge와 정합). 운영자 폼이 유료 시절의
      //  maxWorkers/maxSites=0(무제한)을 그대로 보내므로, 종료 처리에서 FREE 한도로 덮어써야 무제한 정원이
      //  잔존하지 않는다. (운영자가 같은 요청에서 명시 전달했어도 종료의 FREE 캡이 우선.)
      updateData.maxWorkers = PLAN_LIMITS.FREE.maxWorkers;
      updateData.maxSites = PLAN_LIMITS.FREE.maxSites;
    }

    const auditBefore = await auditSnapshot("Agency", { id: agency.id }, updateData);
    await prisma.agency.update({ where: { id: agency.id }, data: updateData });


    await audit(scope, { entityType: "Agency", entityId: agency.id, action: "update", before: auditBefore, after: updateData });

    return NextResponse.json({ success: true, message: "위탁기관 정보가 업데이트되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
