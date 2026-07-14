import { describe, it, expect } from "vitest";
import {
  determineIncomeType,
  determineInsurances,
  determineEligibility,
  isIllegalBusinessIncome,
} from "@/lib/payroll/insuranceEligibility";

describe("determineIncomeType (근로자성)", () => {
  it("근로계약서 있으면 무조건 근로소득", () => {
    expect(determineIncomeType({ hasEmploymentContract: true, hasAttendance: true })).toBe("EMPLOYMENT");
    expect(determineIncomeType({ hasEmploymentContract: true, hasAttendance: false, freelancerOverride: true })).toBe("EMPLOYMENT");
  });
  it("계약 없는 독립 프리랜서만 사업소득", () => {
    expect(determineIncomeType({ hasEmploymentContract: false, hasAttendance: false, freelancerOverride: true })).toBe("BUSINESS");
  });
  it("계약서 없어도 근태 있으면 근로소득(근로자성)", () => {
    expect(determineIncomeType({ hasEmploymentContract: false, hasAttendance: true })).toBe("EMPLOYMENT");
  });
  it("기본값은 근로소득(임의 3.3% 방지)", () => {
    expect(determineIncomeType({ hasEmploymentContract: false, hasAttendance: false })).toBe("EMPLOYMENT");
  });
  it("근로계약 있는데 사업소득 지정 = 위법 소지", () => {
    expect(isIllegalBusinessIncome(true, "BUSINESS")).toBe(true);
    expect(isIllegalBusinessIncome(false, "BUSINESS")).toBe(false);
    expect(isIllegalBusinessIncome(true, "EMPLOYMENT")).toBe(false);
  });
});

describe("determineInsurances (4대보험 차등)", () => {
  const base = { employmentMonths: 12, monthlyHours: 100, monthlyDays: 20, continuousMonths: 12 };

  it("사업소득 → 가입 없음", () => {
    const r = determineInsurances("BUSINESS", base);
    expect(r.tier).toBe("NONE");
    expect(r.insurances).toEqual([]);
    expect(r.workerDeductible).toEqual([]);
  });

  it("일용(1개월 미만) → 고용+산재, 워커공제=고용", () => {
    const r = determineInsurances("EMPLOYMENT", { ...base, employmentMonths: 0.5 });
    expect(r.tier).toBe("DAILY_WORKER");
    expect(r.insurances.sort()).toEqual(["employment", "industrial"]);
    expect(r.workerDeductible).toEqual(["employment"]);
  });

  it("일반(월 60h↑) → 4대보험 전부, 워커공제=산재 제외 4종", () => {
    const r = determineInsurances("EMPLOYMENT", { ...base, monthlyHours: 80, monthlyDays: 5 });
    expect(r.tier).toBe("REGULAR");
    expect(r.insurances).toContain("industrial");
    expect(r.workerDeductible.sort()).toEqual(["employment", "health", "ltc", "pension"]);
  });

  it("월 8일↑이나 60h 미만 → 국민연금만(건강·장기요양 제외 — 단시간 과다부과 방지)", () => {
    // continuousMonths<3 로 고용보험 3개월 예외도 배제 → 순수 8일 트랙만 검증
    const r = determineInsurances("EMPLOYMENT", { ...base, monthlyHours: 40, monthlyDays: 10, continuousMonths: 1 });
    expect(r.tier).toBe("REGULAR");
    expect(r.insurances).toContain("pension");
    expect(r.insurances).toContain("industrial");
    expect(r.insurances).not.toContain("health"); // ★8일 트랙에서 건강보험 제거
    expect(r.insurances).not.toContain("ltc");
    expect(r.insurances).not.toContain("employment"); // 60h 미만 & 계속근로<3개월
    expect(r.workerDeductible.sort()).toEqual(["pension"]);
  });

  it("월 8일↑ & 60h 미만 & 계속근로 3개월↑ → 국민연금+고용(건강·장기요양은 여전히 제외)", () => {
    const r = determineInsurances("EMPLOYMENT", { ...base, monthlyHours: 40, monthlyDays: 10, continuousMonths: 6 });
    expect(r.tier).toBe("REGULAR");
    expect(r.workerDeductible.sort()).toEqual(["employment", "pension"]);
    expect(r.insurances).not.toContain("health");
  });

  it("초단시간(월60h·8일 미만, 계속근로<3개월) → 산재만, 워커공제 없음", () => {
    const r = determineInsurances("EMPLOYMENT", { employmentMonths: 2, monthlyHours: 40, monthlyDays: 6, continuousMonths: 1 });
    expect(r.tier).toBe("ULTRA_SHORT");
    expect(r.insurances).toEqual(["industrial"]);
    expect(r.workerDeductible).toEqual([]);
  });

  it("초단시간 + 3개월↑ 계속근로 → 고용보험 추가", () => {
    const r = determineInsurances("EMPLOYMENT", { employmentMonths: 6, monthlyHours: 40, monthlyDays: 6, continuousMonths: 4 });
    expect(r.tier).toBe("ULTRA_SHORT");
    expect(r.insurances.sort()).toEqual(["employment", "industrial"]);
    expect(r.workerDeductible).toEqual(["employment"]);
  });

  it("우선순위: 1개월 미만이면 시간 많아도 일용", () => {
    const r = determineInsurances("EMPLOYMENT", { employmentMonths: 0.9, monthlyHours: 200, monthlyDays: 25, continuousMonths: 1 });
    expect(r.tier).toBe("DAILY_WORKER");
  });

  it("달력 기준 boolean 우선: employmentUnderOneMonth=true면 employmentMonths 커도 일용", () => {
    const r = determineInsurances("EMPLOYMENT", { ...base, employmentMonths: 12, employmentUnderOneMonth: true });
    expect(r.tier).toBe("DAILY_WORKER");
  });

  it("달력 기준 boolean 우선: employmentUnderOneMonth=false면 employmentMonths 작아도 일용 아님", () => {
    const r = determineInsurances("EMPLOYMENT", { ...base, employmentMonths: 0.9, employmentUnderOneMonth: false, monthlyHours: 80, monthlyDays: 20 });
    expect(r.tier).toBe("REGULAR");
  });
});

