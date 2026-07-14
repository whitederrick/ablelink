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

/**
 * 4대보험 가입 판정 (월별). 계약 1개월 이상은 보험별 법정 기준을 **개별** 적용한다.
 *  · 사업소득       → 가입 없음(3.3% 원천만)
 *  · 일용(<1개월)   → 고용 + 산재 (국민연금은 8일↑/60h↑ 시 검토 플래그만)
 *  · 국민연금       → 월 60시간 이상 OR 월 8일 이상
 *  · 건강·장기요양  → 월 60시간 이상만 (월 8일 기준 없음 — 단시간 건강보험 과다부과 방지)
 *  · 고용보험       → 월 60시간 이상, 또는 3개월 이상 계속근로
 *  · 산재           → 항상(전액 사업주 부담 → workerDeductible에서 제외)
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
  // 계약 1개월 이상 — 보험별 법정 기준을 개별 적용(단일 tier로 뭉쳐 과다부과하지 않음).
  const hours60 = x.monthlyHours >= 60;
  const days8 = x.monthlyDays >= 8;
  const insurances: InsuranceKind[] = [];
  const workerDeductible: InsuranceKind[] = [];
  // 국민연금: 월 60시간 이상 OR 월 8일 이상
  if (hours60 || days8) { insurances.push("pension"); workerDeductible.push("pension"); }
  // 건강·장기요양: 월 60시간 이상만(8일 트랙 없음)
  if (hours60) { insurances.push("health", "ltc"); workerDeductible.push("health", "ltc"); }
  // 고용보험: 월 60시간 이상, 또는 3개월 이상 계속근로(초단시간이어도)
  if (hours60 || x.continuousMonths >= 3) { insurances.push("employment"); workerDeductible.push("employment"); }
  insurances.push("industrial"); // 산재 항상
  // tier: 국민연금/건강 대상(60h||8일)이면 일반, 그 외 초단시간(산재 중심)
  const tier: WorkerTier = (hours60 || days8) ? "REGULAR" : "ULTRA_SHORT";
  return { tier, insurances, workerDeductible };
}

/** 소득유형 + 보험 판정을 한 번에. */
export function determineEligibility(
  income: IncomeTypeInput,
  insurance: InsuranceInput,
): { incomeType: IncomeType } & InsuranceResult {
  const incomeType = determineIncomeType(income);
  return { incomeType, ...determineInsurances(incomeType, insurance) };
}
