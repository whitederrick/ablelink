import { describe, it, expect } from "vitest";
import { escapeCsvCell, csvBody } from "@/lib/csv";

describe("escapeCsvCell — 수식 인젝션 방지(G1)", () => {
  it("= + @ 로 시작하는 수식은 작은따옴표로 무력화", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("@foo")).toBe("'@foo");
    expect(escapeCsvCell("+cmd|calc")).toBe("'+cmd|calc"); // 콤마/따옴표 없음 → 접두만, 감싸지 않음
  });

  it("★-숫자로 시작하는 수식 페이로드도 반드시 이스케이프(과거 우회 지점)", () => {
    // -1+cmd|... 는 -1로 시작해 예전 예외(!/^-?\d/)를 통과했다 → 지금은 전체가 숫자가 아니므로 이스케이프.
    expect(escapeCsvCell("-1+cmd|'/C calc'!A0").startsWith("'")).toBe(true);
    expect(escapeCsvCell("-2+3+cmd").startsWith("'")).toBe(true);
  });

  it("전체가 숫자/좌표면 예외(이스케이프 안 함)", () => {
    expect(escapeCsvCell("12000")).toBe("12000");
    expect(escapeCsvCell("-37.5")).toBe("-37.5");
    expect(escapeCsvCell(-100)).toBe("-100");
  });

  it("R2-7: + 국제전화는 Excel 표시 위해 이스케이프('+8210…)", () => {
    // 사람이 Excel로 여는 게 기본 → '+' 시작 값은 이스케이프해야 Excel이 수식으로 안 먹고 텍스트로 표시.
    expect(escapeCsvCell("+821012345678")).toBe("'+821012345678");
    // 숫자로 시작(formula-char 아님)하는 전화는 애초에 이스케이프 로직 대상 아님 → 원본 유지.
    expect(escapeCsvCell("010-1234-5678")).toBe("010-1234-5678");
    expect(escapeCsvCell("+1+cmd").startsWith("'")).toBe(true);
  });

  it("구분자/개행/따옴표 포함 시 표준 CSV 큰따옴표 감싸기", () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvCell(null)).toBe("");
  });
});

describe("csvBody", () => {
  it("BOM + \\r\\n 직렬화, 셀 이스케이프 적용", () => {
    const out = csvBody(["이름", "메모"], [["홍길동", "=1+1"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain("'=1+1");
    expect(out.split("\r\n").length).toBe(2);
  });
});
