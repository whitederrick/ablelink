// lib/planGuard.ts
// 에이전시 구독 플랜 체크 유틸리티

import { prisma } from "./prisma";

// STARTER 이상 필요한 기능
export type StarterFeature =
  | "AI_VOICE"        // 음성→AI 일지 (단일·일괄 통합)
  | "PDF_GENERATE"    // PDF 자동 생성
  | "PDF_SIGN"        // 전자서명 합성
  | "CONTRACT_ONLINE" // 온라인 계약서 작성
  | "DOC_INBOX"       // 문서 인박스
  | "RECRUIT_POST";   // 매칭: 직무지도 공고 등록·자동배정 (수요측)

// STANDARD 이상 필요한 기능
export type StandardFeature =
  | "SITE_MANAGER_SIGN" // 사업체담당자 모바일 사인
  | "PAYROLL"           // 급여 자동계산
  | "AUDIT_PACKAGE"     // 감사 대응 서류 패키지
  | "TRAINEE_REPORT";   // 훈련생 진척도 리포트

// PRO 에서만 가능한 기능
export type ProFeature =
  | "TALENT_SOURCING";  // 매칭: 인재풀 검색·역제안 (방향 B, 프리미엄 소싱)

export type PremiumFeature = StarterFeature | StandardFeature | ProFeature;

const STANDARD_FEATURES = new Set<PremiumFeature>([
  "SITE_MANAGER_SIGN",
  "PAYROLL",
  "AUDIT_PACKAGE",
  "TRAINEE_REPORT",
]);

const PRO_FEATURES = new Set<PremiumFeature>([
  "TALENT_SOURCING",
]);

export interface PlanCheckResult {
  allowed: boolean;
  reason?:
    | "NO_AGENCY"
    | "CONTRACT_PENDING"      // 계약서 미서명 (서명하면 사용 가능)
    | "CONTRACT_NOT_STARTED"  // 계약 시작 전
    | "CONTRACT_EXPIRED"      // 계약 종료 (유예 초과)
    | "SELF_MANAGED"          // 셀프등록(무소속 운영) 워커 — 기본 문서·서명 무료 허용
    | "FREE_PLAN"
    | "TRIAL_EXPIRED"
    | "PLAN_TOO_LOW"
    | "QUOTA_EXCEEDED";
  planType?: string;
  trialEndsAt?: Date | null;
  message?: string;
}

// 셀프등록(에이전시 미소속 운영) 워커에게도 무료로 허용하는 "기본 문서·서명" 기능.
// AI 음성·온라인계약·급여 등은 제외 → 유료 유지.
const SELF_DOC_FEATURES = new Set<PremiumFeature>([
  "PDF_GENERATE",
  "PDF_SIGN",
  "SITE_MANAGER_SIGN",
]);

/**
 * 셀프등록(무소속 운영) 워커 여부.
 * 셀프 현장등록은 AgencyManager(연락처)만 만들고 Manager(로그인 계정)는 만들지 않는다.
 * → 활성 배정의 에이전시에 Manager 로그인 계정이 0개면 "직접 운영" 컨텍스트로 간주.
 */
export async function isSelfManagedWorker(workerId: bigint): Promise<boolean> {
  const assignment = await prisma.siteAssignment.findFirst({
    where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
    select: { agencyId: true },
    orderBy: { assignedAt: "desc" },
  });
  if (!assignment?.agencyId) return false;
  return isSelfManagedAgency(assignment.agencyId);
}

/** Manager(로그인 계정)가 0개인 에이전시 = 셀프등록/무소속 운영 컨텍스트. */
export async function isSelfManagedAgency(agencyId: bigint): Promise<boolean> {
  const managerCount = await prisma.manager.count({ where: { agencyId } });
  return managerCount === 0;
}

