// lib/planGuard.ts
// 에이전시 구독 플랜 체크 유틸리티
// 직무지도원의 에이전시 플랜을 기준으로 PREMIUM 기능 접근 제어

import { prisma } from "./prisma";

export type PremiumFeature =
  | "AI_VOICE"       // 음성→AI 문장 변환
  | "PDF_GENERATE"   // PDF 자동 생성
  | "PDF_SIGN"       // 전자서명 합성
  | "EMAIL_SEND"     // 이메일 자동 발송
  | "PAYROLL";       // 정산/급여 리포트

export interface PlanCheckResult {
  allowed: boolean;
  reason?: "NO_AGENCY" | "FREE_PLAN" | "TRIAL_EXPIRED" | "QUOTA_EXCEEDED";
  planType?: string;
  trialEndsAt?: Date | null;
  message?: string;
}

/**
 * userId 기준으로 현재 배정된 에이전시의 플랜을 확인하여 기능 사용 가능 여부 반환
 */
export async function checkPlanAccess(
  userId: bigint,
  feature: PremiumFeature
): Promise<PlanCheckResult> {
  // 1. 현재 활성 배정의 에이전시 조회
  const assignment = await prisma.siteAssignment.findFirst({
    where: {
      userId,
      status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
    },
    include: {
      agency: true,
    },
    orderBy: { startDate: "desc" },
  });

  const agency = assignment?.agency;

  if (!agency) {
    return {
      allowed: false,
      reason: "NO_AGENCY",
      message: "소속 에이전시가 없습니다.",
    };
  }

  const plan = agency.planType;
  const now = new Date();

  // 2. FREE 플랜은 PREMIUM 기능 차단
  if (plan === "FREE") {
    return {
      allowed: false,
      reason: "FREE_PLAN",
      planType: plan,
      message: "무료 플랜에서는 사용할 수 없는 기능입니다. 구독을 시작해보세요.",
    };
  }

  // 3. TRIAL 플랜: 만료일 확인
  if (plan === "TRIAL") {
    const trialEndsAt = agency.trialEndsAt;
    if (!trialEndsAt || trialEndsAt < now) {
      return {
        allowed: false,
        reason: "TRIAL_EXPIRED",
        planType: plan,
        trialEndsAt,
        message: "무료 체험 기간이 종료되었습니다. 구독을 시작해보세요.",
      };
    }
    return { allowed: true, planType: plan, trialEndsAt };
  }

  // 4. STARTER / STANDARD / PRO: 허용
  return { allowed: true, planType: plan };
}

/**
 * TRIAL 시작 처리 (최초 PREMIUM 기능 사용 시 자동 호출)
 */
export async function startTrialIfNeeded(agencyId: bigint): Promise<void> {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) return;
  if (agency.planType !== "FREE") return; // 이미 다른 플랜

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // +15일

  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      planType: "TRIAL",
      trialStartedAt: now,
      trialEndsAt,
    },
  });
}

/**
 * 플랜별 한도 체크 (직무지도원 수, Site 수)
 */
export async function checkQuota(
  agencyId: bigint,
  type: "coaches" | "sites"
): Promise<{ allowed: boolean; current: number; max: number }> {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) return { allowed: false, current: 0, max: 0 };

  // PRO 또는 max=0은 무제한
  const max = type === "coaches" ? agency.maxCoaches : agency.maxSites;
  if (max === 0) return { allowed: true, current: 0, max: 0 };

  const current =
    type === "coaches"
      ? await prisma.siteAssignment.count({
          where: { agencyId, status: "ACTIVE" },
        })
      : await prisma.site.count({
          where: { agencyId, isActive: true },
        });

  return { allowed: current < max, current, max };
}

/**
 * 플랜별 기본 한도 설정값
 */
export const PLAN_LIMITS: Record<string, { maxCoaches: number; maxSites: number }> = {
  FREE:     { maxCoaches: 0, maxSites: 0 },   // 무제한 (기능 제한만)
  TRIAL:    { maxCoaches: 0, maxSites: 0 },   // 무제한 (기간 제한만)
  STARTER:  { maxCoaches: 5, maxSites: 5 },
  STANDARD: { maxCoaches: 20, maxSites: 20 },
  PRO:      { maxCoaches: 0, maxSites: 0 },   // 무제한
};
