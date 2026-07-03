// lib/accessLog.ts
// 개인정보 접속기록(AccessLog) — 명시 기록 헬퍼.
//  · 안전성 확보조치 기준 제8조: 개인정보취급자가 정보주체의 (민감·식별) 개인정보를 열람/출력한 기록.
//  · AuditEvent와 동일한 교훈: 자동훅은 행위자 소실 → 라우트가 세션(scope)+요청(req)과 함께 명시 호출.
//  · 기록 실패는 본 작업에 영향 없음(try/catch).
import "server-only";
import { prisma } from "./prisma";
import { auditActorFrom } from "./audit";
import { getClientIp } from "./clientIp";

export type AccessAction = "view" | "export" | "print";

export interface AccessEntry {
  subjectType: string;                       // 정보주체 유형(Worker, Trainee 등)
  subjectId?: string | number | bigint | null;
  subjectLabel?: string | null;              // 정보주체 성명 스냅샷(표시용)
  resource: string;                          // account|verification|payslip|disability|worker_detail|contract
  action?: AccessAction;                     // 기본 view
}

/**
 * 개인정보 접속기록 1건 기록.
 * @param req   Request(IP·경로 추출)
 * @param scope 인증 scope(adminScope/managerScope/dual) — 행위자 도출
 */
export async function logAccess(req: Request, scope: any, entry: AccessEntry): Promise<void> {
  try {
    const actor = auditActorFrom(scope);
    // 정보주체 본인(WORKER)이나 시스템은 취급자 접속기록 대상 아님 → 기록 생략
    if (actor.actorType !== "ADMIN" && actor.actorType !== "MANAGER") return;

    let path: string | null = null;
    try { path = new URL(req.url).pathname; } catch { /* ignore */ }

    await prisma.accessLog.create({
      data: {
        agencyId: actor.agencyId != null ? BigInt(actor.agencyId) : null,
        actorType: actor.actorType,
        actorId: actor.actorId != null ? BigInt(actor.actorId) : null,
        actorLabel: actor.actorLabel ?? null,
        ip: getClientIp(req),
        subjectType: entry.subjectType,
        subjectId: entry.subjectId != null ? String(entry.subjectId) : null,
        subjectLabel: entry.subjectLabel ?? null,
        resource: entry.resource,
        action: entry.action ?? "view",
        path,
      },
    });
  } catch { /* 접속기록 실패는 본 작업에 영향 없음 */ }
}
