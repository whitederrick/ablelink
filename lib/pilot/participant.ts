// lib/pilot/participant.ts
// 파일럿 참여자 셋업 — v1.8 §5.1·§5.2·§12 4단계(4-A 서버).
//
// 두 경로를 모두 지원한다:
//   · 기존 Worker — 배정·재적·담당을 셋업 시점에 만든다(§5.1). 이후 초대는 CONNECT_EXISTING.
//   · 신규 Worker — 계정이 없으므로 배정 설정값만 저장한다(§5.2). 수락 트랜잭션이 실제 자원을 만든다.
//
// ★락 순서는 전역 규칙 `pilotSession → [site|post] → worker → trainee`를 따른다.
// ★참여자 설정 기간은 회차 기간 안이어야 한다(생성 불변식).

import { prisma } from "@/lib/prisma";
import { acquirePilotSessionLock, acquireSiteLock, acquireWorkerLock } from "@/lib/assignmentLock";
import { checkSiteCapacity } from "@/lib/assignmentCapacity";
import { createTraineeSupervisionInTx } from "@/lib/trainee/supervision";
import { findTimeConflict, OCCUPYING_STATUSES } from "@/lib/assignmentOverlap";
import { VALID_WORK_TYPES } from "@/lib/workSchedule";
import type { ServiceStep } from "@prisma/client";

export type ParticipantFailure =
  | "SESSION_NOT_FOUND"
  | "SESSION_LOCKED"        // DRAFT/READY가 아니면 셋업 불가
  | "NOT_FOUND"
  | "OUT_OF_SESSION_PERIOD" // 설정 기간이 회차 기간을 벗어남
  | "INVALID_PERIOD"
  | "INVALID_WORK_TYPE"
  | "SITE_NOT_IN_SESSION"
  | "WORKER_DUPLICATE"
  | "WORKER_NOT_ACTIVE"
  | "ASSIGNMENT_CONFLICT"   // 기존 배정과 기간·슬롯이 겹침
  | "CAPACITY_EXCEEDED"
  | "PLACEMENT_MISSING"
  | "SUPERVISION_REJECTED"
  | "ALREADY_ACCEPTED";     // 수락된 참여자는 수정·취소 불가

export type ParticipantResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ParticipantFailure; message: string; status: number };

class ParticipantAbort extends Error {
  constructor(readonly status: number, readonly reason: ParticipantFailure, readonly detail: string) {
    super(reason);
  }
}
function fail(status: number, reason: ParticipantFailure, detail: string): never {
  throw new ParticipantAbort(status, reason, detail);
}
async function run<T>(fn: () => Promise<T>): Promise<ParticipantResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof ParticipantAbort) return { ok: false, code: e.reason, message: e.detail, status: e.status };
    throw e;
  }
}

export interface ParticipantSetupInput {
  pilotSessionId: bigint;
  siteId: bigint;
  /** 지정하면 기존 Worker 경로, 없으면 신규 Worker 대기 행. */
  workerId?: bigint | null;
  traineeIds: bigint[];
  assignmentStartDate: Date;
  assignmentEndDate: Date;
  serviceStep: ServiceStep;
  workType: string;
  commuteGuidanceIncluded?: boolean;
  customWorkStart?: string | null;
  customWorkEnd?: string | null;
}

/**
 * 참여자를 만든다.
 *
 * 기존 Worker면 **배정·담당 관계까지 이 트랜잭션에서 생성**한다(§5.1 순서).
 * 그래야 초대 발급이 `assignmentId`를 실을 수 있고, 연결 API가 422로 끊기지 않는다.
 */
