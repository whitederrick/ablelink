// app/worker/_lib/session.ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const WORKER_COOKIE = "ablelink_worker_session";
const MAX_AGE = 60 * 60 * 24 * 7;
const WORKER_TOKEN_AUD = "ablelink-worker";

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
