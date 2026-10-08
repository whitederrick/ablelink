import { describe, it, expect } from "vitest";
import { maskEmailForLog } from "@/lib/maskEmail";

describe("maskEmailForLog", () => {
  it("로컬파트는 앞 2자만 남기고 도메인은 유지", () => {
    expect(maskEmailForLog("manager@company.co.kr")).toBe("ma***@company.co.kr");
  });
  it("짧은 로컬파트도 원문이 복원되지 않는다", () => {
    expect(maskEmailForLog("a@x.com")).toBe("a***@x.com");
  });
  it("공백 제거, 형식이 아니면 전부 마스킹", () => {
    expect(maskEmailForLog("  hong@x.com ")).toBe("ho***@x.com");
    expect(maskEmailForLog("not-an-email")).toBe("***");
    expect(maskEmailForLog("@x.com")).toBe("***");
  });
});
