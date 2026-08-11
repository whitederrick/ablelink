import { describe, it, expect } from "vitest";
import { isValidYmd } from "@/lib/time";

// 저장 전 날짜 검증 회귀 테스트 (2026-08-11, Phase 1)
//
// 배경: 아래 3개 경로가 형태 정규식(/^\d{4}-\d{2}-\d{2}$/)만으로 날짜를 검증해,
//  달력에 존재하지 않는 날짜(2026-02-31, 1975-13-40 등)가 그대로 통과했다.
//   ① app/api/admin/workers/[id]/route.ts  birthDate  → String 컬럼 verbatim 저장(근로계약서·명세서에 인쇄)
//   ② app/api/worker/holidays/route.ts     date       → SiteHoliday.date(String) verbatim 저장(유령 휴무)
//   ③ app/api/worker/attendance/bulk-generate/route.ts from/to → Date.UTC 롤오버로 '다른 달'에 출근부 생성
//  → 셋 모두 lib/time.isValidYmd(왕복검증)로 통일했다. 이 테스트는 그 단일 소스의 계약을 고정한다.

describe("isValidYmd — 실존 날짜만 통과", () => {
  it("정상 날짜 통과", () => {
    ["2026-01-01", "2026-02-28", "2026-06-30", "2026-12-31", "1975-03-09"].forEach((s) =>
      expect(isValidYmd(s), s).toBe(true),
    );
  });

  it("윤년 2월 29일 — 윤년만 통과", () => {
    expect(isValidYmd("2024-02-29")).toBe(true);  // 윤년
    expect(isValidYmd("2000-02-29")).toBe(true);  // 400으로 나누어떨어지는 세기 = 윤년
    expect(isValidYmd("2025-02-29")).toBe(false); // 평년
    expect(isValidYmd("1900-02-29")).toBe(false); // 100의 배수지만 400의 배수가 아님 = 평년
  });

  it("형태가 어긋나면 거부", () => {
    ["2026-1-1", "20260101", "2026/01/01", "2026-01-01T00:00:00.000Z", "", " ", "26-01-01"].forEach((s) =>
      expect(isValidYmd(s), s).toBe(false),
    );
  });

  it("문자열이 아니면 거부", () => {
    [null, undefined, 20260101, {}, [], new Date()].forEach((v) =>
      expect(isValidYmd(v), String(v)).toBe(false),
    );
  });

  // ★핵심 회귀: 형태 정규식은 통과하지만 달력에 없는 날짜들.
  //  수정 전 3개 경로가 전부 이 값들을 저장했다.
  it("형태는 맞지만 달력에 없는 날짜는 거부", () => {
    const SHAPE_OK = /^\d{4}-\d{2}-\d{2}$/;
    const bogus = [
      "2026-02-31", // 2월 31일
      "2026-02-30",
      "2026-04-31", // 30일까지인 달
      "2026-06-31",
      "2026-09-31",
      "2026-11-31",
      "1975-13-40", // 감사에서 지목된 실제 입력값
      "2026-00-10", // 0월
      "2026-01-00", // 0일
      "2026-13-01", // 13월
      "2026-01-32",
    ];
    for (const s of bogus) {
      expect(SHAPE_OK.test(s), `${s}: 형태 정규식은 통과해야 함(회귀의 전제)`).toBe(true);
      expect(isValidYmd(s), `${s}: isValidYmd가 차단해야 함`).toBe(false);
    }
  });

  it("Date.parse 롤오버에 속지 않는다", () => {
    // new Date("2026-02-31") 계열은 NaN이 아니라 3/3으로 '롤오버'된다 → 왕복검증이 필요한 이유.
    expect(new Date("2026-02-31T00:00:00.000Z").toString()).not.toBe("Invalid Date");
    expect(isValidYmd("2026-02-31")).toBe(false);
  });
});

// bulk-generate가 실제로 쓰는 날짜 열거 로직. 검증을 통과한 입력에서만 안전함을 고정한다.
describe("bulk-generate 날짜 열거 — 롤오버 회귀", () => {
  // app/api/worker/attendance/bulk-generate/route.ts enumerateDates와 동일 로직
  function enumerateDates(from: string, to: string): string[] {
    const out: string[] = [];
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    let cur = Date.UTC(fy, fm - 1, fd);
    const end = Date.UTC(ty, tm - 1, td);
    while (cur <= end) {
      out.push(new Date(cur).toISOString().slice(0, 10));
      cur += 24 * 60 * 60 * 1000;
    }
    return out;
  }

  it("검증 통과 입력은 입력 기간과 정확히 일치", () => {
    const days = enumerateDates("2026-02-26", "2026-03-02");
    expect(days).toEqual(["2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(days[0]).toBe("2026-02-26");
    expect(days[days.length - 1]).toBe("2026-03-02");
  });

  it("★검증을 우회한 실존하지 않는 날짜는 다른 달로 롤오버된다(수정의 근거)", () => {
    // Date.UTC(2026, 1, 31) = 2026-03-03. 사용자가 '2월 말까지'로 의도한 요청이
    // 3월 출근부를 만들어 급여·문서까지 오염시킨다.
    const rolled = enumerateDates("2026-02-31", "2026-02-31");
    expect(rolled).toEqual(["2026-03-03"]);
    // → 그래서 라우트가 enumerateDates 이전에 isValidYmd로 차단한다.
    expect(isValidYmd("2026-02-31")).toBe(false);
  });

  it("게이트 통과 여부가 롤오버 발생과 일치한다", () => {
    const cases = [
      { input: "2026-02-28", shouldPass: true },
      { input: "2026-02-31", shouldPass: false },
      { input: "2026-04-31", shouldPass: false },
      { input: "2024-02-29", shouldPass: true },
    ];
    for (const { input, shouldPass } of cases) {
      expect(isValidYmd(input), input).toBe(shouldPass);
      if (shouldPass) {
        // 통과한 입력은 열거 결과의 첫 날짜가 입력과 같다(롤오버 없음)
        expect(enumerateDates(input, input)).toEqual([input]);
      } else {
        // 차단된 입력은 열거 시 입력과 다른 날짜가 나온다(= 차단해야 하는 이유)
        expect(enumerateDates(input, input)[0]).not.toBe(input);
      }
    }
  });
});
