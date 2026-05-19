// lib/rateLimit.ts
// 🔐 보안: 로그인 브루트포스 방지용 인메모리 Rate Limiter
// 프로덕션에서는 Redis로 교체 권장

interface Attempt {
  count: number;
  firstAt: number;
  blockedUntil?: number;
}

const store = new Map<string, Attempt>();

const WINDOW_MS = 15 * 60 * 1000;  // 15분 윈도우
const MAX_ATTEMPTS = 10;            // 최대 시도 횟수
const BLOCK_MS = 30 * 60 * 1000;   // 30분 차단

// 오래된 항목 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (now - val.firstAt > WINDOW_MS * 2) store.delete(key);
  }
}, 60_000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) {
    store.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  // 차단 중
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: entry.blockedUntil - now,
    };
  }

  // 윈도우 초과 → 리셋
  if (now - entry.firstAt > WINDOW_MS) {
    store.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  entry.count++;

  if (entry.count > MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: BLOCK_MS,
    };
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - entry.count };
}

export function resetRateLimit(key: string): void {
  store.delete(key);
}
