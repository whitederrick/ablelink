import { describe, it, expect } from "vitest";
import { accountRateLimitKey, ACCOUNT_LOGIN_POLICY } from "@/lib/rateLimit";

// 로그인 계정 축 레이트리밋(B-2, 2026-08-11)
//
// admin/manager는 IP 단일축이라, 분산 IP(봇넷·프록시 로테이션)에서 한 계정을 집중 공격하면 시도가
// 한 예산에 누적되지 않았다. 계정 축을 추가하며 키 파생 규칙과 예산 결정을 테스트로 고정한다.

describe("accountRateLimitKey", () => {
  it("★loginId 원문이 키에 나타나지 않는다", () => {
    // Redis 키 목록이 유출되면 그 자체로 유효 계정명 사전이 되므로 해시만 넣는다.
    const key = accountRateLimitKey("admin-login-acct", "superadmin");
    expect(key).not.toContain("superadmin");
    expect(key).toBe("admin-login-acct:" + key.split(":")[1]);
    expect(key.split(":")[1]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("정규화 — 대소문자·앞뒤 공백이 달라도 같은 계정으로 집계", () => {
    // 이게 없으면 "Admin"/"admin"/" admin "로 번갈아 시도해 계정 축 예산을 3배로 늘릴 수 있다.
    const base = accountRateLimitKey("admin-login-acct", "admin01");
    expect(accountRateLimitKey("admin-login-acct", "ADMIN01")).toBe(base);
    expect(accountRateLimitKey("admin-login-acct", "  admin01  ")).toBe(base);
    expect(accountRateLimitKey("admin-login-acct", "Admin01")).toBe(base);
  });

  it("다른 계정은 다른 키", () => {
    expect(accountRateLimitKey("admin-login-acct", "admin01"))
      .not.toBe(accountRateLimitKey("admin-login-acct", "admin02"));
  });

  it("★접두사로 admin/manager 키 공간 분리 — 같은 loginId여도 서로 다른 예산", () => {
    // Admin과 Manager는 별개 테이블이라 같은 loginId가 동시에 존재할 수 있다. 한쪽 공격이 다른 쪽
    // 정상 로그인을 잠그면 안 된다.
    expect(accountRateLimitKey("admin-login-acct", "same-id"))
      .not.toBe(accountRateLimitKey("manager-login-acct", "same-id"));
  });

  it("존재하지 않는 계정도 동일 규칙으로 키가 나온다", () => {
    // 호출부가 DB 조회 전에 검사하므로, 계정 유무와 무관하게 항상 키가 파생돼야 한다.
    expect(accountRateLimitKey("admin-login-acct", "no-such-account-xyz")).toMatch(/^admin-login-acct:[0-9a-f]{32}$/);
  });
});

describe("ACCOUNT_LOGIN_POLICY", () => {
  it("★계정 축 예산은 IP 축(기본 10회)보다 느슨하다", () => {
    // 계정 축을 더 조이면 공격자가 남의 계정을 고의로 잠그는 서비스 거부(account lockout DoS)가 쉬워진다.
    expect(ACCOUNT_LOGIN_POLICY.max).toBe(20);
    expect(ACCOUNT_LOGIN_POLICY.max! > 10).toBe(true);
  });

  it("윈도우 15분 · 차단 30분 — IP 축과 동일 시간 규모", () => {
    expect(ACCOUNT_LOGIN_POLICY.windowSec).toBe(15 * 60);
    expect(ACCOUNT_LOGIN_POLICY.blockSec).toBe(30 * 60);
  });
});
