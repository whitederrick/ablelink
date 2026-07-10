import { describe, it, expect } from "vitest";
import { getKrHolidays, getKrHolidayDates, isKrHoliday } from "@/lib/krHolidays";

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 그물: 공휴일 정적 데이터는 손으로 입력하므로 오타/하루밀림/월오입력이
// 조용히 급여·결근·주휴 계산을 왜곡한다(2026 설날 하루밀림 P1이 그 예).
// 아래 기준값은 관공서 공휴일 고시 + 요일 산술로 교차검증한 확정치.
// 데이터 수정 시 이 테스트가 회귀를 잡는다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 음력 명절은 매년 손입력이라 가장 취약(하루밀림·월오입력).
 * seollalDay/chuseokDay = 명절 '당일'(양력). 하루밀림이 나면 당일 라벨이 엉뚱한 날짜에 붙으므로
 * "당일 날짜의 라벨 === 설날/추석" 단정이 밀림을 직접 잡는다.
 * days = 연휴 전체(대체 포함). 월 오입력은 정확한 날짜 존재 단정이 잡는다.
 */
const LUNAR: Record<number, { seollalDay: string; seollal: string[]; chuseokDay: string; chuseok: string[] }> = {
  2024: { seollalDay: "2024-02-10", seollal: ["2024-02-09", "2024-02-10", "2024-02-11"], chuseokDay: "2024-09-17", chuseok: ["2024-09-16", "2024-09-17", "2024-09-18"] },
  2025: { seollalDay: "2025-01-29", seollal: ["2025-01-28", "2025-01-29", "2025-01-30"], chuseokDay: "2025-10-06", chuseok: ["2025-10-05", "2025-10-06", "2025-10-07"] },
  // ★설날 당일 2/17(화) → 연휴 2/16·17·18. (기존 2/17·18·19 하루밀림 = P1)
  2026: { seollalDay: "2026-02-17", seollal: ["2026-02-16", "2026-02-17", "2026-02-18"], chuseokDay: "2026-09-25", chuseok: ["2026-09-24", "2026-09-25", "2026-09-26"] },
  // ★설날 당일 2/6(토) → 연휴 2/5·6·7 + 대체 2/8(월) / 추석 당일 9/15(수) → 9/14·15·16
  2027: { seollalDay: "2027-02-06", seollal: ["2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08"], chuseokDay: "2027-09-15", chuseok: ["2027-09-14", "2027-09-15", "2027-09-16"] },
};

describe("krHolidays — 음력 명절 날짜 정합(하루밀림·월오입력 방지)", () => {
  for (const [year, v] of Object.entries(LUNAR)) {
    const y = Number(year);
    it(`${y} 설날 당일=${v.seollalDay}, 연휴=${v.seollal.join(", ")}`, () => {
      const m = getKrHolidays(y, Number(v.seollalDay.slice(5, 7)));
      expect(m[v.seollalDay], `${v.seollalDay}은 '설날'이어야 함(하루밀림 감지)`).toBe("설날");
      for (const d of v.seollal) expect(isKrHoliday(d), `${d}은 설날 연휴여야 함`).toBe(true);
    });
    it(`${y} 추석 당일=${v.chuseokDay}, 연휴=${v.chuseok.join(", ")}`, () => {
      const m = getKrHolidays(y, Number(v.chuseokDay.slice(5, 7)));
      expect(m[v.chuseokDay], `${v.chuseokDay}은 '추석'이어야 함(하루밀림/월오입력 감지)`).toBe("추석");
      for (const d of v.chuseok) expect(isKrHoliday(d), `${d}은 추석 연휴여야 함`).toBe(true);
    });
  }
});

describe("krHolidays — 2026 설날 하루밀림 회귀 고정(P1)", () => {
  it("2026-02-16(실제 공휴일) 포함, 2026-02-19(평일) 제외", () => {
    const feb = getKrHolidays(2026, 2);
    expect(feb["2026-02-16"]).toBeTruthy();
    expect(feb["2026-02-17"]).toBe("설날");
    expect(feb["2026-02-19"]).toBeUndefined();
  });
});

describe("krHolidays — 2027 대체공휴일 정합", () => {
  it("광복절(8/15 일)→대체 8/16 존재, 현충일(6/6 일)은 대체 없음", () => {
    expect(isKrHoliday("2027-08-16")).toBe(true); // 광복절 대체
    expect(isKrHoliday("2027-06-07")).toBe(false); // 현충일은 대체공휴일 대상 아님
  });
  it("한글날(10/9 토)→대체 10/11, 성탄절(12/25 토)→대체 12/27", () => {
    expect(isKrHoliday("2027-10-11")).toBe(true);
    expect(isKrHoliday("2027-12-27")).toBe(true);
  });
});

describe("krHolidays — 범위 조회", () => {
  it("getKrHolidayDates는 정렬된 범위 내 공휴일만 반환", () => {
    const dates = getKrHolidayDates("2026-02-01", "2026-02-28");
    expect(dates).toEqual(["2026-02-16", "2026-02-17", "2026-02-18"]);
  });
});
