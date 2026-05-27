// app/worker/_lib/session.ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export const WORKER_COOKIE = "ablelink_worker_session";
const MAX_AGE = 60 * 60 * 24 * 7;
const WORKER_TOKEN_AUD = "ablelink-worker";

function getSecret() {
  // Worker 전용 시크릿 우선, 없으면 공용 시크릿으로 폴백
  const s = process.env.WORKER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("WORKER_SESSION_SECRET not set");
  return new TextEncoder().encode(s);
}

export interface WorkerPayload {
  userId: string;
  userName: string;
  isTemporary?: boolean;
}

export async function signWorkerToken(payload: WorkerPayload): Promise<string> {
  return new SignJWT({ ...payload, role: "COACH" })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(WORKER_TOKEN_AUD)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifyWorkerToken(token: string): Promise<WorkerPayload | null> {
  const secret = getSecret();
  try {
    // 신규 토큰: aud 포함
    const { payload } = await jwtVerify(token, secret, { audience: WORKER_TOKEN_AUD });
    if ((payload as any).role !== "COACH") return null;
    return {
      userId: String((payload as any).userId),
      userName: String((payload as any).userName),
      isTemporary: Boolean((payload as any).isTemporary),
    };
  } catch {
    // 구 토큰(aud 없는) 한시적 수용 — 7일 후 자동 만료
    try {
      const { payload } = await jwtVerify(token, secret);
      if ((payload as any).role !== "COACH") return null;
      return {
        userId: String((payload as any).userId),
        userName: String((payload as any).userName),
        isTemporary: Boolean((payload as any).isTemporary),
      };
    } catch {
      return null;
    }
  }
}

export async function getWorkerSession(): Promise<WorkerPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(WORKER_COOKIE)?.value;
  if (!token) return null;
  return verifyWorkerToken(token);
}

// NextRequest에서 쿠키를 읽는 버전 (API Route에서 사용)
export async function getWorkerSessionFromReq(req: NextRequest): Promise<WorkerPayload | null> {
  const token = req.cookies.get(WORKER_COOKIE)?.value;
  if (!token) return null;
  return verifyWorkerToken(token);
}
