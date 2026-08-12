// lib/pilot/connectInvite.ts
// 파일럿 기존 Worker 연결 도메인 서비스 — v1.8 §5.1.
//
// ★F1 — 검사-쓰기 분리를 없앤다.
//  초안은 회차 READY 검사가 최종 트랜잭션 **밖**이었고, 참여자 CAS의 count도 확인하지 않았다.
//  운영자의 참여자 취소와 워커의 연결이 겹치면 배정 connectedAt·ACTIVE 전이·초대 사용은
//  커밋되는데 참여자 갱신만 조용히 실패해 **취소된 참여자의 배정이 활성화**되는 부분 정합이 생긴다.
//  신규 Worker 경로(acceptInvite)가 락 안 재조회로 막아 둔 바로 그 클래스다.
//
//  → 재조회·검사·쓰기를 **하나의 인터랙티브 트랜잭션**에서 하고, 참여자 CAS의 count를 검증한다.
//    하나라도 실패하면 배정·초대까지 전부 롤백된다.

import { prisma } from "@/lib/prisma";
import { acquirePilotSessionLock } from "@/lib/assignmentLock";

export type ConnectPilotFailure =
  | "INVITE_NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INVITE_USED"
  | "ASSIGNMENT_MISSING"     // 초대에 연결할 배정이 없다(발급이 잘못된 초대)
  | "ASSIGNMENT_NOT_OWNED"
  | "SESSION_NOT_READY"
  | "PARTICIPANT_NOT_READY"; // 취소됐거나 이미 처리된 참여자

export type ConnectPilotInviteResult =
  | { ok: true; assignmentId: bigint; siteName: string | null; alreadyConnected: boolean }
  | { ok: false; code: ConnectPilotFailure; message: string; status: number };

export interface ConnectPilotInviteInput {
  workerId: bigint;
  inviteId: bigint;
}

class ConnectAbort extends Error {
  constructor(readonly status: number, readonly reason: ConnectPilotFailure, readonly detail: string) {
    super(reason);
  }
}

/**
 * 파일럿 초대로 기존 Worker의 배정을 연결한다.
 *
 * 배정 연결·상태 전이·초대 사용·참여자 ACCEPTED 전환을 한 트랜잭션에서 처리하며,
 * 참여자 상태가 `INVITED`가 아니면(취소·중복 처리) 전부 롤백한다.
 */
export async function connectExistingPilotInvite(
  input: ConnectPilotInviteInput,
): Promise<ConnectPilotInviteResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      // ── 재조회 (전부 트랜잭션 안에서) ────────────────────────
      // 락을 잡을 회차 id를 알아내는 사전 조회. 이 값으로 판정하지 않는다.
      const preload = await tx.workerInvite.findUnique({
        where: { id: input.inviteId },
        select: { pilotSessionId: true },
      });
      // ★회차 락(전역 순서 맨 앞) — 상태 전이와 직렬화한다.
      if (preload?.pilotSessionId) {
        await acquirePilotSessionLock(tx, preload.pilotSessionId);
      }

      const invite = await tx.workerInvite.findUnique({
        where: { id: input.inviteId },
        select: {
          id: true, expiresAt: true, usedAt: true, assignmentId: true,
          existingWorkerId: true, pilotSessionId: true,
        },
      });
      if (!invite || invite.existingWorkerId !== input.workerId) {
        throw new ConnectAbort(404, "INVITE_NOT_FOUND", "유효하지 않은 인증코드입니다.");
      }
      if (invite.usedAt) {
        throw new ConnectAbort(410, "INVITE_USED", "이미 사용된 인증코드입니다.");
      }
      if (new Date() > invite.expiresAt) {
        throw new ConnectAbort(410, "INVITE_EXPIRED", "만료된 인증코드입니다. 담당자에게 재발급을 요청하세요.");
      }
      if (!invite.assignmentId) {
        throw new ConnectAbort(422, "ASSIGNMENT_MISSING", "연결할 배정 정보가 없습니다.");
      }

      const assignment = await tx.siteAssignment.findFirst({
        where: { id: invite.assignmentId, workerId: input.workerId },
        select: {
          id: true, connectedAt: true, status: true, attendanceButtonExempt: true,
          site: { select: { companyName: true } },
        },
      });
      if (!assignment) {
        throw new ConnectAbort(404, "ASSIGNMENT_NOT_OWNED", "연결할 배정을 찾을 수 없습니다.");
      }

      // ── 파일럿 회차 재검증 ──────────────────────────────────
      // 발급 시점에 READY였어도 연결까지 시간이 지나면 회차가 닫혔을 수 있다.
      if (invite.pilotSessionId) {
        const session = await tx.pilotSession.findUnique({
          where: { id: invite.pilotSessionId },
          select: { status: true },
        });
        if (session?.status !== "READY") {
          throw new ConnectAbort(
            409, "SESSION_NOT_READY",
            "지금은 파일럿 참여를 연결할 수 없습니다. 운영자에게 문의해주세요.",
          );
        }

        // ★참여자 CAS — INVITED일 때만 ACCEPTED로 넘긴다. count를 반드시 확인한다.
        //  취소(CANCELLED)와 겹치면 여기서 0이 되어 아래 쓰기까지 전부 롤백된다.
        const advanced = await tx.pilotParticipant.updateMany({
          where: { inviteId: invite.id, status: "INVITED" },
          data: { status: "ACCEPTED", acceptedAt: new Date() },
        });
        if (advanced.count === 0) {
          throw new ConnectAbort(
            409, "PARTICIPANT_NOT_READY",
            "참여 설정이 변경되었습니다. 운영자에게 문의해주세요.",
          );
        }
      }

      // ── 쓰기 ────────────────────────────────────────────────
      await tx.siteAssignment.updateMany({
        where: { id: assignment.id, connectedAt: null },
        data: { connectedAt: new Date() },
      });
      // 출퇴근 버튼 미적용(자동 기록) 배정은 위치확정 단계가 없으므로 연결 시 바로 ACTIVE로 전이.
      if (assignment.attendanceButtonExempt) {
        await tx.siteAssignment.updateMany({
          where: { id: assignment.id, status: "CONFIRMED" },
          data: { status: "ACTIVE" },
        });
      }
      await tx.workerInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedByWorkerId: input.workerId },
      });

      return {
        ok: true as const,
        assignmentId: assignment.id,
        siteName: assignment.site?.companyName ?? null,
        alreadyConnected: assignment.connectedAt != null,
      };
    });
  } catch (e) {
    if (e instanceof ConnectAbort) {
      return { ok: false, code: e.reason, message: e.detail, status: e.status };
    }
    throw e;
  }
}
