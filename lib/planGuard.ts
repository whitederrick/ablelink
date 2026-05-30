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
  reason?:
    | "NO_AGENCY"
    | "CONTRACT_PENDING"      // 계약서 미서명 (서명하면 사용 가능)
    | "CONTRACT_NOT_STARTED"  // 계약 시작 전
    | "CONTRACT_EXPIRED"      // 계약 종료 (유예 초과)
    | "FREE_PLAN"
    | "TRIAL_EXPIRED"
    | "PLAN_TOO_LOW"
    | "QUOTA_EXCEEDED";
  planType?: string;
  trialEndsAt?: Date | null;
  message?: string;
}

function fmtDate(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}.${String(k.getUTCMonth() + 1).padStart(2, "0")}.${String(k.getUTCDate()).padStart(2, "0")}`;
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

// ─── Worker 측: workerId 기준 ──────────────────────────────────────
//
// 접근 권한은 두 갈래로 결정된다:
//  (1) 시스템 운영자가 직무지도원 개인에게 직접 부여(worker.planType = PREMIUM)
//      → 에이전시와 무관하게 전체 유료기능 허용 (초기 직무지도원 테스트/특례용)
//  (2) 에이전시 구독을 근로계약 기반으로 소비
//      → 서명된 EmploymentContract의 계약기간(계약종료 +3일 유예) 내일 때만,
//        그 계약의 에이전시 구독 플랜으로 판단. (계약 전·만료 후에는 사용 불가)
//  기본 기능(출퇴근·수동일지 등)은 checkPlanAccess를 거치지 않으므로 항상 사용 가능.

const CONTRACT_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 계약 종료 후 3일 유예 (잔여 일지 제출 등)

export async function checkPlanAccess(
  workerId: bigint,
  feature: PremiumFeature
): Promise<PlanCheckResult> {
  // (1) 시스템 운영자 개인 부여
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { planType: true },
  });
  if (worker?.planType === "PREMIUM") {
    return { allowed: true, planType: "PREMIUM" }; // 개인 부여 = 전체 허용
  }

  // (2) 근로계약 기반 에이전시 구독 (계약기간 + 3일 유예 내)
  const now = new Date();
  const contract = await prisma.employmentContract.findFirst({
    where: {
      workerId,
      status: { in: ["SIGNED", "COMPLETED"] }, // 직무지도원이 서명 완료한 계약만
      contractStart: { lte: now },
      contractEnd: { gte: new Date(now.getTime() - CONTRACT_GRACE_MS) },
    },
    include: { agency: true },
    orderBy: { contractEnd: "desc" },
  });

  if (contract?.agency) {
    return _checkAgency(contract.agency, feature);
  }

  // (3) 유효 계약이 없을 때 — 상황별 자연스러운 안내 메시지
  const latest = await prisma.employmentContract.findFirst({
    where: { workerId, status: { in: ["PENDING", "SIGNED", "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    select: { status: true, contractStart: true, contractEnd: true },
  });

  if (latest?.status === "PENDING") {
    return {
      allowed: false,
      reason: "CONTRACT_PENDING",
      message: "근로계약서에 서명하면 이 기능을 사용할 수 있어요.",
    };
  }
  if (latest && (latest.status === "SIGNED" || latest.status === "COMPLETED")) {
    if (latest.contractStart > now) {
      return {
        allowed: false,
        reason: "CONTRACT_NOT_STARTED",
        message: `근로계약 시작일(${fmtDate(latest.contractStart)})부터 이 기능을 사용할 수 있어요.`,
      };
    }
    return {
      allowed: false,
      reason: "CONTRACT_EXPIRED",
      message: "근로계약 기간이 종료되어 유료 기능을 사용할 수 없어요. 기본 기능은 그대로 사용할 수 있어요.",
    };
  }
  return {
    allowed: false,
    reason: "NO_AGENCY",
    message: "아직 연결된 에이전시 근로계약이 없어요. 출퇴근·일지 등 기본 기능은 그대로 사용할 수 있어요.",
  };
}

/**
 * Worker 앱 UI 게이트용 — 직무지도원이 지금 유료 기능을 쓸 수 있는지 + 못 쓸 때 안내 메시지.
 * 대표 기능(AI_VOICE = STARTER 최소 티어)으로 판정하며 계약/개인부여 로직은 checkPlanAccess와 동일.
 * 프론트가 이 값으로 버튼을 사전 게이트하고 동일한 안내 문구를 표시한다.
 */
export async function getWorkerPremiumStatus(
  workerId: bigint
): Promise<{ premium: boolean; reason?: PlanCheckResult["reason"]; message?: string }> {
  const res = await checkPlanAccess(workerId, "AI_VOICE");
  return { premium: res.allowed, reason: res.reason, message: res.message };
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
  type: "workers" | "sites"
): Promise<{ allowed: boolean; current: number; max: number }> {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) return { allowed: false, current: 0, max: 0 };

  const max = type === "workers" ? agency.maxWorkers : agency.maxSites;
  if (max === 0) return { allowed: true, current: 0, max: 0 }; // 무제한

  const current =
    type === "workers"
      ? await prisma.siteAssignment.count({ where: { agencyId, status: "ACTIVE" } })
      : await prisma.site.count({ where: { agencyId, isActive: true } });

  return { allowed: current < max, current, max };
}

// ─── 플랜별 기본 한도 (DB 초기값 세팅용) ─────────────────────────

export const PLAN_LIMITS: Record<string, { maxWorkers: number; maxSites: number }> = {
  FREE:     { maxWorkers: 3,  maxSites: 2  },
  TRIAL:    { maxWorkers: 0,  maxSites: 0  }, // 무제한 (기간 제한만)
  STARTER:  { maxWorkers: 10, maxSites: 10 },
  STANDARD: { maxWorkers: 30, maxSites: 30 },
  PRO:      { maxWorkers: 0,  maxSites: 0  }, // 무제한
};
