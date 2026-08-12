// lib/pilot/purge.ts
// 파일럿 회차 데이터 폐기 — v1.8 §11, §12 9단계.
//
// ★이 파일의 위험은 "너무 많이 지우는 것"이다.
//  파일럿은 **실제 위탁기관**에서 돌고, 기존 Worker와 재사용한 Site·Trainee가 섞여 있다.
//  그래서 삭제 대상은 전부 **회차 표식이 박힌 것**으로만 고른다:
//    - 참여/소속: pilotSessionId
//    - 생성 출처: createdByPilotSessionId (+ 다른 정상 참조가 없을 때만)
//  기관·기존 Worker·재사용 자원·감사 로그·회차 이력은 보존한다.
//
// ★삭제 순서는 FK가 정한다(실측):
//    TraineeSupervision.assignment 관계는 onDelete 미지정 = **RESTRICT**라 배정보다 먼저 지워야 한다.
//    WorkerInvite.site FK가 있어 초대를 Site보다 먼저 지운다.
//    배정을 지우면 DailyAttendance(→TraineeLog)·DocumentRun(→DocumentVersion)·SiteHoliday·
//    SiteSignToken이 Cascade로 함께 사라진다 — 문서·서명 토큰이 여기서 정리된다.

import { prisma } from "@/lib/prisma";
import { acquirePilotSessionLock } from "@/lib/assignmentLock";
import type { Prisma } from "@prisma/client";

export type PurgeFailure = "NOT_FOUND" | "NOT_ENDED" | "HAS_PROTECTED_DATA";

export type PurgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: PurgeFailure; message: string; status: number };

class Abort extends Error {
  constructor(readonly status: number, readonly reason: PurgeFailure, readonly detail: string) { super(reason); }
}
function fail(status: number, reason: PurgeFailure, detail: string): never {
  throw new Abort(status, reason, detail);
}

export interface PurgeCounts {
  participantTrainees: number;
  supervisions: number;
  invites: number;
  attendances: number;
  documentRuns: number;
  assignments: number;
  placements: number;
  traineesDeleted: number;
  traineesKept: number;
  sitesDeleted: number;
  sitesKept: number;
  workersPaused: number;
}

/**
 * 폐기 전에 무엇이 지워지는지 세어 본다(미리보기).
 *
 * ★운영자가 "지운다"를 누르기 전에 숫자를 봐야 한다. 특히 재사용 자원이
 *  **보존**되는 것을 눈으로 확인해야 한다 — 이 기능이 잘못되면 실제 기관 데이터가 사라진다.
 */
