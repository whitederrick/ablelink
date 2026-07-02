// lib/audit.ts
// 감사로그(AuditEvent) — 명시적 기록 헬퍼. 라우트가 세션(scope)과 함께 호출한다.
//  · Prisma 미들웨어/ALS는 쿼리엔진이 컨텍스트를 소실해 행위자를 못 붙임 → 명시 방식으로 정확한 '누가' 보장.
//  · update는 before(변경 전 스칼라)와 after(data)를 주면 실제 바뀐 필드만 old→new 로 기록.
//  · 기록 실패는 본 작업에 영향 없음(try/catch).
import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

export type AuditActorType = "ADMIN" | "MANAGER" | "WORKER" | "SYSTEM";
export interface AuditActor {
  actorType: AuditActorType;
  actorId?: bigint | number | null;
  actorLabel?: string | null;
  agencyId?: bigint | number | null;
}

/** 인증 scope(adminScope/managerScope/dual/worker)에서 행위자 도출. */
export function auditActorFrom(scope: any): AuditActor {
  if (!scope) return { actorType: "SYSTEM" };
  if (scope.kind === "admin") return { actorType: "ADMIN", actorId: scope.adminId ?? null, actorLabel: scope.loginId ?? null };
  if (scope.kind === "manager") return { actorType: "MANAGER", actorId: scope.managerId ?? null, agencyId: scope.agencyId ?? null, actorLabel: scope.loginId ?? null };
  if (scope.adminId != null && scope.managerId == null) return { actorType: "ADMIN", actorId: scope.adminId, actorLabel: scope.loginId ?? null };
  if (scope.managerId != null) return { actorType: "MANAGER", actorId: scope.managerId, agencyId: scope.agencyId ?? null, actorLabel: scope.loginId ?? null };
  if (scope.workerId != null) return { actorType: "WORKER", actorId: scope.workerId, actorLabel: scope.loginId ?? null };
  return { actorType: "SYSTEM" };
}

// ── diff/마스킹 유틸 ──
const SENSITIVE_KEYS = new Set(["password", "passwordHash", "signatureUrl", "adminSignatureUrl", "workerSignatureUrl", "representativeSignatureUrl", "accountNumber", "ciKey", "verifyCode"]);
const fmtVal = (v: unknown): string => (v === null || v === undefined ? "(비움)" : String(v));
const eqScalar = (a: unknown, b: unknown): boolean => fmtVal(a) === fmtVal(b);

/** 스칼라(문자/숫자/불리언/null) 키만 — 좌표(Decimal)·관계(create/connect 등) 객체는 diff 제외. */
export function scalarKeysOf(data: any): string[] {
  if (!data || typeof data !== "object") return [];
  return Object.keys(data).filter((k) => { const v = data[k]; return v === null || typeof v !== "object"; });
}

function maskSensitive(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(maskSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "***" : (v && typeof v === "object" ? maskSensitive(v) : v);
  }
  return out;
}

/** update 감사 전 변경 전 스칼라값 스냅샷(라우트가 update 이전에 호출). */
export async function auditSnapshot(model: string, where: any, data: any): Promise<Record<string, unknown> | null> {
  try {
    const keys = scalarKeysOf(data);
    if (!keys.length || !where) return null;
    const delegate = (prisma as any)[model.charAt(0).toLowerCase() + model.slice(1)];
    return await delegate.findUnique({ where, select: Object.fromEntries(keys.map((k) => [k, true])) });
  } catch { return null; }
}

export interface AuditEntry {
  entityType: string;
  entityId?: string | number | bigint | null;
  action: string; // create | update | delete | …
  summary?: string | null;
  before?: Record<string, unknown> | null; // 변경 전 스칼라(auditSnapshot 결과)
  after?: Record<string, unknown> | null;  // 보통 args.data
  payload?: Prisma.InputJsonValue;         // 직접 지정(override)
}

/** 감사 이벤트 기록. */
export async function logAudit(actor: AuditActor, entry: AuditEntry): Promise<void> {
  try {
    let summary = entry.summary ?? null;
    let payload = entry.payload;
    if (payload === undefined) {
      if (entry.before && entry.after) {
        const keys = scalarKeysOf(entry.after);
        const changed = keys
          .filter((k) => !eqScalar(entry.before![k], entry.after![k]))
          .map((k) => ({ field: k, from: fmtVal(entry.before![k]), to: fmtVal(entry.after![k]) }));
        if (summary == null) summary = changed.length ? changed.map((c) => c.field).join(", ") : null;
        payload = { changed } as Prisma.InputJsonValue;
      } else if (entry.after) {
        payload = JSON.parse(JSON.stringify(maskSensitive(entry.after))) as Prisma.InputJsonValue;
        if (summary == null) summary = scalarKeysOf(entry.after).join(", ") || null;
      }
    }
    await prisma.auditEvent.create({
      data: {
        agencyId: actor.agencyId != null ? BigInt(actor.agencyId) : null,
        actorType: actor.actorType,
        actorId: actor.actorId != null ? BigInt(actor.actorId) : null,
        actorLabel: actor.actorLabel ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId != null ? String(entry.entityId) : null,
        action: entry.action,
        summary,
        payload,
      },
    });
  } catch { /* 감사 실패는 본 작업에 영향 없음 */ }
}

/** scope + entry 한 번에. */
export function audit(scope: any, entry: AuditEntry): Promise<void> {
  return logAudit(auditActorFrom(scope), entry);
}
