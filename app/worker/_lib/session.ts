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
  // P2-16: 발급 시점의 sessionVersion(sv). 인증 시 DB의 현재 값과 대조해 비번 변경 후 구 토큰을 무효화.
  sessionVersion?: number;
}

export async function signWorkerToken(payload: WorkerPayload): Promise<string> {
  // 발급(저빈도) 시 DB의 현재 sessionVersion을 조회해 토큰에 박는다 → 호출부는 변경 불필요.
  //  (비번 변경 지점이 sessionVersion을 +1 하면, 그 전 토큰은 인증 시 대조 불일치로 무효화된다.)
  let sv = 0;
  try {
    const w = await prisma.worker.findUnique({ where: { id: BigInt(payload.workerId) }, select: { sessionVersion: true } });
    sv = w?.sessionVersion ?? 0;
  } catch { sv = 0; }
  return new SignJWT({ ...payload, role: "WORKER", sv })
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
    // jose JWTPayload는 커스텀 claim을 unknown으로 둔다 → 발급 시 넣은 claim 형태로 한 번만 좁힌다.
    const claims = payload as { role?: unknown; workerId?: unknown; workerName?: unknown; isTemporary?: unknown; sv?: unknown };
    if (claims.role !== "WORKER") return null;
    return {
      workerId: String(claims.workerId),
      workerName: String(claims.workerName),
      isTemporary: Boolean(claims.isTemporary),
      // 구 토큰(sv 미포함)은 0으로 간주 → DB 기본값 0과 일치해 배포 시 강제 로그아웃 없음.
      sessionVersion: claims.sv != null ? Number(claims.sv) : 0,
    };
  } catch {
    return null;
  }
}

// 토큰이 유효해도 계정이 비활성/탈퇴(status !== ACTIVE)면 세션 무효화 (Admin과 동일하게 매 요청 DB 재검증).
//  P2-16: 같은 조회에서 sessionVersion도 대조 — 토큰 sv ≠ DB sv면(비번 변경 후 구 토큰) 무효화. 추가 쿼리 없음.
async function ensureWorkerActive(payload: WorkerPayload | null): Promise<WorkerPayload | null> {
  if (!payload) return null;
  let id: bigint;
  try { id = BigInt(payload.workerId); } catch { return null; }
  const worker = await prisma.worker.findUnique({ where: { id }, select: { status: true, sessionVersion: true } });
  if (!worker || worker.status !== "ACTIVE") return null;
  if ((worker.sessionVersion ?? 0) !== (payload.sessionVersion ?? 0)) return null;
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
