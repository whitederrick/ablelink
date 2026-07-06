// lib/payroll/insuranceRateDefaults.ts
// 연도별 4대보험 "근로자 부담" 요율 참고 기본값(단위 %). 요율 입력 폼 프리필/일괄등록용.
//
// ⚠️ 정부 고시값이며 매년(때론 연중) 변동 → 저장 전 반드시 해당 연도 공식 고시로 확인.
// ⚠️ 장기요양 함정: 실제 법령은 "건강보험료 × 장기요양보험료율"이지만, 본 시스템은 급여 계산이
//    `과세급여 × 요율`이므로 **과세급여 기준 실효율**로 환산해 넣는다.
//    실효율 = (건강보험 근로자율 %) × (장기요양보험료율, 건강보험료 대비).
//      예) 2025: 3.545% × 12.95% = 0.4591%
// ※ 산재보험은 업종별로 상이하고 전액 사업주 부담이라 기본값을 두지 않는다(운영자 직접 입력).
//
// 출처 요약(근로자 부담분):
//   국민연금 = 총율의 절반. 2016~2025 총 9%→4.5%, **2026 총 9.5%→4.75%**(단계적 인상: 2027 5.0 … 2033 6.5%).
//   건강보험 = 건강보험료율(총)의 절반. 2023~2025 총 7.09%→3.545%, **2026 총 7.19%→3.595%**.
//   장기요양(건강보험료 대비율): 2023 12.81% / 2024·2025 12.95% / 2026 13.14%.
//   고용보험(실업급여, 근로자) = 2019.10~ 0.8%, 2022.7~ 0.9% (연중 변경 있음).
// ⚠️ 근로자 공제 대상이 아닌 것(넣지 말 것): 산재보험(전액 사업주·업종별), 고용보험의 고용안정·직업능력개발사업 요율(사업주 부담).
//    → employmentInsurance에는 '실업급여분'만 넣는다.

export interface InsuranceRateDefaultPct {
  nationalPension: number;     // 국민연금 근로자(%)
  healthInsurance: number;     // 건강보험 근로자(%)
  longTermCare: number;        // 장기요양 근로자 — 과세급여 기준 실효율(%)
  employmentInsurance: number; // 고용보험 근로자 실업급여분(%)
  note?: string;               // 잠정/확인 필요 표시
}

// 근로자 부담분(%). 장기요양 = 건강근로자율 × 장기요양보험료율(건강보험료 대비)로 환산한 과세급여 기준 실효율.
//  건강총율/장기요양율(건보대비)/고용(실업급여): 연도별 정부 고시.
export const INSURANCE_RATE_DEFAULTS: Record<number, InsuranceRateDefaultPct> = {
  2016: { nationalPension: 4.5,  healthInsurance: 3.06,  longTermCare: 0.2004, employmentInsurance: 0.65 },
  2017: { nationalPension: 4.5,  healthInsurance: 3.06,  longTermCare: 0.2004, employmentInsurance: 0.65 },
  2018: { nationalPension: 4.5,  healthInsurance: 3.12,  longTermCare: 0.2303, employmentInsurance: 0.65 },
  2019: { nationalPension: 4.5,  healthInsurance: 3.23,  longTermCare: 0.2749, employmentInsurance: 0.8,  note: "고용보험 2019.10 0.65→0.8 연중변경(연말값)" },
  2020: { nationalPension: 4.5,  healthInsurance: 3.335, longTermCare: 0.3418, employmentInsurance: 0.8 },
  2021: { nationalPension: 4.5,  healthInsurance: 3.43,  longTermCare: 0.3951, employmentInsurance: 0.8 },
  2022: { nationalPension: 4.5,  healthInsurance: 3.495, longTermCare: 0.4288, employmentInsurance: 0.9,  note: "고용보험 2022.7 0.8→0.9 연중변경(연말값)" },
  2023: { nationalPension: 4.5,  healthInsurance: 3.545, longTermCare: 0.4541, employmentInsurance: 0.9 },
  2024: { nationalPension: 4.5,  healthInsurance: 3.545, longTermCare: 0.4591, employmentInsurance: 0.9 },
  2025: { nationalPension: 4.5,  healthInsurance: 3.545, longTermCare: 0.4591, employmentInsurance: 0.9 },
  2026: { nationalPension: 4.75, healthInsurance: 3.595, longTermCare: 0.4724, employmentInsurance: 0.9,  note: "국민연금 9→9.5% 인상 반영" },
};

/** 해당 연도의 참고 기본값(%) 반환. 없으면 null. */
export function insuranceRateDefaultForYear(year: number): InsuranceRateDefaultPct | null {
  return INSURANCE_RATE_DEFAULTS[year] ?? null;
}

// 국민연금 기준소득월액 하한액/상한액(원). ★매년 7월 고시(적용기간 7월~다음해 6월) → 저장 전 반드시 공식 고시로 확인.
//  연도 키 = 그 해 7월 적용분(달력연도 대부분을 차지) 기준의 참고값(잠정). 운영자가 정확한 고시값으로 저장.
export interface PensionBaseBoundDefault { min: number; max: number; note?: string; }
export const PENSION_BASE_BOUND_DEFAULTS: Record<number, PensionBaseBoundDefault> = {
  2022: { min: 350000, max: 5530000, note: "참고값 — 고시 확인 필요" },
  2023: { min: 370000, max: 5900000, note: "참고값 — 고시 확인 필요" },
  2024: { min: 390000, max: 6170000, note: "참고값 — 고시 확인 필요" },
  2025: { min: 400000, max: 6370000, note: "잠정 — 2025.7 고시 확인 필요" },
  2026: { min: 400000, max: 6370000, note: "잠정 — 2026.7 고시 미정, 2025값 유지(확인 필요)" },
};

/** 해당 연도의 국민연금 기준소득월액 하한/상한 참고 기본값. 없으면 null. */
export function pensionBaseBoundDefaultForYear(year: number): PensionBaseBoundDefault | null {
  return PENSION_BASE_BOUND_DEFAULTS[year] ?? null;
}

/** 기본값이 정의된 연도 목록(오름차순). */
export const INSURANCE_DEFAULT_YEARS = Object.keys(INSURANCE_RATE_DEFAULTS).map(Number).sort((a, b) => a - b);
