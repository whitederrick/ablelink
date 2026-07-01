// lib/payroll/insuranceEligibility.ts
// 소득유형·4대보험 가입 자동 판정 엔진 (docs/payroll-insurance-design.md §2)
//
// 핵심: 소득유형도, 4대보험 가입 보험도 담당자 입력이 아니라 아래 규칙으로 계산되는 "결과"다.
//  - 근로계약 + 근태(근로자성) → 근로소득. 근로계약 있으면 사업소득(3.3%) 불가(세법 위반).
//  - 근로소득자 4대보험: 고용기간·월근로시간/일수·계속근로로 일용/초단시간/일반 차등.
//  - 산재보험은 전액 사업주 부담 → 워커 공제(net)에는 미반영(표기만).

export type IncomeType = "EMPLOYMENT" | "BUSINESS"; // 근로소득 | 사업소득(3.3%)

// pension=국민연금, health=건강, ltc=장기요양, employment=고용, industrial=산재
export type InsuranceKind = "pension" | "health" | "ltc" | "employment" | "industrial";

// DAILY_WORKER=일용(1개월 미만), ULTRA_SHORT=초단시간, REGULAR=일반 단시간/상용, NONE=사업소득(가입 없음)
export type WorkerTier = "DAILY_WORKER" | "ULTRA_SHORT" | "REGULAR" | "NONE";

export interface IncomeTypeInput {
  hasEmploymentContract: boolean; // 서명/체결된 근로계약서 존재
  hasAttendance: boolean;         // 출근부(출퇴근) 존재 → 근로자성 보강
  freelancerOverride?: boolean;   // 명시적 프리랜서(근로계약 없는 건당 용역). 기본 false.
}

/**
 * 소득유형 판정.
 *  - 근로계약 체결 + 출퇴근·업무지시(근로자성) → 근로소득. 근로계약 있으면 사업소득 신고 불가.
 *  - 사업소득(3.3%)은 고용관계 없는 독립 프리랜서(freelancerOverride)만.
 *  - 안전 기본값: 근로소득(임의 3.3% 처리로 인한 세법 위반·추징 방지).
 */
export function determineIncomeType(i: IncomeTypeInput): IncomeType {
  if (i.hasEmploymentContract) return "EMPLOYMENT";          // 근로계약 → 무조건 근로소득
  if (i.freelancerOverride) return "BUSINESS";               // 계약 없는 프리랜서만 사업소득
  if (i.hasAttendance) return "EMPLOYMENT";                  // 계약서 없어도 근태 있으면 근로자성
  return "EMPLOYMENT";
}

/** 근로계약서가 있는데 사업소득을 지정한 위법 소지 케이스(경고용). */
export function isIllegalBusinessIncome(hasEmploymentContract: boolean, chosen: IncomeType): boolean {
  return hasEmploymentContract && chosen === "BUSINESS";
}

export interface InsuranceInput {
  employmentMonths: number; // 고용기간(개월, 계약 시작~종료). 계약 없으면 Infinity(일용 아님). 표기·폴백용.
  monthlyHours: number;     // 월 소정근로시간
  monthlyDays: number;      // 월 근로일수
  continuousMonths: number; // 계속근로 개월수(최초 계약/배정 시작~현재)
  // 일용(1개월 미만) 판정 — 달력 기준(2월 등 월별 일수 차이 반영). 주어지면 이 값을 우선 사용,
  // 없으면 employmentMonths < 1 로 폴백(하위호환).
  employmentUnderOneMonth?: boolean;
}

export interface InsuranceResult {
  tier: WorkerTier;
  insurances: InsuranceKind[];       // 가입 보험 전체(산재 포함)
  workerDeductible: InsuranceKind[]; // 워커 공제 대상(= 가입 − 산재)
  // 국민연금 가입 "검토 대상": 계약 1개월 미만이나 월 8일 이상/60시간 이상 근무 → 국민연금공단 안내상
  // 사업장가입 대상이 될 여지가 있음(2022~ 개정·시행령 제2조). 단, "1개월 이상 계속근로" 전제로 실무가
  // 갈릴 수 있어 **자동 공제하지 않고 플래그만** 세운다(노무사·공단 확인 후 가입·공제 여부 확정).
  //  ※ 건강보험은 1개월 미만이면 명확히 제외이므로 검토 대상 아님(국민연금만).
  needsPensionReview?: boolean;
}

// 일반 단시간/상용: 워커가 부담하는 4대보험(산재 제외)
const REGULAR_WORKER_DED: InsuranceKind[] = ["pension", "health", "ltc", "employment"];

/**
 * 4대보험 가입 판정 (월별).
 *  · 사업소득       → 가입 없음(3.3% 원천만)
 *  · 일용(<1개월)   → 고용 + 산재
 *  · 일반(월60h↑ 또는 월8일↑) → 국민연금 + 건강(+장기요양) + 고용 + 산재
 *  · 초단시간(그 외) → 산재 (+ 계속근로 3개월↑이면 고용)
 *  산재는 전액 사업주 부담 → workerDeductible에서 제외.
 */
export function determineInsurances(incomeType: IncomeType, x: InsuranceInput): InsuranceResult {
  if (incomeType === "BUSINESS") {
    return { tier: "NONE", insurances: [], workerDeductible: [] };
  }
  // 일용근로자: 1개월 미만 고용(달력 기준 우선, 없으면 employmentMonths < 1 폴백)
  //  · 고용 + 산재만 자동. 건강보험·국민연금은 1개월 미만이면 원칙 제외.
  //  · 단 국민연금은 <1개월이라도 월 8일 이상 또는 60시간 이상이면 사업장가입 대상이 될 여지 →
  //    자동 공제는 하지 않고 needsPensionReview 플래그만(노무사·공단 확인 후 확정).
  const underOneMonth = x.employmentUnderOneMonth ?? (x.employmentMonths < 1);
  if (underOneMonth) {
    const needsPensionReview = x.monthlyDays >= 8 || x.monthlyHours >= 60;
    return { tier: "DAILY_WORKER", insurances: ["employment", "industrial"], workerDeductible: ["employment"], needsPensionReview };
  }
  // 일반 단시간/상용: 월 소정근로 60시간 이상 또는 월 8일 이상
  if (x.monthlyHours >= 60 || x.monthlyDays >= 8) {
    return { tier: "REGULAR", insurances: [...REGULAR_WORKER_DED, "industrial"], workerDeductible: [...REGULAR_WORKER_DED] };
  }
  // 초단시간: 월 60시간 미만 & 월 8일 미만 → 산재. 3개월 이상 계속근로면 고용보험 추가.
  const insurances: InsuranceKind[] = ["industrial"];
  const workerDeductible: InsuranceKind[] = [];
  if (x.continuousMonths >= 3) { insurances.push("employment"); workerDeductible.push("employment"); }
  return { tier: "ULTRA_SHORT", insurances, workerDeductible };
}

/** 소득유형 + 보험 판정을 한 번에. */
export function determineEligibility(
  income: IncomeTypeInput,
  insurance: InsuranceInput,
): { incomeType: IncomeType } & InsuranceResult {
  const incomeType = determineIncomeType(income);
  return { incomeType, ...determineInsurances(incomeType, insurance) };
}
