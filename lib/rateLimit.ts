// lib/rateLimit.ts
// IP/키 기반 Rate Limiter
// Redis(Upstash) 환경변수가 있으면 Redis 사용, 없으면 인메모리 폴백 (로컬 개발용)

import { Redis } from "@upstash/redis";
import { createHash } from "crypto";

// 기본 정책(로그인 브루트포스용). 라우트별로 checkRateLimit(key, policy)로 완화/강화 가능.
const WINDOW_SEC = 15 * 60;   // 15분 윈도우
const MAX_ATTEMPTS = 10;       // 최대 시도 횟수
const BLOCK_SEC = 30 * 60;    // 30분 차단

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

// 정책 옵션 — 미지정 필드는 기본값 사용. (H1: 공개 서명 조회처럼 정상 트래픽이 많은 GET은 느슨한 예산 필요)
export interface RateLimitPolicy {
  max?: number;
  windowSec?: number;
  blockSec?: number;
}

// ── Redis 클라이언트 (환경변수 없으면 null) ──────────────────
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// ── Redis 기반 rate limit ─────────────────────────────────────
async function redisRateLimit(key: string, max: number, windowSec: number, blockSec: number): Promise<RateLimitResult> {
  const blockKey = `rl:block:${key}`;
  const countKey = `rl:count:${key}`;

  // 차단 중인지 확인
  const blockedUntil = await redis!.get<number>(blockKey);
  if (blockedUntil) {
    const retryAfterMs = blockedUntil - Date.now();
    if (retryAfterMs > 0) {
      return { allowed: false, remaining: 0, retryAfterMs };
    }
    await redis!.del(blockKey);
  }

  // 카운트 증가 후 'TTL 존재'를 보장한다 (fixed-window).
  //  ★원자화: INCR과 EXPIRE가 분리돼 있어, count===1에서만 EXPIRE하면 (a)EXPIRE 실패(Upstash 순간 장애)나
  //   (b)동시요청 경계(A incr→1, B incr→2 후 A의 되돌리기가 0에 못 미침)에서 TTL 없는 카운터가 영구 잔존한다
  //   → 이후 요청마다 누적돼 max 초과 → 차단 해제 후 즉시 재차단되는 '영구 차단 루프'(login-ip는 성공 리셋도 없음).
  //   count 값과 무관하게 매 요청 PTTL을 확인해 TTL이 없으면(-1/-2) EXPIRE를 재설정 → dangling 카운터 원천 차단.
  //   기존 TTL이 있으면 건드리지 않아 fixed-window 의미 유지. PTTL/EXPIRE 실패는 throw→인메모리 폴백(가용성 우선).
  const count = await redis!.incr(countKey);
  const ttl = await redis!.pttl(countKey);
  if (ttl < 0) {
    await redis!.expire(countKey, windowSec);
  }

  if (count > max) {
    const blockedUntilMs = Date.now() + blockSec * 1000;
    await redis!.set(blockKey, blockedUntilMs, { ex: blockSec });
    return { allowed: false, remaining: 0, retryAfterMs: blockSec * 1000 };
  }

  return { allowed: true, remaining: max - count };
}

// ── 인메모리 폴백 (로컬 개발용) ──────────────────────────────
interface Attempt { count: number; firstAt: number; blockedUntil?: number; }
const store = new Map<string, Attempt>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (now - val.firstAt > WINDOW_SEC * 2 * 1000) store.delete(key);
  }
}, 60_000);

function memoryRateLimit(key: string, max: number, windowSec: number, blockSec: number): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) {
    store.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: max - 1 };
  }
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return { allowed: false, remaining: 0, retryAfterMs: entry.blockedUntil - now };
  }
  if (now - entry.firstAt > windowSec * 1000) {
    store.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: max - 1 };
  }

  entry.count++;
  if (entry.count > max) {
    entry.blockedUntil = now + blockSec * 1000;
    return { allowed: false, remaining: 0, retryAfterMs: blockSec * 1000 };
  }
  return { allowed: true, remaining: max - entry.count };
}

// ── 공개 API ─────────────────────────────────────────────────
export async function checkRateLimit(key: string, policy?: RateLimitPolicy): Promise<RateLimitResult> {
  const max = policy?.max ?? MAX_ATTEMPTS;
  const windowSec = policy?.windowSec ?? WINDOW_SEC;
  const blockSec = policy?.blockSec ?? BLOCK_SEC;
  if (redis) {
    try {
      return await redisRateLimit(key, max, windowSec, blockSec);
    } catch (err) {
      // Redis(Upstash) 장애·DNS 실패 등으로 접근 불가하면 인메모리로 폴백.
      // rate limit 인프라 문제로 로그인 자체가 막히면 안 됨.
      console.error("[rateLimit] Redis 접근 실패, 인메모리 폴백:", err);
      return memoryRateLimit(key, max, windowSec, blockSec);
    }
  }
  return memoryRateLimit(key, max, windowSec, blockSec);
}

// ── 계정 축 로그인 레이트리밋 ────────────────────────────────
// IP 축만 있으면 분산 IP(봇넷·프록시 로테이션)에서 특정 계정 하나를 집중 공격할 때 시도가 한 예산에
// 누적되지 않아 사실상 무제한이 된다. 워커 로그인은 이미 IP+계정 2중이었고, admin/manager는 IP 단일축
// 이었다 — 계정 탈취 영향이 가장 큰 쪽에 축이 없던 셈이라 동일 구조로 맞춘다.
//
// 예산은 IP 축(10회/15분)보다 느슨하게 잡는다. 계정 축을 더 조이면 공격자가 남의 계정을 고의로 잠그는
// 서비스 거부(account lockout DoS)가 쉬워지기 때문이다.
export const ACCOUNT_LOGIN_POLICY: RateLimitPolicy = { max: 20, windowSec: 15 * 60, blockSec: 30 * 60 };

/**
 * 계정 축 레이트리밋 키. loginId 원문을 키에 넣지 않는다 — Redis 키 목록이 유출되면 그 자체로 유효
 * 계정명 사전이 되기 때문이다. 정규화(trim+소문자) 후 SHA-256 앞 32자를 쓴다.
 *
 * ★존재하지 않는 계정에도 동일하게 적용해야 한다(호출부가 DB 조회 전에 검사). 계정 유무에 따라
 *  레이트리밋 적용 여부가 달라지면 429/401 패턴만으로 계정 존재를 열거할 수 있다 — 더미 해시로 맞춰둔
 *  bcrypt 타이밍 패리티와 같은 이유다.
 */
export function accountRateLimitKey(prefix: string, loginId: string): string {
  const normalized = loginId.trim().toLowerCase();
  return `${prefix}:${createHash("sha256").update(normalized).digest("hex").slice(0, 32)}`;
}

export async function resetRateLimit(key: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(`rl:count:${key}`, `rl:block:${key}`);
      return;
    } catch (err) {
      console.error("[rateLimit] Redis reset 실패, 인메모리 폴백:", err);
    }
  }
  store.delete(key);
}
