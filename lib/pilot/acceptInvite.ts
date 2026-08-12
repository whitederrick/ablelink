// lib/pilot/acceptInvite.ts
// 파일럿 초대 수락 트랜잭션 — v1.8 §5.2·§12 3단계.
//
// 신규 직무지도원은 계정이 없어 배정을 먼저 만들 수 없다. 운영자가 PilotParticipant에 저장해 둔
// 배정 설정값으로, 수락 시점에 Worker · SiteAssignment · TraineeSupervision · 참여자 상태를
// **한 트랜잭션**에서 만든다. 하나라도 실패하면 Worker 생성까지 전부 롤백된다.
//
// ★기존 초대 수락 분기(app/api/worker/invite/[id]/route.ts)를 재사용하지 않는다. 그 분기는
//   startDate=now·FULL_DAY 기본값으로 배정을 만들고 pilotSessionId를 남기지 않아, 회차 기간과
//   어긋나고 운영자가 사전 설정한 값과 중복 생성될 수 있다.
//
// ★락 획득 순서 — 전역 규칙 `[site|post] → worker → trainee`를 지킨다.
//   여기서는 site → (worker 생성) → trainee 순이다. 역순으로 잡으면 다른 경로와 교착한다.

import { prisma } from "@/lib/prisma";
import { acquireSiteLock } from "@/lib/assignmentLock";
import { checkSiteCapacity } from "@/lib/assignmentCapacity";
import { createTraineeSupervisionInTx } from "@/lib/trainee/supervision";
import { VALID_WORK_TYPES } from "@/lib/workSchedule";

export type AcceptPilotInviteResult =
  | { ok: true; workerId: bigint; assignmentId: bigint; alreadyAccepted: boolean }
  | { ok: false; code: AcceptPilotFailure; message: string };

export type AcceptPilotFailure =
  | "PARTICIPANT_NOT_FOUND"   // 초대에 연결된 참여자 설정이 없다
  | "SESSION_NOT_READY"       // 회차가 READY가 아니다(수락 창구가 닫힘)
  | "PARTICIPANT_CANCELLED"   // 운영자가 참여를 취소했다
  | "SITE_REQUIRED"           // 참여자 설정에 현장이 없다
  | "INVALID_WORK_TYPE"
  | "CAPACITY_EXCEEDED"
  | "PLACEMENT_MISSING"       // 담당 훈련생의 재적이 배정 기간과 겹치지 않는다(설정↔실데이터 드리프트)
  | "SUPERVISION_REJECTED";   // 담당 관계 불변식 위반

export interface AcceptPilotInviteInput {
  inviteId: bigint;
  /**
   * 신규 계정 생성에 필요한 값.
   * ★기존 Worker 연결은 이 경로가 아니라 `/api/worker/assignment/connect`가 처리한다
   *  (운영자가 배정을 먼저 만들고 초대에 assignmentId를 실어 두는 §5.1 순서).
   *  대상 Worker는 호출자 입력이 아니라 락 안에서 재조회한 참여자 설정으로 결정한다.
   */
  newWorker?: {
    loginId: string;
    phoneNumber: string;
    workerName: string;
    passwordHash: string;
    consentTermsAt: Date | null;
    consentPrivacyAt: Date | null;
    consentLocationAt: Date | null;
  };
}

/** 불변식 위반을 트랜잭션 롤백으로 바꾸기 위한 내부 신호. */
class PilotAcceptAbort extends Error {
  constructor(readonly code: AcceptPilotFailure, readonly detail: string) {
    super(code);
  }
}

/**
 * 파일럿 초대를 수락하고 회차 자원을 생성한다.
 *
 * 멱등: 같은 초대를 다시 수락하면 이미 만든 배정을 그대로 반환한다(`alreadyAccepted: true`).
 * 재시도·중복 클릭이 배정을 두 번 만들지 않는다.
 */
