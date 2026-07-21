// 일지 자유텍스트 길이 상한 (lib/docs/logTextLimit) — 감사 P2 회귀 방지.
import { describe, it, expect } from "vitest";
import { MAX_LOG_TEXT_LEN, checkLogText } from "@/lib/docs/logTextLimit";

describe("checkLogText", () => {
  it("상한 이내는 통과(null)", () => {
    expect(checkLogText("지도사항", "a".repeat(MAX_LOG_TEXT_LEN))).toBeNull();
    expect(checkLogText("지도사항", "")).toBeNull();
    expect(checkLogText("지도사항", null)).toBeNull();
    expect(checkLogText("지도사항", undefined)).toBeNull();
  });
  it("상한 초과는 라벨 포함 메시지 반환", () => {
    const msg = checkLogText("특이사항", "a".repeat(MAX_LOG_TEXT_LEN + 1));
    expect(msg).toContain("특이사항");
    expect(msg).toContain(String(MAX_LOG_TEXT_LEN));
  });
  it("비문자열은 통과(다른 검증 책임)", () => {
    expect(checkLogText("지도사항", 123 as unknown)).toBeNull();
  });
  it("상한이 붕괴 임계(~900자) 아래", () => {
    expect(MAX_LOG_TEXT_LEN).toBeLessThan(900);
  });
});
