// lib/rateLimit.ts
// IP/키 기반 Rate Limiter
// Redis(Upstash) 환경변수가 있으면 Redis 사용, 없으면 인메모리 폴백 (로컬 개발용)

import { Redis } from "@upstash/redis";

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

  // 카운트 증가 (처음이면 윈도우 TTL 설정 — fixed-window).
  //  ★원자화: INCR과 EXPIRE가 분리돼 있어, count===1에서 EXPIRE가 실패(Upstash 순간 장애)하면 TTL 없는
  //   카운터가 영구 잔존한다 → 이후 요청마다 누적돼 max 초과 → 차단 해제 후에도 즉시 재차단되는 '영구 차단
  //   루프'(login-ip 키는 성공 리셋 경로도 없음). EXPIRE 실패 시 방금 올린 카운터를 되돌려(DECR) 0으로 만들어,
  //   다음 요청이 다시 count===1로 시작해 EXPIRE를 재시도하게 한다(그 요청은 통과 = 가용성 우선, 폴백 처리).
  const count = await redis!.incr(countKey);
  if (count === 1) {
    try {
      await redis!.expire(countKey, windowSec);
    } catch (err) {
      try { await redis!.decr(countKey); } catch { /* best-effort */ }
      throw err; // 상위 catch가 인메모리 폴백으로 처리
    }
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
