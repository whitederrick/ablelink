// app/worker/_lib/session.ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const WORKER_COOKIE = "ablelink_worker_session";
// 멀티 현장 워커가 "오늘 근무 중인 현장(배정)"을 선택한 값(assignmentId). 클라가 세팅, 서버가 소유·활성 검증.
// UI 선호값이라 httpOnly 아님(스위처가 읽음). 서버는 이 값을 신뢰하지 않고 활성 배정 목록 내에서만 적용.
export const WK_ACTIVE_ASSIGNMENT_COOKIE = "wk_active_assignment";
// 현장을 다니는 직무지도원의 재로그인 부담을 줄이기 위해 90일. 앱을 열 때마다 갱신(롤링)됨.
export const WORKER_SESSION_MAX_AGE = 60 * 60 * 24 * 90;
const MAX_AGE = WORKER_SESSION_MAX_AGE;
const WORKER_TOKEN_AUD = "ablelink-worker";

// 워커 세션 쿠키 옵션(로그인·리프레시 공통)
export function workerCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: WORKER_SESSION_MAX_AGE,
    path: "/",
  };
}

function getSecret() {
  const s = process.env.WORKER_SESSION_SECRET;
  if (!s) throw new Error("WORKER_SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export interface WorkerPayload {
  workerId: string;
  workerName: string;
  isTemporary?: boolean;
}

export async function signWorkerToken(payload: WorkerPayload): Promise<string> {
  return new SignJWT({ ...payload, role: "WORKER" })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(WORKER_TOKEN_AUD)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifyWorkerToken(token: string): Promise<WorkerPayload | null> {
  const secret = getSecret();
  try {
    const { payload } = await jwtVerify(token, secret, { audience: WORKER_TOKEN_AUD });
    if ((payload as any).role !== "WORKER") return null;
    return {
      workerId: String((payload as any).workerId),
      workerName: String((payload as any).workerName),
      isTemporary: Boolean((payload as any).isTemporary),
    };
  } catch {
    return null;
  }
}

// 토큰이 유효해도 계정이 비활성/탈퇴(status !== ACTIVE)면 세션 무효화 (Admin과 동일하게 매 요청 DB 재검증)
async function ensureWorkerActive(payload: WorkerPayload | null): Promise<WorkerPayload | null> {
  if (!payload) return null;
  let id: bigint;
  try { id = BigInt(payload.workerId); } catch { return null; }
  const worker = await prisma.worker.findUnique({ where: { id }, select: { status: true } });
  if (!worker || worker.status !== "ACTIVE") return null;
  return payload;
}

export async function getWorkerSession(): Promise<WorkerPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(WORKER_COOKIE)?.value;
  if (!token) return null;
  return ensureWorkerActive(await verifyWorkerToken(token));
}

// NextRequest에서 쿠키를 읽는 버전 (API Route에서 사용)
export async function getWorkerSessionFromReq(req: NextRequest): Promise<WorkerPayload | null> {
  const token = req.cookies.get(WORKER_COOKIE)?.value;
  if (!token) return null;
  return ensureWorkerActive(await verifyWorkerToken(token));
}
