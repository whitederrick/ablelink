import { describe, it, expect, afterEach } from "vitest";
import { outboundAllowed } from "@/lib/outboundGuard";

// process.env를 직접 만지므로 케이스마다 복원
const KEYS = ["OUTBOUND_LIVE", "DB_ENV", "NODE_ENV"] as const;
const orig: Record<string, string | undefined> = {};
for (const k of KEYS) orig[k] = process.env[k];

// process.env.NODE_ENV 등이 타입상 읽기전용이라 캐스팅 후 할당
const ENV = process.env as Record<string, string | undefined>;

function setEnv(e: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const k of KEYS) {
    if (k in e) {
      const v = e[k];
      if (v === undefined) delete ENV[k];
      else ENV[k] = v;
    }
  }
}

afterEach(() => {
  for (const k of KEYS) {
    if (orig[k] === undefined) delete ENV[k];
    else ENV[k] = orig[k];
  }
});

describe("outboundAllowed — dev 안전모드(외부 발송/결제) 게이트", () => {
  it("OUTBOUND_LIVE=1 이면 dev여도 허용(명시적 강제)", () => {
    setEnv({ OUTBOUND_LIVE: "1", DB_ENV: "development", NODE_ENV: "development" });
    expect(outboundAllowed()).toBe(true);
  });

  it("DB_ENV=development 이면 차단(NODE_ENV=production이어도)", () => {
    setEnv({ OUTBOUND_LIVE: undefined, DB_ENV: "development", NODE_ENV: "production" });
    expect(outboundAllowed()).toBe(false);
  });

  it("운영(NODE_ENV=production, DB_ENV 미설정) 이면 허용", () => {
    setEnv({ OUTBOUND_LIVE: undefined, DB_ENV: undefined, NODE_ENV: "production" });
    expect(outboundAllowed()).toBe(true);
  });

  it("개발 기본(NODE_ENV≠production, 플래그 없음) 이면 차단", () => {
    setEnv({ OUTBOUND_LIVE: undefined, DB_ENV: undefined, NODE_ENV: "development" });
    expect(outboundAllowed()).toBe(false);
  });
});
