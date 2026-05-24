// lib/planGuard.ts
// 에이전시 구독 플랜 체크 유틸리티

import { prisma } from "./prisma";

// STARTER 이상 필요한 기능
export type StarterFeature =
  | "AI_VOICE"        // 음성→AI 일지 (단일·일괄 통합)
  | "PDF_GENERATE"    // PDF 자동 생성
  | "PDF_SIGN"        // 전자서명 합성
  | "CONTRACT_ONLINE" // 온라인 계약서 작성
  | "DOC_INBOX";      // 문서 인박스

// STANDARD 이상 필요한 기능
export type StandardFeature =
  | "SITE_MANAGER_SIGN" // 사업체담당자 모바일 사인
  | "PAYROLL"           // 급여 자동계산
  | "AUDIT_PACKAGE"     // 감사 대응 서류 패키지
  | "TRAINEE_REPORT";   // 훈련생 진척도 리포트

export type PremiumFeature = StarterFeature | StandardFeature;

const STANDARD_FEATURES = new Set<PremiumFeature>([
  "SITE_MANAGER_SIGN",
  "PAYROLL",
  "AUDIT_PACKAGE",
  "TRAINEE_REPORT",
]);

export interface PlanCheckResult {
  allowed: boolean;
  reason?: "NO_AGENCY" | "FREE_PLAN" | "TRIAL_EXPIRED" | "PLAN_TOO_LOW" | "QUOTA_EXCEEDED";
  planType?: string;
  trialEndsAt?: Date | null;
  message?: string;
}

function isStandardFeature(f: PremiumFeature): boolean {
  return STANDARD_FEATURES.has(f);
}

function planAllows(plan: string, feature: PremiumFeature): boolean {
  if (plan === "PRO") return true;
  if (plan === "STANDARD") return true;
  if (plan === "STARTER") return !isStandardFeature(feature);
  return false; // FREE, TRIAL (만료)
}

// ─── Worker 측: userId 기준 ──────────────────────────────────────

export async function checkPlanAccess(
  userId: bigint,
  feature: PremiumFeature
): Promise<PlanCheckResult> {
  const assignment = await prisma.siteAssignment.findFirst({
    where: { userId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
    include: { agency: true },
    orderBy: { startDate: "desc" },
  });

  const agency = assignment?.agency;
  if (!agency) {
    return { allowed: false, reason: "NO_AGENCY", message: "소속 에이전시가 없습니다." };
  }

  return _checkAgency(agency, feature);
}

// ─── Admin 측: agencyId 기준 ─────────────────────────────────────

export async function checkAgencyPlanAccess(
  agencyId: bigint,
  feature: PremiumFeature
): Promise<PlanCheckResult> {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) {
    return { allowed: false, reason: "NO_AGENCY", message: "에이전시를 찾을 수 없습니다." };
  }
  return _checkAgency(agency, feature);
}

function _checkAgency(
  agency: { planType: string; trialEndsAt: Date | null },
  feature: PremiumFeature
): PlanCheckResult {
  const plan = agency.planType;
  const now = new Date();

  if (plan === "FREE") {
    return {
      allowed: false,
      reason: "FREE_PLAN",
      planType: plan,
      message: "무료 플랜에서는 사용할 수 없는 기능입니다. 구독을 시작해보세요.",
    };
  }

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
    // TRIAL은 모든 기능 허용
    return { allowed: true, planType: plan, trialEndsAt };
  }

  if (!planAllows(plan, feature)) {
    const required = isStandardFeature(feature) ? "STANDARD" : "STARTER";
    return {
      allowed: false,
      reason: "PLAN_TOO_LOW",
      planType: plan,
      message: `이 기능은 ${required} 플랜 이상에서 사용 가능합니다.`,
    };
  }

  return { allowed: true, planType: plan };
}

// ─── TRIAL 자동 시작 ─────────────────────────────────────────────

export async function startTrialIfNeeded(agencyId: bigint): Promise<void> {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency || agency.planType !== "FREE") return;

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

  await prisma.agency.update({
    where: { id: agencyId },
    data: { planType: "TRIAL", trialStartedAt: now, trialEndsAt },
  });
}

// ─── 한도 체크 (인원/사업장 수) ──────────────────────────────────

export async function checkQuota(
  agencyId: bigint,
  type: "coaches" | "sites"
): Promise<{ allowed: boolean; current: number; max: number }> {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) return { allowed: false, current: 0, max: 0 };

  const max = type === "coaches" ? agency.maxCoaches : agency.maxSites;
  if (max === 0) return { allowed: true, current: 0, max: 0 }; // 무제한

  const current =
    type === "coaches"
      ? await prisma.siteAssignment.count({ where: { agencyId, status: "ACTIVE" } })
      : await prisma.site.count({ where: { agencyId, isActive: true } });

  return { allowed: current < max, current, max };
}

// ─── 플랜별 기본 한도 (DB 초기값 세팅용) ─────────────────────────

export const PLAN_LIMITS: Record<string, { maxCoaches: number; maxSites: number }> = {
  FREE:     { maxCoaches: 3,  maxSites: 2  },
  TRIAL:    { maxCoaches: 0,  maxSites: 0  }, // 무제한 (기간 제한만)
  STARTER:  { maxCoaches: 10, maxSites: 10 },
  STANDARD: { maxCoaches: 30, maxSites: 30 },
  PRO:      { maxCoaches: 0,  maxSites: 0  }, // 무제한
};
