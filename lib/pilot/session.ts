// lib/pilot/session.ts
// 파일럿 회차 생성·수정·상태 전이 — v1.8 §4·§12 4단계(4-A 서버).
//
// ★상태 전이는 회차 락(NS=5) 안에서 수행한다. 초대 발급·수락·연결이 같은 락을 잡으므로
//  "연결 진행 중에 ACTIVE 전환" 같은 검사-전이 경합이 생기지 않는다.
//  네 경로(전이·발급·수락·연결)가 한 축에서 직렬화되는 것이 이 파일의 핵심이다.

import { prisma } from "@/lib/prisma";
import { acquirePilotSessionLock, acquirePilotActivationLock } from "@/lib/assignmentLock";
import type { PilotSessionStatus } from "@prisma/client";

export type PilotSessionFailure =
  | "NOT_FOUND"
  | "INVALID_PERIOD"
  | "INVALID_TRANSITION"
  | "ACTIVE_EXISTS"       // 전역 ACTIVE 1개 위반
  | "NO_ACCEPTED"         // READY→ACTIVE 조건 미달
  | "PENDING_PARTICIPANTS"
  | "IMMUTABLE_FIELD";    // 현재 상태에서 수정할 수 없는 필드

export type PilotSessionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: PilotSessionFailure; message: string; status: number };

class SessionAbort extends Error {
  constructor(readonly status: number, readonly reason: PilotSessionFailure, readonly detail: string) {
    super(reason);
  }
}

function fail(status: number, reason: PilotSessionFailure, detail: string): never {
  throw new SessionAbort(status, reason, detail);
}

async function run<T>(fn: () => Promise<T>): Promise<PilotSessionResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof SessionAbort) return { ok: false, code: e.reason, message: e.detail, status: e.status };
    throw e;
  }
}

// ── 상태 전이 규칙 ────────────────────────────────────────────────
// DRAFT ─► READY ─► ACTIVE ─► ENDED ─► PURGED
//   └──────┴──────► CANCELLED (시작 전 취소만)
// ★PURGED는 이 표에 없다. 폐기는 상태 표시가 아니라 데이터 삭제 작업의 결과이므로,
//  9단계 폐기 서비스가 실제 정리를 끝낸 뒤 같은 트랜잭션에서만 설정한다.
//  일반 전이 API로 PURGED를 허용하면 데이터가 그대로인데 "폐기 완료"로 표시된다.
const ALLOWED_TRANSITIONS: Record<PilotSessionStatus, PilotSessionStatus[]> = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["DRAFT", "ACTIVE", "CANCELLED"],
  ACTIVE: ["ENDED"],
  ENDED: [],
  PURGED: [],
  CANCELLED: [],
};

/** 상태별 수정 가능 필드(v1.8 §4). ENDED 이후는 전부 불변. */
export function editableFields(status: PilotSessionStatus): "ALL" | "DISPLAY_NAME_ONLY" | "NONE" {
  if (status === "DRAFT" || status === "READY") return "ALL";
  if (status === "ACTIVE") return "DISPLAY_NAME_ONLY";
  return "NONE";
}

export interface CreatePilotSessionInput {
  agencyId: bigint;
  startDate: Date;
  endDate: Date;
  managerDisplayName?: string | null;
  createdByAdminId: bigint;
}

export async function createPilotSession(input: CreatePilotSessionInput) {
  return run(async () => {
    if (input.endDate < input.startDate) {
      fail(400, "INVALID_PERIOD", "종료일이 시작일보다 이릅니다.");
    }
    return prisma.pilotSession.create({
      data: {
        agencyId: input.agencyId,
        startDate: input.startDate,
        endDate: input.endDate,
        managerDisplayName: input.managerDisplayName ?? null,
        createdByAdminId: input.createdByAdminId,
      },
    });
  });
}

export interface UpdatePilotSessionInput {
  startDate?: Date;
  endDate?: Date;
  managerDisplayName?: string | null;
}

/**
 * 회차 설정 수정. 상태별 불변성을 강제한다.
 * ACTIVE에서는 `managerDisplayName`만 바꿀 수 있고, ENDED 이후에는 아무것도 못 바꾼다
 * (과거 문서의 재현성 — 표시명이 바뀌면 이미 뽑은 PDF와 어긋난다).
 *
 * ★`agencyId`는 생성 후 **불변**이다(입력 타입에서 아예 제외).
 *  셋업이 진행된 뒤 기관을 바꾸면 이미 만들어진 Site·참여자·배정은 옛 기관에 남고,
 *  이후 수락이 만드는 배정은 새 기관으로 붙어 `assignment.agencyId ≠ site.agencyId` 발산이 생긴다.
 *  이 리포는 근태 소유권을 `assignment.agencyId`로 판정하므로(site.agencyId 사용 금지),
 *  그 발산은 다른 기관 매니저가 남의 현장 근태를 보는 크로스테넌트 노출로 이어진다
 *  (2026-07-21 감사에서 "divergent 현장"으로 실제 수정된 클래스).
 *  기관을 바꿔야 하면 회차를 새로 만든다.
 */
