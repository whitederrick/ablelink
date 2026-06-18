// lib/rateLimit.ts
// IP/키 기반 Rate Limiter
// Redis(Upstash) 환경변수가 있으면 Redis 사용, 없으면 인메모리 폴백 (로컬 개발용)

import { Redis } from "@upstash/redis";

const WINDOW_SEC = 15 * 60;   // 15분 윈도우
const MAX_ATTEMPTS = 10;       // 최대 시도 횟수
const BLOCK_SEC = 30 * 60;    // 30분 차단

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
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
async function redisRateLimit(key: string): Promise<RateLimitResult> {
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

  // 카운트 증가 (처음이면 윈도우 TTL 설정)
  const count = await redis!.incr(countKey);
  if (count === 1) {
    await redis!.expire(countKey, WINDOW_SEC);
  }

  if (count > MAX_ATTEMPTS) {
    const blockedUntilMs = Date.now() + BLOCK_SEC * 1000;
    await redis!.set(blockKey, blockedUntilMs, { ex: BLOCK_SEC });
    return { allowed: false, remaining: 0, retryAfterMs: BLOCK_SEC * 1000 };
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - count };
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

function memoryRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) {
    store.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return { allowed: false, remaining: 0, retryAfterMs: entry.blockedUntil - now };
  }
  if (now - entry.firstAt > WINDOW_SEC * 1000) {
    store.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_SEC * 1000;
    return { allowed: false, remaining: 0, retryAfterMs: BLOCK_SEC * 1000 };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - entry.count };
}

// ── 공개 API ─────────────────────────────────────────────────
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  if (redis) {
    try {
      return await redisRateLimit(key);
    } catch (err) {
      // Redis(Upstash) 장애·DNS 실패 등으로 접근 불가하면 인메모리로 폴백.
      // rate limit 인프라 문제로 로그인 자체가 막히면 안 됨.
      console.error("[rateLimit] Redis 접근 실패, 인메모리 폴백:", err);
      return memoryRateLimit(key);
    }
  }
  return memoryRateLimit(key);
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
