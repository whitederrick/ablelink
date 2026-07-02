// lib/audit.ts
// 감사로그(AuditEvent) 인프라 — "가능한 모든 변경" 자동 기록.
//  · 행위자(누가)는 AsyncLocalStorage로 요청별 주입(인증 헬퍼가 setAuditActor 호출).
//  · Prisma 확장이 감사대상 모델의 모든 쓰기(create/update/delete/…)를 가로채 audit_events에 기록.
//  · 감사 기록 실패는 본 작업에 영향 없음(try/catch). AuditEvent 자체·세션/로그성 모델은 제외(무한루프·노이즈 방지).
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";

export type AuditActorType = "ADMIN" | "MANAGER" | "WORKER" | "SYSTEM";
export interface AuditActor {
  actorType: AuditActorType;
  actorId?: bigint | null;
  actorLabel?: string | null; // 로그인ID/이름 스냅샷
  agencyId?: bigint | null;
}

const store = new AsyncLocalStorage<AuditActor>();

/** 현재 요청의 행위자 설정(인증 헬퍼에서 호출). 이후 같은 async 컨텍스트의 모든 쓰기에 적용된다. */
export function setAuditActor(actor: AuditActor): void {
  store.enterWith(actor);
}
/** 행위자 없으면 SYSTEM(크론/시드 등). */
export function getAuditActor(): AuditActor {
  return store.getStore() ?? { actorType: "SYSTEM" };
}
/** 명시적 스코프 실행(크론 등에서 SYSTEM 행위자로 감싸기). */
export function runWithAuditActor<T>(actor: AuditActor, fn: () => T): T {
  return store.run(actor, fn);
}

// 쓰기 연산만 감사.
const WRITE_OPS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

// 감사 대상 도메인 모델(중요 데이터). 세션/알림/조회로그성 모델은 제외해 노이즈를 줄인다.
const AUDITED_MODELS = new Set<string>([
  "Site", "SiteAssignment", "SiteContact", "SiteHoliday", "SiteBasePoint",
  "PayrollRun", "PayrollItem", "PayContract", "EmploymentContract", "AgencyDeduction",
  "DailyAttendance", "AttendanceIssue", "AttendanceEditRequest",
  "Trainee", "TraineePlacement", "TraineeEvaluation",
  "Worker", "Manager", "Agency", "Admin",
  "InsuranceRates", "IncomeTaxTable", "SystemConfig",
  "DocumentRun", "RecruitPost", "TalentOffer", "DashboardPromo", "SystemAnnouncement",
]);

// 감사 payload에서 마스킹할 민감 필드.
const SENSITIVE_KEYS = new Set(["password", "passwordHash", "signatureUrl", "adminSignatureUrl", "workerSignatureUrl", "representativeSignatureUrl", "accountNumber", "ciKey", "verifyCode"]);

function maskSensitive(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(maskSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "***" : (v && typeof v === "object" ? maskSensitive(v) : v);
  }
  return out;
}

function buildPayload(args: any): Prisma.InputJsonValue | undefined {
  try {
    const p: Record<string, unknown> = {};
    if (args?.data !== undefined) p.data = maskSensitive(args.data);
    if (args?.where !== undefined) p.where = args.where;
    // BigInt 등 직렬화 불가 값 제거를 위해 JSON 왕복(BigInt.toJSON 패치가 문자열화).
    return JSON.parse(JSON.stringify(p)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

function extractEntityId(args: any, result: any): string | null {
  try {
    if (result && typeof result === "object" && !Array.isArray(result) && result.id != null) return String(result.id);
    if (args?.where?.id != null) return String(args.where.id);
  } catch { /* noop */ }
  return null;
}

/**
 * Prisma 확장 팩토리. base(비확장 클라이언트)로 audit_events에 기록해 재귀를 피한다.
 */
export function makeAuditExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: "audit",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);
          if (WRITE_OPS.has(operation) && AUDITED_MODELS.has(model)) {
            const actor = getAuditActor();
            try {
              await base.auditEvent.create({
                data: {
                  agencyId: actor.agencyId ?? null,
                  actorType: actor.actorType,
                  actorId: actor.actorId ?? null,
                  actorLabel: actor.actorLabel ?? null,
                  entityType: model,
                  entityId: extractEntityId(args, result),
                  action: operation,
                  payload: buildPayload(args),
                },
              });
            } catch { /* 감사 실패는 본 작업에 영향 없음 */ }
          }
          return result;
        },
      },
    },
  });
}