export async function previewPilotPurge(pilotSessionId: bigint): Promise<PurgeResult<PurgeCounts>> {
  try {
    const s = await prisma.pilotSession.findUnique({
      where: { id: pilotSessionId },
      select: { id: true, status: true },
    });
    if (!s) fail(404, "NOT_FOUND", "회차를 찾을 수 없습니다.");
    return { ok: true, value: await countTargets(prisma, pilotSessionId) };
  } catch (e) {
    if (e instanceof Abort) return { ok: false, code: e.reason, message: e.detail, status: e.status };
    throw e;
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

async function countTargets(db: Db, pilotSessionId: bigint): Promise<PurgeCounts> {
  const assignments = await db.siteAssignment.findMany({ where: { pilotSessionId }, select: { id: true } });
  const assignmentIds = assignments.map(a => a.id);

  const [participantTrainees, supervisions, invites, attendances, documentRuns, placements] = await Promise.all([
    db.pilotParticipantTrainee.count({ where: { participant: { pilotSessionId } } }),
    db.traineeSupervision.count({ where: { pilotSessionId } }),
    db.workerInvite.count({ where: { pilotSessionId } }),
    assignmentIds.length ? db.dailyAttendance.count({ where: { assignmentId: { in: assignmentIds } } }) : Promise.resolve(0),
    assignmentIds.length ? db.documentRun.count({ where: { assignmentId: { in: assignmentIds } } }) : Promise.resolve(0),
    db.traineePlacement.count({ where: { pilotSessionId } }),
  ]);

  const trainees = await classifyTrainees(db, pilotSessionId, assignmentIds);
  const sites = await classifySites(db, pilotSessionId, trainees.deletable);
  const workersPaused = await db.worker.count({ where: { createdByPilotSessionId: pilotSessionId } });

  return {
    participantTrainees, supervisions, invites, attendances, documentRuns,
    assignments: assignmentIds.length, placements,
    traineesDeleted: trainees.deletable.length, traineesKept: trainees.kept,
    sitesDeleted: sites.deletable.length, sitesKept: sites.kept,
    workersPaused,
  };
}

/**
 * 회차가 만든 훈련생 중 **파일럿 밖 참조가 없는** 것만 삭제 대상이다.
 * 파일럿 기간에 정상 업무로 재적·일지가 붙었다면 그건 더 이상 파일럿만의 자원이 아니다.
 *
 * ★"참조"에서 **파일럿 자신이 만든 것은 빼야 한다.** 처음엔 일지·재적이 하나라도 있으면 보존으로
 *  분류했는데, 그러면 파일럿이 만든 일지 때문에 파일럿 훈련생이 영원히 안 지워진다(검증에서 잡힘).
 *  같은 폐기에서 함께 사라질 것은 참조로 치지 않는다.
 */
async function classifyTrainees(db: Db, pilotSessionId: bigint, pilotAssignmentIds: bigint[]) {
  const created = await db.trainee.findMany({
    where: { createdByPilotSessionId: pilotSessionId },
    select: {
      id: true,
      placements: { where: { pilotSessionId: null }, select: { id: true }, take: 1 },
      supervisions: { where: { pilotSessionId: null }, select: { id: true }, take: 1 },
      // 일지는 근태를 통해 배정에 매달린다 — 파일럿 배정의 일지는 Cascade로 사라지므로 제외한다.
      logs: {
        where: pilotAssignmentIds.length
          ? { attendance: { assignmentId: { notIn: pilotAssignmentIds } } }
          : {},
        select: { id: true }, take: 1,
      },
      // ★종합평가(TraineeEvaluation)에는 배정도 회차 표식도 없다(실측 — assignmentId 자체가 없다).
      //  다만 **회차가 만든 훈련생의 평가**는 파일럿에서만 생길 수 있으므로 파일럿 산출물로 보고
      //  훈련생과 함께 지운다. 그래서 여기서는 외부 참조로 세지 않는다.
      //  (재사용 훈련생의 평가는 구분할 근거가 없어 손대지 않는다 — 보존이 안전한 쪽이다.)
    },
  });
  const deletable: bigint[] = [];
  let kept = 0;
  for (const t of created) {
    const referenced = t.placements.length > 0 || t.logs.length > 0 || t.supervisions.length > 0;
    if (referenced) kept++; else deletable.push(t.id);
  }
  return { deletable, kept };
}

/**
 * 회차가 만든 현장 중 파일럿 밖 배정·재적이 없는 것만 삭제 대상.
 *
 * ★현장에 매달린 훈련생도 같은 규칙이다 — **이번 폐기로 함께 지워질 훈련생**은 참조가 아니다.
 */
async function classifySites(db: Db, pilotSessionId: bigint, deletableTraineeIds: bigint[]) {
  const created = await db.site.findMany({
    where: { createdByPilotSessionId: pilotSessionId },
    select: {
      id: true,
      assignments: { where: { pilotSessionId: null }, select: { id: true }, take: 1 },
      placements: { where: { pilotSessionId: null }, select: { id: true }, take: 1 },
      trainees: {
        where: deletableTraineeIds.length ? { id: { notIn: deletableTraineeIds } } : {},
        select: { id: true }, take: 1,
      },
    },
  });
  const deletable: bigint[] = [];
  let kept = 0;
  for (const s of created) {
    const referenced = s.assignments.length > 0 || s.placements.length > 0 || s.trainees.length > 0;
    if (referenced) kept++; else deletable.push(s.id);
  }
  return { deletable, kept };
}

/**
 * 회차 데이터를 폐기하고 `PURGED`로 전환한다.
 *
 * ★`ENDED`에서만 허용한다. 진행 중인 회차를 지우는 버튼은 있어서는 안 된다.
 * ★회차 락(NS=5)을 잡는다 — 전이·초대 경로와 같은 축이라 폐기 중 상태가 바뀌지 않는다.
 * ★신규 Worker는 **hard delete 하지 않는다**(§11). 다른 정상 배정이 없으면 PAUSED로 내리고
 *  sessionVersion을 올려 로그인을 끊는다. 계정을 지우면 감사 로그의 행위자가 사라진다.
 */
export async function purgePilotSession(pilotSessionId: bigint): Promise<PurgeResult<PurgeCounts>> {
  try {
    const counts = await prisma.$transaction(async (tx) => {
      await acquirePilotSessionLock(tx, pilotSessionId);

      const s = await tx.pilotSession.findUnique({
        where: { id: pilotSessionId },
        select: { id: true, status: true },
      });
      if (!s) fail(404, "NOT_FOUND", "회차를 찾을 수 없습니다.");
      if (s.status !== "ENDED") {
        fail(409, "NOT_ENDED", "종료(ENDED)된 회차만 폐기할 수 있습니다.");
      }

      const result = await countTargets(tx, pilotSessionId);
      const assignments = await tx.siteAssignment.findMany({ where: { pilotSessionId }, select: { id: true } });
      const assignmentIds = assignments.map(a => a.id);
      const trainees = await classifyTrainees(tx, pilotSessionId, assignmentIds);
      const sites = await classifySites(tx, pilotSessionId, trainees.deletable);

      // ── 순서가 곧 안전이다(위 헤더 주석의 FK 실측 참고) ──
      await tx.pilotParticipantTrainee.deleteMany({ where: { participant: { pilotSessionId } } });
      await tx.traineeSupervision.deleteMany({ where: { pilotSessionId } });      // RESTRICT — 배정보다 먼저
      await tx.workerInvite.deleteMany({ where: { pilotSessionId } });            // Site FK — Site보다 먼저
      // 배정 삭제가 근태·일지·문서·서명토큰·현장휴무를 Cascade로 데려간다.
      if (assignmentIds.length) {
        await tx.siteAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
      }
      await tx.traineePlacement.deleteMany({ where: { pilotSessionId } });

      if (trainees.deletable.length) {
        // 평가는 훈련생 FK가 RESTRICT라 훈련생보다 먼저 지워야 한다(회차가 만든 훈련생의 평가뿐).
        await tx.traineeEvaluation.deleteMany({ where: { traineeId: { in: trainees.deletable } } });
        await tx.trainee.deleteMany({ where: { id: { in: trainees.deletable } } });
      }
      if (sites.deletable.length) {
        await tx.site.deleteMany({ where: { id: { in: sites.deletable } } });
      }

      // 신규 Worker: 삭제 금지 → 로그인만 끊는다.
      const created = await tx.worker.findMany({
        where: { createdByPilotSessionId: pilotSessionId },
        select: { id: true, sessionVersion: true },
      });
      for (const w of created) {
        await tx.worker.update({
          where: { id: w.id },
          data: { status: "PAUSED", sessionVersion: { increment: 1 } },
        });
      }

      // 참여 이력은 보존한다 — 끊어진 참조만 정리하고 폐기 시각을 남긴다.
      await tx.pilotParticipant.updateMany({
        where: { pilotSessionId },
        data: { inviteId: null, createdAssignmentId: null, purgedAt: new Date() },
      });

      await tx.pilotSession.update({
        where: { id: pilotSessionId },
        data: { status: "PURGED", purgedAt: new Date() },
      });

      return result;
    });

    return { ok: true, value: counts };
  } catch (e) {
    if (e instanceof Abort) return { ok: false, code: e.reason, message: e.detail, status: e.status };
    throw e;
  }
}
