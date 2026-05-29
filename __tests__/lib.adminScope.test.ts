import { describe, it, expect } from "vitest";
import { parseBigInt } from "@/lib/adminScope";

describe("parseBigInt", () => {
  it("정수 문자열을 BigInt로 변환", () => {
    expect(parseBigInt("123")).toBe(BigInt(123));
    expect(parseBigInt("1")).toBe(BigInt(1));
    expect(parseBigInt("9999999999999")).toBe(BigInt("9999999999999"));
  });

  it("0 변환", () => {
    expect(parseBigInt("0")).toBe(BigInt(0));
  });

  it("음수 변환", () => {
    expect(parseBigInt("-1")).toBe(BigInt(-1));
  });

  it("비숫자 문자열 → null 반환 (500 대신 400)", () => {
    expect(parseBigInt("abc")).toBeNull();
    expect(parseBigInt("")).toBeNull();
    expect(parseBigInt("undefined")).toBeNull();
  });

  it("부동소수점 → null 반환", () => {
    expect(parseBigInt("1.5")).toBeNull();
    expect(parseBigInt("1.0")).toBeNull();
  });

  it("과학적 표기법 → null 반환", () => {
    expect(parseBigInt("1e9")).toBeNull();
  });

  it("SQL 인젝션 패턴 → null 반환", () => {
    expect(parseBigInt("1; DROP TABLE users")).toBeNull();
    expect(parseBigInt("1 OR 1=1")).toBeNull();
  });

  it("undefined/null 입력 처리", () => {
    expect(parseBigInt(undefined)).toBeNull();
    expect(parseBigInt(null)).toBeNull();
  });
});