export async function updatePilotSession(id: bigint, patch: UpdatePilotSessionInput) {
  return run(async () =>
    prisma.$transaction(async (tx) => {
      await acquirePilotSessionLock(tx, id);

      const session = await tx.pilotSession.findUnique({ where: { id } });
      if (!session) fail(404, "NOT_FOUND", "파일럿 회차를 찾을 수 없습니다.");

      const scope = editableFields(session.status);
      const touchesSettings = patch.startDate !== undefined || patch.endDate !== undefined;

      if (scope === "NONE") {
        fail(409, "IMMUTABLE_FIELD", "종료·취소된 회차는 수정할 수 없습니다.");
      }
      if (scope === "DISPLAY_NAME_ONLY" && touchesSettings) {
        fail(409, "IMMUTABLE_FIELD", "진행 중인 회차는 담당자 표시명만 수정할 수 있습니다.");
      }

      const start = patch.startDate ?? session.startDate;
      const end = patch.endDate ?? session.endDate;
      if (end < start) fail(400, "INVALID_PERIOD", "종료일이 시작일보다 이릅니다.");

      // ★기간을 좁히면 이미 만든 참여자 설정이 회차 밖으로 밀려날 수 있다. 생성 불변식과 같은 규칙을
      //  수정 시에도 강제한다(배정·참여자 설정 기간 ⊆ 회차 기간).
      if (touchesSettings) {
        const outside = await tx.pilotParticipant.count({
          where: {
            pilotSessionId: id,
            status: { not: "CANCELLED" },
            OR: [{ assignmentStartDate: { lt: start } }, { assignmentEndDate: { gt: end } }],
          },
        });
        if (outside > 0) {
          fail(409, "INVALID_PERIOD", `회차 기간 밖으로 벗어나는 참여자 설정이 ${outside}건 있습니다.`);
        }
      }

      return tx.pilotSession.update({
        where: { id },
        data: {
          startDate: patch.startDate,
          endDate: patch.endDate,
          managerDisplayName: patch.managerDisplayName,
        },
      });
    }),
  );
}

/**
 * 회차 상태를 전이한다.
 *
 * ★회차 락 안에서 현재 상태를 재조회한 뒤 판정한다. 락 없이 상태만 읽으면 초대 수락·연결과
 *  겹쳐 "수락이 READY를 통과한 직후 ACTIVE 전환"이 되어 창구 규칙이 무너진다.
 *
 * READY → ACTIVE 조건(v1.8 §5):
 *   · ACCEPTED 참여자가 1명 이상
 *   · 나머지 참여자가 전부 ACCEPTED 또는 CANCELLED (미응답자가 남아 있으면 전이 불가)
 *   · 전역 ACTIVE 회차가 없어야 함 (DB partial unique가 최종 방어선이지만 여기서 먼저 막는다)
 */
export async function transitionPilotSession(id: bigint, to: PilotSessionStatus) {
  return run(async () =>
    prisma.$transaction(async (tx) => {
      await acquirePilotSessionLock(tx, id);

      const session = await tx.pilotSession.findUnique({ where: { id } });
      if (!session) fail(404, "NOT_FOUND", "파일럿 회차를 찾을 수 없습니다.");

      if (!ALLOWED_TRANSITIONS[session.status].includes(to)) {
        fail(409, "INVALID_TRANSITION", `${session.status} 상태에서 ${to}로 바꿀 수 없습니다.`);
      }

      if (to === "ACTIVE") {
        // ★전역 활성화 락 — 회차 락만으로는 **서로 다른 회차**의 동시 활성화를 막지 못한다
        //  (A와 B는 다른 키를 잡으므로 직렬화되지 않는다). 둘 다 "다른 ACTIVE 없음"을 관측하면
        //  partial unique index가 뒤늦게 터져 409가 아니라 Prisma 오류(500)가 된다.
        //  회차 락 **다음**에 잡으므로(항상 마지막) 순환대기는 없다.
        await acquirePilotActivationLock(tx);

        // 전역 ACTIVE 1개 — 다른 회차가 이미 진행 중이면 막는다.
        const otherActive = await tx.pilotSession.count({
          where: { status: "ACTIVE", id: { not: id } },
        });
        if (otherActive > 0) {
          fail(409, "ACTIVE_EXISTS", "이미 진행 중인 파일럿 회차가 있습니다. 먼저 종료해주세요.");
        }

        const [accepted, pending] = await Promise.all([
          tx.pilotParticipant.count({ where: { pilotSessionId: id, status: "ACCEPTED" } }),
          tx.pilotParticipant.count({
            where: { pilotSessionId: id, status: { in: ["CONFIGURED", "INVITED"] } },
          }),
        ]);
        if (accepted === 0) {
          fail(409, "NO_ACCEPTED", "수락한 참여자가 없습니다. 최소 1명이 초대를 수락해야 시작할 수 있습니다.");
        }
        if (pending > 0) {
          fail(
            409, "PENDING_PARTICIPANTS",
            `아직 수락하지 않은 참여자가 ${pending}명 있습니다. 수락을 기다리거나 참여를 취소해주세요.`,
          );
        }
      }

      const now = new Date();
      return tx.pilotSession.update({
        where: { id },
        data: {
          status: to,
          activatedAt: to === "ACTIVE" ? now : undefined,
          endedAt: to === "ENDED" ? now : undefined,
          purgedAt: to === "PURGED" ? now : undefined,
        },
      });
    }),
  );
}
