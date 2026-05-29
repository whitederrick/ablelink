import { describe, it, expect } from "vitest";
import { parseBigInt } from "@/lib/adminScope";

// API 라우트 공통 입력 검증 패턴 테스트

describe("URL 파라미터 ID 검증 (parseBigInt)", () => {
  it("정상 ID → BigInt 변환", () => {
    expect(parseBigInt("1")).toBeTruthy();
    expect(parseBigInt("123456789")).toBeTruthy();
  });

  it("문자열 ID → null (400 반환용)", () => {
    expect(parseBigInt("abc")).toBeNull();
  });

  it("소수점 → null", () => {
    expect(parseBigInt("1.5")).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(parseBigInt("")).toBeNull();
  });

  it("공백 → null", () => {
    expect(parseBigInt(" ")).toBeNull();
  });
});

describe("공지 발송 유형 검증", () => {
  const VALID_TYPES = ["INFO", "MAINTENANCE", "URGENT"];
  const sanitize = (t: string) => VALID_TYPES.includes(t) ? t : "INFO";

  it("유효한 타입 통과", () => {
    expect(sanitize("INFO")).toBe("INFO");
    expect(sanitize("MAINTENANCE")).toBe("MAINTENANCE");
    expect(sanitize("URGENT")).toBe("URGENT");
  });

  it("잘못된 타입 → INFO 폴백", () => {
    expect(sanitize("HACK")).toBe("INFO");
    expect(sanitize("")).toBe("INFO");
    expect(sanitize("<script>")).toBe("INFO");
  });
});

describe("SupportTicket 카테고리 검증", () => {
  const VALID = ["GENERAL", "DATA_FIX", "BILLING", "OTHER"];
  const sanitize = (c: string) => VALID.includes(c) ? c : "GENERAL";

  it("유효한 카테고리 통과", () => {
    VALID.forEach(c => expect(sanitize(c)).toBe(c));
  });

  it("잘못된 카테고리 → GENERAL 폴백", () => {
    expect(sanitize("UNKNOWN")).toBe("GENERAL");
    expect(sanitize("")).toBe("GENERAL");
  });
});

describe("AgencyPlanType 화이트리스트 검증", () => {
  const VALID_PLANS = ["FREE", "TRIAL", "STARTER", "STANDARD", "PRO"];
  const isValid = (p: string) => VALID_PLANS.includes(p);

  it("유효한 플랜 통과", () => {
    VALID_PLANS.forEach(p => expect(isValid(p)).toBe(true));
  });

  it("잘못된 플랜 → 거부", () => {
    expect(isValid("PREMIUM")).toBe(false);
    expect(isValid("")).toBe(false);
    expect(isValid("FREE; DROP TABLE")).toBe(false);
  });
});

describe("날짜 형식 검증", () => {
  const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  const YM_REGEX   = /^\d{4}-\d{2}$/;

  it("YYYY-MM-DD 형식 통과", () => {
    expect(DATE_REGEX.test("2026-05-29")).toBe(true);
    expect(DATE_REGEX.test("2024-02-29")).toBe(true);
  });

  it("잘못된 날짜 형식 → 거부", () => {
    expect(DATE_REGEX.test("2026-5-29")).toBe(false);
    expect(DATE_REGEX.test("20260529")).toBe(false);
    expect(DATE_REGEX.test("2026/05/29")).toBe(false);
  });

  it("YYYY-MM 형식 통과", () => {
    expect(YM_REGEX.test("2026-05")).toBe(true);
  });

  it("잘못된 YYYY-MM 형식 → 거부", () => {
    expect(YM_REGEX.test("2026-5")).toBe(false);
    expect(YM_REGEX.test("2026-05-01")).toBe(false);
  });
});