function fmtDate(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}.${String(k.getUTCMonth() + 1).padStart(2, "0")}.${String(k.getUTCDate()).padStart(2, "0")}`;
}

function isStandardFeature(f: PremiumFeature): boolean {
  return STANDARD_FEATURES.has(f);
}

function isProFeature(f: PremiumFeature): boolean {
  return PRO_FEATURES.has(f);
}

function planAllows(plan: string, feature: PremiumFeature): boolean {
  if (plan === "PRO") return true;
  if (plan === "STANDARD") return !isProFeature(feature);
  if (plan === "STARTER") return !isStandardFeature(feature) && !isProFeature(feature);
  return false; // FREE, TRIAL (만료)
}

// ─── Worker 측: workerId 기준 ──────────────────────────────────────
//
// 접근 권한은 두 갈래로 결정된다:
//  (1) 시스템 운영자가 직무지도원 개인에게 직접 부여(worker.planType = PREMIUM)
//      → 에이전시와 무관하게 전체 유료기능 허용 (초기 직무지도원 테스트/특례용)
//  (2) 에이전시 구독을 근로계약/배정 기반으로 소비
//      → 서명된 EmploymentContract의 계약기간(계약종료 +3일 유예) 내이면 그 에이전시 플랜으로 판단.
//      → 전자계약서가 없으면(전자계약서는 PRO 전용) 활성 SiteAssignment의 배정기간을 계약기간으로 보고
//        그 에이전시 플랜으로 판단. (2026-06-06 접근모델 재설계)
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

  // (2.5) 셀프등록(무소속 운영) 워커 — 기본 문서·서명(PDF·전자서명·사업체담당자 사인)은 무료 허용.
  //       에이전시 계약 기반 게이트는 "에이전시가 실제로 AbleLink를 운영(Manager 계정 보유)"할 때만 적용.
  if (SELF_DOC_FEATURES.has(feature) && (await isSelfManagedWorker(workerId))) {
    return { allowed: true, reason: "SELF_MANAGED" };
  }

  // (2b) 활성 배정 기반 engagement — 전자 근로계약서(PRO 전용)가 없어도 배정 기간을
  //      계약 기간으로 보고 해당 에이전시 구독 플랜으로 판정한다. (배정 startDate~endDate, 종료 +3일 유예)
  //      전자계약서가 PRO 전용이 되면서, STARTER/STANDARD 에이전시도 워커가 기능을 쓸 수 있게 하는 연결고리.
  const engagement = await prisma.siteAssignment.findFirst({
    where: {
      workerId,
      status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
      agencyId: { not: null },
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: new Date(now.getTime() - CONTRACT_GRACE_MS) } }],
    },
    include: { agency: true },
    orderBy: { startDate: "desc" },
  });
  if (engagement?.agency) {
    return _checkAgency(engagement.agency, feature);
  }

  // (3) 유효 계약·배정이 없을 때 — 상황별 자연스러운 안내 메시지
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

/**
 * 문서·서명 접근 권한(PDF 생성/전자서명). 셀프등록 워커는 무료 허용되므로 premium(AI 기준)과 별개로 노출.
 * UI(문서·서명 화면)는 premiumAccess 대신 이 값으로 게이트한다.
 */
export async function getWorkerDocAccess(
  workerId: bigint
): Promise<{ allowed: boolean; reason?: PlanCheckResult["reason"]; message?: string }> {
  const res = await checkPlanAccess(workerId, "PDF_GENERATE");
  return { allowed: res.allowed, reason: res.reason, message: res.message };
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
    const required = isProFeature(feature) ? "PRO" : isStandardFeature(feature) ? "STANDARD" : "STARTER";
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

// 정책(2026-06-05): 유료 플랜은 인원/사업장 한도 없음 — 성장 벽 제거(에이전시 확보 우선).
// FREE만 온램프 한도 유지. 향후 스케일 과금은 캡이 아니라 AI 사용량 미터링/시트 애드온으로.
export const PLAN_LIMITS: Record<string, { maxWorkers: number; maxSites: number }> = {
  FREE:     { maxWorkers: 3, maxSites: 2 },
  TRIAL:    { maxWorkers: 0, maxSites: 0 }, // 무제한 (기간 제한만)
  STARTER:  { maxWorkers: 0, maxSites: 0 }, // 무제한
  STANDARD: { maxWorkers: 0, maxSites: 0 }, // 무제한
  PRO:      { maxWorkers: 0, maxSites: 0 }, // 무제한
};
