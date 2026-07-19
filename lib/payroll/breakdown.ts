// lib/payroll/breakdown.ts
// 급여 항목 breakdown(PayrollItem.breakdown JSON)의 타입. computeRun이 이 형태로 만들고,
// 급여 조회·명세서·화면이 이 형태로 읽는다. 모든 필드 선택적 + 인덱스 시그니처(과거 데이터/부분 채움 허용).
//  · as any 대신 이 타입으로 캐스트해 오타·형상 오류를 컴파일 단계에서 잡는다(런타임 동작 불변).

export interface PayLine {
  key: string;
  name: string;
  hours: number;
  amount: number;
  method?: string;
}

export interface DeductLine {
  key: string;
  name: string;
  amount: number;
}

export interface PayrollBasicInfo {
  job: string;
  placementType: string;
  placementDate: string;
  dependents: number;
  childUnder20: number;
  withholdingRate: number;
}

export interface WeeklyHolidayDetail {
  eligibleWeeks: number;
  avgWeeklyHours: number;
  meets15h: boolean;
}

export interface PayrollInsurance {
  incomeType: string;
  tier: string;
  insurances: string[];
  workerDeductible: string[];
  needsPensionReview: boolean;
  employerIndustrial: number;
  rateYear: number | null;
  taxYear: number | null;
  employmentMonths: number | null;
  monthlyHours: number;
  monthlyDays: number;
  continuousMonths: number;
}

export interface PayrollBreakdown {
  // 공통/기본
  note?: string;
  payType?: string; // HOURLY | DAILY | MONTHLY
  workedDays?: number;
  workedMinutes?: number;
  workedHours?: number;
  paidMinutes?: number;
  paidHours?: number;
  pendingDays?: number;
  // HOURLY
  hourlyRate?: number;
  hourlyRate2Plus?: number | null;
  oneToOneHours?: number;
  oneToManyHours?: number;
  used2PlusRate?: boolean;
  // DAILY
  dailyRate?: number;
  // MONTHLY
  monthlyRate?: number;
  scheduledWorkdays?: number;
  prorateWorkdays?: number; // 일할 분자(소정근로일 출근 dedup, schedDays 상한)
  prorated?: boolean;
  // 가산수당
  overtimeHours?: number;
  overtimePay?: number;
  nightHours?: number;
  nightPay?: number;
  holidayHours?: number;
  holidayPay?: number;
  holidayHours8?: number;
  holidayHoursOver8?: number;
  holidayOtHoursOver8?: number; // 휴일 '연장'분 중 8h 초과(0.5배 보충 가산 대상 — 연장 1.5배와 합쳐 계 2.0배)
  holidayOtExtraPay?: number;
  weeklyHolidayPay?: number;
  weeklyHolidayDetail?: WeeklyHolidayDetail;
  // 통상시급·산식·경고
  ordinaryWage?: number;
  calcMethods?: Record<string, string>;
  incomeWarn?: string;
  insuranceReview?: string;
  pensionBase?: number;
  pensionBaseClamped?: boolean;
  // 최종 병합분(itemInputs.push 시 추가)
  incomeType?: string;
  deductionBreakdown?: Record<string, number>;
  payLines?: PayLine[];
  deductLines?: DeductLine[];
  basicInfo?: PayrollBasicInfo;
  totalHours?: number;
  insurance?: PayrollInsurance;
  // 과거 데이터/부분 채움 허용(알 수 없는 키는 unknown).
  [key: string]: unknown;
}