export async function acceptPilotInvite(
  input: AcceptPilotInviteInput,
): Promise<AcceptPilotInviteResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      // ── 1. 락을 잡기 위한 사전 조회 ──────────────────────────
      // ★여기서 읽은 값으로는 판정하지 않는다. 락을 잡을 siteId를 알아내는 용도일 뿐이다.
      //  (site 락은 siteId를 알아야 잡을 수 있는데, siteId는 참여자 행에 있다.)
      const preload = await tx.pilotParticipant.findUnique({
        where: { inviteId: input.inviteId },
        select: { siteId: true },
      });
      if (!preload) {
        throw new PilotAcceptAbort("PARTICIPANT_NOT_FOUND", "초대에 연결된 파일럿 설정을 찾을 수 없습니다.");
      }
      if (preload.siteId == null) {
        throw new PilotAcceptAbort("SITE_REQUIRED", "참여 설정에 사업체가 지정되지 않았습니다.");
      }

      // ── 2. 현장 락 (락 순서 1번째) ───────────────────────────
      // 정원검사 TOCTOU와 같은 초대의 동시 수락을 함께 직렬화한다.
      await acquireSiteLock(tx, preload.siteId);

      // ── 3. ★락 안에서 재조회 — 여기부터가 임계구역이다 ────────
      // 멱등·상태 검사를 락 밖에서 하면 동시 수락 둘이 모두 "아직 수락 안 됨"을 관측하고
      // 통과해, 뒤늦게 Worker의 login_id unique 위반(500)으로 터진다.
      const participant = await tx.pilotParticipant.findUnique({
        where: { inviteId: input.inviteId },
        include: {
          pilotSession: { select: { id: true, status: true, agencyId: true, startDate: true, endDate: true } },
          trainees: { select: { traineeId: true } },
        },
      });
      if (!participant) {
        throw new PilotAcceptAbort("PARTICIPANT_NOT_FOUND", "초대에 연결된 파일럿 설정을 찾을 수 없습니다.");
      }

      // 멱등 — 이미 수락된 초대는 기존 결과를 그대로 반환한다.
      if (participant.createdAssignmentId != null && participant.workerId != null) {
        return {
          ok: true as const,
          workerId: participant.workerId,
          assignmentId: participant.createdAssignmentId,
          alreadyAccepted: true,
        };
      }

      // ── 4. 수락 창구 검사 (★락 안에서) ───────────────────────
      // READY에서만 수락한다. ACTIVE 이후 참여자 추가·수락은 허용하지 않는다(v1.8 §5).
      if (participant.status === "CANCELLED") {
        throw new PilotAcceptAbort("PARTICIPANT_CANCELLED", "취소된 참여 설정입니다. 운영자에게 문의해주세요.");
      }
      if (participant.pilotSession.status !== "READY") {
        throw new PilotAcceptAbort(
          "SESSION_NOT_READY",
          "지금은 파일럿 참여를 수락할 수 없습니다. 운영자에게 문의해주세요.",
        );
      }
      if (participant.siteId == null) {
        throw new PilotAcceptAbort("SITE_REQUIRED", "참여 설정에 사업체가 지정되지 않았습니다.");
      }
      if (!VALID_WORK_TYPES.includes(participant.workType as (typeof VALID_WORK_TYPES)[number])) {
        throw new PilotAcceptAbort("INVALID_WORK_TYPE", "참여 설정의 근무형태가 올바르지 않습니다.");
      }

      const siteId = participant.siteId;
      const sessionId = participant.pilotSession.id;
      const start = participant.assignmentStartDate;
      const end = participant.assignmentEndDate;

      // ── 5. 정원 검사 (현장 락 안) ────────────────────────────
      const slot = participant.workType;
      const overflow = await checkSiteCapacity(tx, siteId, { [slot]: 1 });
      if (overflow) {
        throw new PilotAcceptAbort(
          "CAPACITY_EXCEEDED",
          `현장 정원을 초과했습니다(${overflow.slot} 잔여 ${overflow.remaining}명). 운영자에게 문의해주세요.`,
        );
      }

      // ── 6. Worker 확정 (신규면 생성) ─────────────────────────
      // ★호출자 입력의 workerId를 신뢰하지 않는다. 락 안에서 재조회한 참여자 설정을 기준으로 삼는다.
      //  API 표면이 임의 workerId를 받게 열려 있으면 남의 계정에 파일럿 배정을 붙일 수 있다.
      let workerId: bigint;
      if (participant.workerId != null) {
        workerId = participant.workerId;
      } else if (input.newWorker) {
        const w = input.newWorker;
        const created = await tx.worker.create({
          data: {
            loginId: w.loginId,
            password: w.passwordHash,
            workerName: w.workerName,
            phoneNumber: w.phoneNumber,
            role: "WORKER",
            status: "ACTIVE",
            planType: "FREE",
            isTemporary: false,
            consentTermsAt: w.consentTermsAt,
            consentPrivacyAt: w.consentPrivacyAt,
            consentLocationAt: w.consentLocationAt,
            // ★회차가 만든 계정 — 폐기 시 hard delete하지 않고 PAUSED 전환 판정에 쓴다.
            createdByPilotSessionId: sessionId,
          },
          select: { id: true },
        });
        workerId = created.id;
      } else {
        throw new PilotAcceptAbort("PARTICIPANT_NOT_FOUND", "수락에 필요한 계정 정보가 없습니다.");
      }

      // ── 7. 배정 생성 (회차 귀속) ─────────────────────────────
      const assignment = await tx.siteAssignment.create({
        data: {
          workerId,
          siteId,
          // ★배정의 실귀속은 회차가 지정한 실재 위탁기관이다(회차는 기관 1곳에 묶인다).
          agencyId: participant.pilotSession.agencyId,
          status: "ACTIVE",
          connectedAt: new Date(),
          startDate: start,
          endDate: end,
          serviceStep: participant.serviceStep,
          workType: participant.workType,
          commuteGuidanceIncluded: participant.commuteGuidanceIncluded,
          customWorkStart: participant.customWorkStart,
          customWorkEnd: participant.customWorkEnd,
          attendanceMode: participant.attendanceMode,
          attendanceButtonExempt: participant.attendanceButtonExempt,
          pilotSessionId: sessionId,
        },
        select: { id: true },
      });

      // ── 8. 담당 관계 생성 (락 순서 3번째 — createTraineeSupervisionInTx가 훈련생 락을 잡는다) ──
      // 훈련생 id 오름차순으로 처리해 여러 훈련생을 잠글 때 교착을 만들지 않는다.
      const traineeIds = participant.trainees
        .map((t) => t.traineeId)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      for (const traineeId of traineeIds) {
        // ★수락 시점 검증 — 운영자 설정과 실데이터의 드리프트를 여기서 드러낸다.
        //  담당 기간(=배정 기간)과 겹치는 재적이 그 현장에 있어야 한다.
        const placement = await tx.traineePlacement.findFirst({
          where: {
            traineeId,
            siteId,
            startDate: { lte: end },
            OR: [{ endDate: null }, { endDate: { gte: start } }],
          },
          orderBy: { startDate: "asc" },
          select: { id: true },
        });
        if (!placement) {
          throw new PilotAcceptAbort(
            "PLACEMENT_MISSING",
            "담당 훈련생의 사업체 재적 정보가 배정 기간과 맞지 않습니다. 운영자에게 문의해주세요.",
          );
        }

        const sup = await createTraineeSupervisionInTx(tx, {
          traineeId,
          placementId: placement.id,
          assignmentId: assignment.id,
          startDate: start,
          endDate: end,
          pilotSessionId: sessionId,
        });
        if (!sup.ok) {
          throw new PilotAcceptAbort("SUPERVISION_REJECTED", sup.message);
        }
      }

      // ── 9. 참여자·초대 마감 ─────────────────────────────────
      await tx.pilotParticipant.update({
        where: { id: participant.id },
        data: {
          workerId,
          status: "ACCEPTED",
          createdAssignmentId: assignment.id,
          acceptedAt: new Date(),
        },
      });

      return {
        ok: true as const,
        workerId,
        assignmentId: assignment.id,
        alreadyAccepted: false,
      };
    });
  } catch (e) {
    if (e instanceof PilotAcceptAbort) {
      return { ok: false, code: e.code, message: e.detail };
    }
    throw e;
  }
}

/** 참여자 설정과 초대의 정합을 미리 확인한다(수락 전 사전 조회용). */
export async function findPilotParticipantByInvite(
  inviteId: bigint,
): Promise<{ sessionStatus: string; participantStatus: string } | null> {
  const p = await prisma.pilotParticipant.findUnique({
    where: { inviteId },
    select: { status: true, pilotSession: { select: { status: true } } },
  });
  if (!p) return null;
  return { sessionStatus: p.pilotSession.status, participantStatus: p.status };
}
