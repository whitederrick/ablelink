// lib/pilot/issueInvite.ts
// 파일럿 초대 발급 도메인 서비스 — v1.8 §5.1·§5.2.
//
// 라우트는 인증·입력 변환·HTTP 응답만 담당하고, 트랜잭션 규칙은 여기 한 곳에 둔다.
// 검증 스크립트도 이 함수를 직접 호출한다 — 스크립트가 로직을 재현하면 라우트가 회귀해도
// 검증이 통과해 버린다(재현 테스트는 실코드를 지키지 못한다).

import { prisma } from "@/lib/prisma";

export type IssuePilotInviteFailure =
  | "SESSION_NOT_FOUND"
  | "SESSION_STATUS"        // DRAFT/READY가 아니면 발급 불가
  | "NOT_IN_SESSION"
  | "CANCELLED"
  | "SITE_REQUIRED"
  | "ALREADY_INVITED"
  | "ASSIGNMENT_REQUIRED"   // 기존 Worker인데 연결할 배정이 아직 없다
  | "ASSIGNMENT_MISMATCH";  // 배정이 참여자·회차와 어긋난다

export type IssuePilotInviteResult =
  | { ok: true; invite: { id: bigint; code: string; expiresAt: Date; phoneNumber: string; assignmentId: bigint | null } }
  | { ok: false; code: IssuePilotInviteFailure; message: string; status: number };

export interface IssuePilotInviteInput {
  sessionId: bigint;
  participantId: bigint;
  phoneNumber: string;
  workerName?: string | null;
  createdByAdminId: bigint;
  /** 인증번호 생성기(테스트에서 고정값 주입용). 기본은 6자리 난수. */
  generateCode?: () => string;
  ttlDays?: number;
}

const DEFAULT_TTL_DAYS = 7;

function defaultCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** 발급을 중단하고 초대 생성까지 롤백하기 위한 내부 신호. */
class IssueAbort extends Error {
  constructor(readonly status: number, readonly reason: IssuePilotInviteFailure, readonly detail: string) {
    super(reason);
  }
}

/**
 * 파일럿 초대를 발급하고 참여자에 연결한다.
 *
 * ★참여자 검증·연결을 **트랜잭션 안에서** 원자적 CAS로 수행한다. 밖에서 검사하면 동시 발급 둘이
 *  모두 통과해 초대가 2건 생기고, 나중 update가 inviteId를 덮어써 **고아 초대**(유효기간이
 *  살아 있는데 어디에도 연결되지 않은 코드)가 남는다.
 *
 * ★기존 Worker 초대는 배정이 먼저 있어야 발급된다. 연결 API가 invite.assignmentId를 필수로
 *  요구하므로(worker/assignment/connect), 배정 없이 발급하면 수락이 구조적으로 불가능한
 *  막다른 초대가 된다.
 */
export async function issuePilotInvite(input: IssuePilotInviteInput): Promise<IssuePilotInviteResult> {
  const expiresAt = new Date(Date.now() + (input.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000);
  const makeCode = input.generateCode ?? defaultCode;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.pilotSession.findUnique({
        where: { id: input.sessionId },
        select: { id: true, status: true, agencyId: true },
      });
      if (!session) throw new IssueAbort(404, "SESSION_NOT_FOUND", "파일럿 회차를 찾을 수 없습니다.");
      // 초대는 셋업 단계에서만 발급한다. ACTIVE 이후 참여자 추가·초대 발급은 허용하지 않는다.
      if (session.status !== "DRAFT" && session.status !== "READY") {
        throw new IssueAbort(409, "SESSION_STATUS", "이 회차는 초대를 발급할 수 있는 상태가 아닙니다.");
      }

      const participant = await tx.pilotParticipant.findUnique({
        where: { id: input.participantId },
        select: {
          id: true, pilotSessionId: true, status: true, inviteId: true,
          siteId: true, workerId: true, createdAssignmentId: true,
        },
      });
      if (!participant || participant.pilotSessionId !== input.sessionId) {
        throw new IssueAbort(404, "NOT_IN_SESSION", "이 회차의 참여자가 아닙니다.");
      }
      if (participant.status === "CANCELLED") {
        throw new IssueAbort(409, "CANCELLED", "취소된 참여자입니다.");
      }
      if (participant.siteId == null) {
        throw new IssueAbort(400, "SITE_REQUIRED", "참여자에 사업체가 지정되지 않았습니다.");
      }
      if (participant.inviteId != null) {
        throw new IssueAbort(409, "ALREADY_INVITED", "이미 초대가 발급된 참여자입니다.");
      }

      // ── 기존 Worker 경로: 연결할 배정이 이미 있어야 한다 ──────────
      let linkedAssignmentId: bigint | null = null;
      if (participant.workerId != null) {
        if (participant.createdAssignmentId == null) {
          throw new IssueAbort(
            400, "ASSIGNMENT_REQUIRED",
            "기존 직무지도원은 배정을 먼저 만든 뒤 초대를 발급할 수 있습니다.",
          );
        }
        const asg = await tx.siteAssignment.findUnique({
          where: { id: participant.createdAssignmentId },
          select: { id: true, workerId: true, pilotSessionId: true },
        });
        // 3중 일치 — 배정의 워커·회차가 참여자 설정과 같아야 한다.
        if (!asg || asg.workerId !== participant.workerId || asg.pilotSessionId !== input.sessionId) {
          throw new IssueAbort(409, "ASSIGNMENT_MISMATCH", "참여자 설정과 배정 정보가 일치하지 않습니다.");
        }
        linkedAssignmentId = asg.id;
      }

      const invite = await tx.workerInvite.create({
        data: {
          agencyId: session.agencyId,
          // ★siteId는 넣지 않는다. 신규 Worker의 배정은 참여자 설정값으로 수락 트랜잭션이 만들며,
          //  siteId가 있으면 기존 자동 배정 분기와 의미가 겹친다.
          phoneNumber: input.phoneNumber,
          workerName: input.workerName ?? null,
          code: makeCode(),
          expiresAt,
          createdByAdminId: input.createdByAdminId,
          pilotSessionId: input.sessionId,
          purpose: participant.workerId != null ? "CONNECT_EXISTING" : "NEW_ACCOUNT",
          existingWorkerId: participant.workerId,
          assignmentId: linkedAssignmentId,
        },
        select: { id: true, code: true, expiresAt: true, phoneNumber: true, assignmentId: true },
      });

      // ★원자적 CAS — inviteId가 아직 null인 경우에만 연결한다.
      //  경합에서 지면 count===0이므로 throw해 방금 만든 초대까지 롤백한다(고아 초대 방지).
      const linked = await tx.pilotParticipant.updateMany({
        where: { id: participant.id, inviteId: null },
        data: { inviteId: invite.id, status: "INVITED" },
      });
      if (linked.count === 0) {
        throw new IssueAbort(409, "ALREADY_INVITED", "이미 초대가 발급된 참여자입니다.");
      }

      return invite;
    });

    return { ok: true, invite: created };
  } catch (e) {
    if (e instanceof IssueAbort) {
      return { ok: false, code: e.reason, message: e.detail, status: e.status };
    }
    throw e;
  }
}
