// lib/selfSignToken.ts
// 본인 서명(매니저/운영자)을 스마트폰에서 입력하기 위한 일회용 토큰.
// PC에서 토큰 발급 → QR/링크로 폰에서 열어 서명 제출 → 본인 계정 서명에 저장.
// 단기(10분) 토큰이라 별도 테이블 없이 Upstash Redis에 보관(없으면 인메모리 폴백; 운영은 Redis).

import { Redis } from "@upstash/redis";
import { randomUUID } from "crypto";

const TTL_SEC = 10 * 60;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

export interface SelfSignPayload {
  scope: "manager" | "agency-rep"; // manager=본인 서명, agency-rep=사업주 대표자 서명
  id: string;        // 발급 계정 id (문자열)
  name?: string;     // 표시용 이름
  agencyId?: string; // agency-rep 스코프에서 대상 에이전시 id
}

// 로컬(Redis 미설정) 폴백 — 단일 인스턴스 dev에서만 유효
const mem = new Map<string, { payload: SelfSignPayload; exp: number }>();

export async function createSelfSignToken(payload: SelfSignPayload): Promise<string> {
  const token = randomUUID().replace(/-/g, "");
  if (redis) await redis.set(`selfsign:${token}`, payload, { ex: TTL_SEC });
  else mem.set(token, { payload, exp: Date.now() + TTL_SEC * 1000 });
  return token;
}

export async function getSelfSignToken(token: string): Promise<SelfSignPayload | null> {
  if (!token) return null;
  if (redis) {
    return (await redis.get<SelfSignPayload>(`selfsign:${token}`)) ?? null;
  }
  const rec = mem.get(token);
  if (!rec) return null;
  if (rec.exp < Date.now()) { mem.delete(token); return null; }
  return rec.payload;
}

export async function consumeSelfSignToken(token: string): Promise<void> {
  if (redis) await redis.del(`selfsign:${token}`);
  else mem.delete(token);
}