describe("국민연금 검토대상(needsPensionReview) — <1개월이나 월 8일↑/60h↑", () => {
  it("<1개월 & 월 8일↑ → 검토대상 플래그 O, 단 국민연금 자동공제는 안 함", () => {
    const r = determineInsurances("EMPLOYMENT", { employmentMonths: 0.7, monthlyHours: 30, monthlyDays: 10, continuousMonths: 1 });
    expect(r.tier).toBe("DAILY_WORKER");
    expect(r.needsPensionReview).toBe(true);
    expect(r.workerDeductible).toEqual(["employment"]); // pension 미포함 = 자동공제 없음
    expect(r.insurances).not.toContain("pension");
  });
  it("<1개월 & 월 60h↑(일수는 8 미만) → 검토대상", () => {
    const r = determineInsurances("EMPLOYMENT", { employmentMonths: 0.7, monthlyHours: 65, monthlyDays: 5, continuousMonths: 1 });
    expect(r.tier).toBe("DAILY_WORKER");
    expect(r.needsPensionReview).toBe(true);
  });
  it("<1개월 & 8일 미만 & 60h 미만 → 검토대상 아님", () => {
    const r = determineInsurances("EMPLOYMENT", { employmentMonths: 0.7, monthlyHours: 30, monthlyDays: 5, continuousMonths: 1 });
    expect(r.tier).toBe("DAILY_WORKER");
    expect(r.needsPensionReview).toBe(false);
  });
});

describe("determineEligibility (통합)", () => {
  it("직무지도원 표준 케이스: 근로계약+근태, 정규 근로 → 근로소득·4대보험 전부", () => {
    const r = determineEligibility(
      { hasEmploymentContract: true, hasAttendance: true },
      { employmentMonths: 12, monthlyHours: 90, monthlyDays: 20, continuousMonths: 12 },
    );
    expect(r.incomeType).toBe("EMPLOYMENT");
    expect(r.tier).toBe("REGULAR");
    expect(r.workerDeductible.sort()).toEqual(["employment", "health", "ltc", "pension"]);
  });
});