export async function createPilotParticipant(input: ParticipantSetupInput) {
  return run(async () =>
    prisma.$transaction(async (tx) => {
      // ── 락: 회차 → 현장 → (워커) (전역 순서) ────────────────
      await acquirePilotSessionLock(tx, input.pilotSessionId);
      await acquireSiteLock(tx, input.siteId);
      // ★기존 Worker면 워커 락까지 잡는다. 이 경로는 배정을 실제로 만들므로
      //  정상 배정 경로(직접배정·respond·finalize 등)와 같은 축에서 직렬화되어야 한다.
      //  락 없이 만들면 정상 배정과 동시에 진행돼 이중배정이 새어나간다.
      if (input.workerId != null) await acquireWorkerLock(tx, input.workerId);

      const session = await tx.pilotSession.findUnique({
        where: { id: input.pilotSessionId },
        select: { id: true, status: true, agencyId: true, startDate: true, endDate: true },
      });
      if (!session) fail(404, "SESSION_NOT_FOUND", "파일럿 회차를 찾을 수 없습니다.");
      // 셋업은 DRAFT/READY에서만. ACTIVE 이후 참여자 추가는 허용하지 않는다(v1.8 §5).
      if (session.status !== "DRAFT" && session.status !== "READY") {
        fail(409, "SESSION_LOCKED", "이 회차는 참여자를 추가할 수 있는 상태가 아닙니다.");
      }

      if (input.assignmentEndDate < input.assignmentStartDate) {
        fail(400, "INVALID_PERIOD", "배정 종료일이 시작일보다 이릅니다.");
      }
      // ★생성 불변식 — 배정 설정 기간 ⊆ 회차 기간.
      if (input.assignmentStartDate < session.startDate || input.assignmentEndDate > session.endDate) {
        fail(400, "OUT_OF_SESSION_PERIOD", "배정 기간이 파일럿 회차 기간을 벗어납니다.");
      }
      if (!VALID_WORK_TYPES.includes(input.workType as (typeof VALID_WORK_TYPES)[number])) {
        fail(400, "INVALID_WORK_TYPE", "근무형태가 올바르지 않습니다.");
      }

      const site = await tx.site.findUnique({
        where: { id: input.siteId },
        select: { id: true, agencyId: true },
      });
      if (!site) fail(404, "SITE_NOT_IN_SESSION", "사업체를 찾을 수 없습니다.");
      // 크로스테넌트 차단 — 회차 기관 소속 현장만 쓸 수 있다.
      if (site.agencyId !== session.agencyId) {
        fail(403, "SITE_NOT_IN_SESSION", "이 회차의 위탁기관 소속 사업체가 아닙니다.");
      }

      if (input.workerId != null) {
        const dup = await tx.pilotParticipant.count({
          where: { pilotSessionId: input.pilotSessionId, workerId: input.workerId },
        });
        if (dup > 0) fail(409, "WORKER_DUPLICATE", "이미 이 회차에 참여 중인 직무지도원입니다.");
      }

      // ── 기존 Worker: 배정을 지금 만든다 ─────────────────────
      let createdAssignmentId: bigint | null = null;
      if (input.workerId != null) {
        // ★정상 배정 경로가 지키는 불변식을 파일럿도 그대로 지킨다.
        //  파일럿이라고 건너뛰면 같은 워커에 중복·충돌 배정이 생긴다.
        const worker = await tx.worker.findUnique({
          where: { id: input.workerId },
          select: { id: true, status: true },
        });
        if (!worker || worker.status !== "ACTIVE") {
          fail(409, "WORKER_NOT_ACTIVE", "활성 상태인 직무지도원만 파일럿에 배정할 수 있습니다.");
        }

        // 기존 점유 배정과 기간·반나절 슬롯이 겹치면 거부(멀티현장 규칙과 동일 판정).
        const existing = await tx.siteAssignment.findMany({
          where: { workerId: input.workerId, status: { in: [...OCCUPYING_STATUSES] } },
          select: { id: true, workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true },
        });
        const conflict = findTimeConflict(
          {
            workType: input.workType,
            customWorkStart: input.customWorkStart ?? null,
            customWorkEnd: input.customWorkEnd ?? null,
            startDate: input.assignmentStartDate,
            endDate: input.assignmentEndDate,
          },
          existing,
        );
        if (conflict) {
          fail(409, "ASSIGNMENT_CONFLICT",
            "이 직무지도원은 해당 기간에 이미 다른 배정이 있습니다.");
        }

        // 정원 검사는 현장 락 안에서(위에서 이미 획득).
        const overflow = await checkSiteCapacity(tx, input.siteId, { [input.workType]: 1 });
        if (overflow) {
          fail(409, "CAPACITY_EXCEEDED",
            `현장 정원을 초과합니다(${overflow.slot} 잔여 ${overflow.remaining}명).`);
        }

        const asg = await tx.siteAssignment.create({
          data: {
            workerId: input.workerId,
            siteId: input.siteId,
            agencyId: session.agencyId,
            // 기존 Worker는 초대 코드로 '연결'해야 활성화된다 → CONFIRMED로 시작.
            status: "CONFIRMED",
            startDate: input.assignmentStartDate,
            endDate: input.assignmentEndDate,
            serviceStep: input.serviceStep,
            workType: input.workType,
            commuteGuidanceIncluded: input.commuteGuidanceIncluded ?? true,
            customWorkStart: input.customWorkStart ?? null,
            customWorkEnd: input.customWorkEnd ?? null,
            attendanceMode: "NONE",
            attendanceButtonExempt: true,
            pilotSessionId: session.id,
          },
          select: { id: true },
        });
        createdAssignmentId = asg.id;
      }

      const participant = await tx.pilotParticipant.create({
        data: {
          pilotSessionId: session.id,
          siteId: input.siteId,
          workerId: input.workerId ?? null,
          createdAssignmentId,
          assignmentStartDate: input.assignmentStartDate,
          assignmentEndDate: input.assignmentEndDate,
          serviceStep: input.serviceStep,
          workType: input.workType,
          commuteGuidanceIncluded: input.commuteGuidanceIncluded ?? true,
          customWorkStart: input.customWorkStart ?? null,
          customWorkEnd: input.customWorkEnd ?? null,
          trainees: { create: input.traineeIds.map((traineeId) => ({ traineeId })) },
        },
        select: { id: true },
      });

      // ── 기존 Worker: 담당 관계도 지금 만든다 ────────────────
      if (createdAssignmentId != null) {
        // 훈련생 오름차순으로 잠가 교착을 만들지 않는다(전역 순서의 맨 끝).
        const ordered = [...input.traineeIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        for (const traineeId of ordered) {
          const placement = await tx.traineePlacement.findFirst({
            where: {
              traineeId,
              siteId: input.siteId,
              startDate: { lte: input.assignmentEndDate },
              OR: [{ endDate: null }, { endDate: { gte: input.assignmentStartDate } }],
            },
            orderBy: { startDate: "asc" },
            select: { id: true },
          });
          if (!placement) {
            fail(409, "PLACEMENT_MISSING", "담당 훈련생의 사업체 재적 정보가 배정 기간과 맞지 않습니다.");
          }
          const sup = await createTraineeSupervisionInTx(tx, {
            traineeId,
            placementId: placement.id,
            assignmentId: createdAssignmentId,
            startDate: input.assignmentStartDate,
            endDate: input.assignmentEndDate,
            pilotSessionId: session.id,
          });
          if (!sup.ok) fail(409, "SUPERVISION_REJECTED", sup.message);
        }
      }

      return { participantId: participant.id, assignmentId: createdAssignmentId };
    }),
  );
}

/**
 * 참여를 취소한다. 연결된 초대를 **즉시 무효화**해 취소 후 수락·연결이 통과하지 못하게 한다.
 *
 * ★수락이 끝난 참여자는 취소하지 않는다 — 이미 배정·담당 관계가 만들어져 있어
 *  단순 상태 변경으로는 정합을 되돌릴 수 없다(폐기 절차의 대상이다).
 */
export async function cancelPilotParticipant(participantId: bigint) {
  return run(async () =>
    prisma.$transaction(async (tx) => {
      const preload = await tx.pilotParticipant.findUnique({
        where: { id: participantId },
        select: { pilotSessionId: true },
      });
      if (!preload) fail(404, "NOT_FOUND", "참여자를 찾을 수 없습니다.");
      await acquirePilotSessionLock(tx, preload.pilotSessionId);

      const participant = await tx.pilotParticipant.findUnique({
        where: { id: participantId },
        select: { id: true, status: true, inviteId: true, createdAssignmentId: true },
      });
      if (!participant) fail(404, "NOT_FOUND", "참여자를 찾을 수 없습니다.");
      if (participant.status === "ACCEPTED") {
        fail(409, "ALREADY_ACCEPTED", "이미 수락한 참여자는 취소할 수 없습니다.");
      }
      if (participant.status === "CANCELLED") {
        return { participantId, invalidatedInvite: false, releasedAssignment: false, removedSupervisions: 0 };
      }

      await tx.pilotParticipant.update({
        where: { id: participantId },
        data: { status: "CANCELLED" },
      });

      // ★초대 무효화 — 만료일을 과거로 당겨 수락·연결이 통과하지 못하게 한다.
      //  초대 행을 지우지 않는 이유: 감사 근거를 남기고, participant.inviteId(SetNull) 연결도 보존한다.
      let invalidatedInvite = false;
      if (participant.inviteId != null) {
        const r = await tx.workerInvite.updateMany({
          where: { id: participant.inviteId, usedAt: null },
          data: { expiresAt: new Date(0) },
        });
        invalidatedInvite = r.count > 0;
      }

      // ── ★사전 생성 자원 해제 (기존 Worker 경로) ─────────────
      // 취소가 참여자·초대만 건드리면 셋업이 만든 배정과 담당 관계가 남는다:
      //   · CONFIRMED 배정은 OCCUPYING_STATUSES라 **정원을 계속 차지**한다.
      //   · TraineeSupervision은 같은 훈련생의 **대체 담당자 생성을 막는다**(기간 중복 금지).
      // 이 자원들은 셋업이 만들었고 한 번도 사용되지 않았으므로(연결 전) 여기서 되돌린다.
      let releasedAssignment = false;
      let removedSupervisions = 0;
      if (participant.createdAssignmentId != null) {
        // 담당 관계는 **삭제**한다. "종료일 기록으로 보존"은 실제 담당이 있었던 이력에 대한 규칙인데,
        // 이건 수락 전이라 담당한 사실 자체가 없다. 종료 처리만 하면 기간이 남아 대체 담당자를 계속 막는다.
        const delSup = await tx.traineeSupervision.deleteMany({
          where: { assignmentId: participant.createdAssignmentId },
        });
        removedSupervisions = delSup.count;

        // 배정은 DROPPED로 내려 정원 점유를 푼다(OCCUPYING_STATUSES에서 빠진다).
        // 삭제하지 않는 이유: 감사·이력 근거를 남기고 participant.createdAssignmentId(SetNull) 연결도 보존한다.
        // ★연결이 끝난 배정(connectedAt 있음)은 건드리지 않는다 — 그건 ACCEPTED라 위에서 이미 거부된다.
        const rel = await tx.siteAssignment.updateMany({
          where: { id: participant.createdAssignmentId, connectedAt: null },
          data: { status: "DROPPED", droppedAt: new Date() },
        });
        releasedAssignment = rel.count > 0;
      }

      return { participantId, invalidatedInvite, releasedAssignment, removedSupervisions };
    }),
  );
}
