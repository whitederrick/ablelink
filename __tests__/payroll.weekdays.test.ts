import { describe, it, expect } from "vitest";
import {
  parseWorkingWeekdays, serializeWorkingWeekdays, deriveWorkingWeekdays,
  resolveWorkingWeekdaySet, validateWorkingWeekdays,
} from "@/lib/payroll/weekdays";

describe("parse/serialize", () => {
  it("정상 파싱·정렬·중복제거", () => {
    expect(parseWorkingWeekdays("1,3,5")).toEqual([1, 3, 5]);
    expect(parseWorkingWeekdays("5,1,3,1")).toEqual([1, 3, 5]);
    expect(parseWorkingWeekdays(" 1 , 3 , 5 ")).toEqual([1, 3, 5]);
  });
  it("null/빈/형식오류 → null(파생 폴백)", () => {
    expect(parseWorkingWeekdays(null)).toBeNull();
    expect(parseWorkingWeekdays("")).toBeNull();
    expect(parseWorkingWeekdays("7")).toBeNull();   // 범위 밖
    expect(parseWorkingWeekdays("-1")).toBeNull();
    expect(parseWorkingWeekdays("a,b")).toBeNull();
  });
  it("serialize", () => {
    expect(serializeWorkingWeekdays([5, 1, 3])).toBe("1,3,5");
    expect(serializeWorkingWeekdays([1, 1, 7, 3])).toBe("1,3"); // 중복·범위밖 제거
  });
});

// ★핵심(무회귀 앵커): 파생 로직이 기존 computeRun 인라인 로직과 완전 동치여야 한다.
describe("deriveWorkingWeekdays — 기존 computeRun 로직 동치", () => {
  // 기존 로직 재현: [1,2,3,4,5,6,0]에서 restDow 제외, wpw개
  const oldLogic = (wpw: number, restLabel: string | null) => {
    const LABEL: Record<string, number> = { "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6 };
    const restDow = restLabel ? (LABEL[restLabel] ?? 0) : 0;
    const s = new Set<number>();
    for (const d of [1, 2, 3, 4, 5, 6, 0]) { if (d === restDow) continue; s.add(d); if (s.size >= wpw) break; }
    return [...s].sort((a, b) => a - b);
  };
  for (const wpw of [1, 2, 3, 4, 5, 6, 7]) {
    for (const rest of [null, "일", "월", "화", "수", "목", "금", "토"]) {
      it(`wpw=${wpw} 주휴=${rest ?? "없음"}`, () => {
        expect([...deriveWorkingWeekdays(wpw, rest)].sort((a, b) => a - b)).toEqual(oldLogic(wpw, rest));
      });
    }
  }
  it("기본값(주5일·일요일주휴) = 월~금", () => {
    expect(deriveWorkingWeekdays(5, "일").sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
  it("주6일·일요일주휴 = 월~토", () => {
    expect(deriveWorkingWeekdays(6, "일").sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("resolveWorkingWeekdaySet — 명시 우선, 없으면 파생", () => {
  it("명시 CSV 우선(MWF)", () => {
    expect([...resolveWorkingWeekdaySet("1,3,5", 5, "일")].sort((a, b) => a - b)).toEqual([1, 3, 5]);
  });
  it("명시 없으면 파생(주5일·일)", () => {
    expect([...resolveWorkingWeekdaySet(null, 5, "일")].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
  it("형식오류 CSV → 파생 폴백", () => {
    expect([...resolveWorkingWeekdaySet("9,9", 5, "일")].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("validateWorkingWeekdays", () => {
  it("정상", () => {
    expect(validateWorkingWeekdays([1, 3, 5], { weeklyHolidayLabel: "일", workDaysPerWeek: 3 })).toEqual({ ok: true });
  });
  it("빈 값 거부", () => {
    expect(validateWorkingWeekdays([]).ok).toBe(false);
  });
  it("주휴일 포함 거부", () => {
    expect(validateWorkingWeekdays([0, 1, 3], { weeklyHolidayLabel: "일" }).ok).toBe(false); // 0=일=주휴
  });
  it("개수 불일치 거부", () => {
    expect(validateWorkingWeekdays([1, 3, 5], { workDaysPerWeek: 5 }).ok).toBe(false);
  });
  it("범위 밖 거부", () => {
    expect(validateWorkingWeekdays([1, 7]).ok).toBe(false);
  });
});
