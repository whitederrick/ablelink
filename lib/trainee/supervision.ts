// lib/trainee/supervision.ts
// 직무지도원 전담(TraineeSupervision) 관계 불변식 검증 — D-1 §3.
//
// 문서 접근권은 "훈련생 소유"가 아니라 관여 사실에서 파생된다:
//   배정(SiteAssignment) ∩ 재적(TraineePlacement) ∩ 담당(TraineeSupervision) ∩ 요청기간
// 배정·재적만으로는 같은 사업체에 직무지도원이 2명일 때 누가 어느 훈련생을 담당하는지 구분할 수 없다.
//
// 구성(lib/traineePlacement.ts와 같은 규율 — 순수 판정 + DB 헬퍼를 한 파일에):
//   · checkSupervisionInvariants     — 순수 함수. 조회 결과를 받아 불변식만 판정(테스트 가능).
//   · createTraineeSupervisionInTx   — 기존 트랜잭션에 합류. 락 → 재조회 → 검증 → 생성.
//   · createTraineeSupervision       — 단독 실행용. 트랜잭션을 열고 위 함수를 호출.
//   · closeTraineeSupervision        — 종료일 기록(삭제 아님) + 종료일 검증 + CAS.
//
// ★사전 검사만으로는 TOCTOU를 막지 못한다. 검사와 생성 사이에 직렬화가 없으면 ms 단위 동시 요청 둘이
//   모두 "겹치는 기간 없음"을 통과해 한 훈련생이 두 직무지도원에게 담당되는 상태가 새어나간다.
//   → 반드시 withTraineeLock(NS=4) 안에서 **재조회**한 뒤 검증한다. 락 밖에서 읽은 값으로 판정하지 않는다.
//
// ★출근부의 1:1/1:多 표기(2026-06-18 확정 = 해당 날짜·현장의 재적 훈련생 수)는 이 관계 도입으로
//   변경하지 않는다. 담당 관계는 접근권·coverage 전용이며 급여 로직의 근거가 아니다.

import type { Prisma } from "@prisma/client";
import { dateRangesOverlap } from "@/lib/assignmentOverlap";
import { withTraineeLock, acquireTraineeLock } from "@/lib/assignmentLock";
import { prisma } from "@/lib/prisma";

/** 담당 관계를 만들 때 검증할 후보 값. */
export interface SupervisionCandidate {
  traineeId: bigint;
  placementId: bigint;
  assignmentId: bigint;
  startDate: Date | string;
  /** null = 열린 기간(무기한). */
  endDate?: Date | string | null;
  /**
   * 파일럿 회차 귀속. null/미지정 = 정상 운영 담당 관계.
   * ★기관·기간이 아니라 이 FK로만 파일럿을 판정하므로, 파일럿 경로는 반드시 채워야 한다.
   */
  pilotSessionId?: bigint | null;
}

/** 검증에 필요한 재적 정보(호출부가 placementId로 조회해 전달). */
export interface PlacementRef {
  id: bigint;
  traineeId: bigint;
  siteId: bigint;
  startDate: Date | string;
  endDate?: Date | string | null;
}

/** 검증에 필요한 배정 정보(호출부가 assignmentId로 조회해 전달). */
export interface AssignmentRef {
  id: bigint;
  siteId: bigint;
  status: string;
  startDate: Date | string;
  endDate?: Date | string | null;
}

/** 같은 훈련생의 기존 담당 관계(자기 자신은 제외하고 전달). */
export interface SupervisionRef {
  id: bigint;
  traineeId: bigint;
  startDate: Date | string;
  endDate?: Date | string | null;
}

export type SupervisionViolation =
  | "TRAINEE_MISMATCH"        // 3-1 supervision.traineeId != placement.traineeId
  | "SITE_MISMATCH"           // 3-2 assignment.siteId != placement.siteId
  | "OUTSIDE_PLACEMENT"       // 3-3 담당 기간이 재적 기간을 벗어남
  | "OUTSIDE_ASSIGNMENT"      // 3-3 담당 기간이 배정 기간을 벗어남
  | "ASSIGNMENT_ENDED_OPEN"   // 3-3 ENDED인데 종료일이 없는 배정 → fail-closed
  | "INVALID_RANGE"           // 시작일 > 종료일
  | "OVERLAPPING_SUPERVISION"; // 3-4 동일 훈련생의 담당 기간 중복

export interface SupervisionCheckResult {
  ok: boolean;
  violations: SupervisionViolation[];
  /** OVERLAPPING_SUPERVISION일 때 충돌한 기존 관계. */
  conflict?: SupervisionRef;
}

export const SUPERVISION_VIOLATION_MESSAGE: Record<SupervisionViolation, string> = {
  TRAINEE_MISMATCH: "담당 관계의 훈련생이 재적 정보의 훈련생과 다릅니다.",
  SITE_MISMATCH: "배정 현장과 재적 현장이 다릅니다.",
  OUTSIDE_PLACEMENT: "담당 기간이 훈련생의 재적 기간을 벗어납니다.",
  OUTSIDE_ASSIGNMENT: "담당 기간이 직무지도원의 배정 기간을 벗어납니다.",
  ASSIGNMENT_ENDED_OPEN: "종료된 배정에 종료일이 없어 담당 기간을 확정할 수 없습니다.",
  INVALID_RANGE: "담당 시작일이 종료일보다 늦습니다.",
  OVERLAPPING_SUPERVISION: "이 훈련생은 해당 기간에 이미 다른 직무지도원이 담당하고 있습니다.",
};

/**
 * KST 캘린더 일수(에폭 이후 일수)로 정규화.
 * ★startDate가 `new Date()`(시각 포함)으로 저장되는 경로와 UTC 자정으로 저장되는 경로가 혼재하므로
 *  밀리초로 비교하면 경계일 하루를 놓친다. assignmentOverlap.dateRangesOverlap과 동일 규율.
 */
function toKstDay(v: Date | string | null | undefined, fallback: number): number {
  if (v == null) return fallback;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return fallback;
  return Math.floor((t + 9 * 60 * 60 * 1000) / 86400000);
}

/** inner의 기간이 outer의 기간에 완전히 포함되는가(열린 끝 = 무기한). */
function isWithin(
  inner: { startDate: Date | string; endDate?: Date | string | null },
  outer: { startDate: Date | string; endDate?: Date | string | null },
): boolean {
  const iStart = toKstDay(inner.startDate, -Infinity);
  const iEnd = toKstDay(inner.endDate, Infinity);
  const oStart = toKstDay(outer.startDate, -Infinity);
  const oEnd = toKstDay(outer.endDate, Infinity);
  return iStart >= oStart && iEnd <= oEnd;
}

/**
 * 담당 관계 생성·수정 시 D-1 §3 불변식을 전부 검증한다.
 *
 * 금지 대상은 **"같은 훈련생에 대한 담당 중복"**이다.
 * 한 직무지도원이 서로 다른 훈련생을 동시에 담당하는 것은 정상이며, 이것이 출근부 1:多의 근거다.
 *
 * @param existingSupervisions 같은 훈련생의 기존 담당 관계. 수정이라면 자기 자신은 빼고 전달한다.
 */
export function checkSupervisionInvariants(
  candidate: SupervisionCandidate,
  placement: PlacementRef,
  assignment: AssignmentRef,
  existingSupervisions: SupervisionRef[],
): SupervisionCheckResult {
  const violations: SupervisionViolation[] = [];
  let conflict: SupervisionRef | undefined;

  // 후보 자체의 기간이 뒤집혀 있으면 이후 포함·겹침 판정이 무의미하다.
  const cStart = toKstDay(candidate.startDate, -Infinity);
  const cEnd = toKstDay(candidate.endDate, Infinity);
  if (cStart > cEnd) violations.push("INVALID_RANGE");

  // 3-1 훈련생 일치
  if (candidate.traineeId !== placement.traineeId) violations.push("TRAINEE_MISMATCH");

  // 3-2 현장 일치 — 배정과 재적이 같은 현장이어야 담당이 성립한다.
  if (assignment.siteId !== placement.siteId) violations.push("SITE_MISMATCH");

  // 3-3 기간 포함: 담당 ⊆ 재적 그리고 담당 ⊆ 배정
  if (!isWithin(candidate, placement)) violations.push("OUTSIDE_PLACEMENT");

  // ★ENDED인데 종료일이 없는 배정은 fail-closed. 열린 기간으로 취급하면 종료된 배정에
  //  무기한 담당이 붙어 접근권이 영구히 열린다.
  if (assignment.status === "ENDED" && assignment.endDate == null) {
    violations.push("ASSIGNMENT_ENDED_OPEN");
  } else if (!isWithin(candidate, assignment)) {
    violations.push("OUTSIDE_ASSIGNMENT");
  }

  // 3-4 동일 훈련생의 담당 기간 중복 금지
  for (const ex of existingSupervisions) {
    if (ex.traineeId !== candidate.traineeId) continue; // 호출부 조회 실수 방어
    if (dateRangesOverlap(candidate, ex)) {
      violations.push("OVERLAPPING_SUPERVISION");
      conflict = ex;
      break;
    }
  }

  return { ok: violations.length === 0, violations, conflict };
}

/** 첫 위반의 사용자 메시지(400/409 응답용). 위반이 없으면 null. */
export function firstSupervisionMessage(result: SupervisionCheckResult): string | null {
  const v = result.violations[0];
  return v ? SUPERVISION_VIOLATION_MESSAGE[v] : null;
}

// ── 트랜잭션 서비스 ────────────────────────────────────────────────

export type CreateSupervisionResult =
  | { ok: true; id: bigint }
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "INVARIANT"; violations: SupervisionViolation[]; message: string; conflictId?: bigint };

/**
 * 담당 관계를 생성한다 — **이미 열려 있는 트랜잭션에 합류하는** 형태.
 *
 * 초대 수락처럼 Worker·배정·담당 관계를 **하나의 트랜잭션**으로 만들어야 하는 경로는
 * 자체 트랜잭션을 새로 열 수 없다(중첩 시 부분 커밋이 생긴다). 그런 호출부는 이 함수를 쓴다.
 *
 * 락은 전달받은 `tx` 위에서 잡는다. 호출부는 전역 획득 순서
 * `[site|post] → worker → trainee`를 지켜야 한다.
 *
 * ★재조회를 락 안에서 하는 것이 핵심이다. 호출부가 미리 읽어 둔 placement/assignment/기존 관계로
 *  판정하면 검사 자체가 TOCTOU가 된다(= 이 함수가 존재하는 이유).
 */
export async function createTraineeSupervisionInTx(
  tx: Prisma.TransactionClient,
  input: SupervisionCandidate,
): Promise<CreateSupervisionResult> {
  await acquireTraineeLock(tx, input.traineeId);

  // 락 획득 후 재조회 — 여기부터가 임계구역이다.
  const [placement, assignment, existing] = await Promise.all([
    tx.traineePlacement.findUnique({
      where: { id: input.placementId },
      select: { id: true, traineeId: true, siteId: true, startDate: true, endDate: true },
    }),
    tx.siteAssignment.findUnique({
      where: { id: input.assignmentId },
      select: { id: true, siteId: true, status: true, startDate: true, endDate: true },
    }),
    tx.traineeSupervision.findMany({
      where: { traineeId: input.traineeId },
      select: { id: true, traineeId: true, startDate: true, endDate: true },
    }),
  ]);

  if (!placement || !assignment) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
      message: !placement ? "재적 정보를 찾을 수 없습니다." : "배정 정보를 찾을 수 없습니다.",
    };
  }

  const check = checkSupervisionInvariants(input, placement, assignment, existing);
  if (!check.ok) {
    return {
      ok: false as const,
      code: "INVARIANT" as const,
      violations: check.violations,
      message: firstSupervisionMessage(check) ?? "담당 관계를 만들 수 없습니다.",
      conflictId: check.conflict?.id,
    };
  }

  const created = await tx.traineeSupervision.create({
    data: {
      traineeId: input.traineeId,
      placementId: input.placementId,
      assignmentId: input.assignmentId,
      startDate: new Date(input.startDate),
      endDate: input.endDate == null ? null : new Date(input.endDate),
      pilotSessionId: input.pilotSessionId ?? null,
    },
    select: { id: true },
  });

  return { ok: true as const, id: created.id };
}

/**
 * 담당 관계를 단독으로 생성한다. 트랜잭션과 락을 스스로 열고 InTx 구현을 호출한다.
 *
 * 던지지 않고 결과 객체를 반환한다 — 호출부가 위반 종류에 따라 400(입력 오류)과
 * 409(중복 충돌)를 구분해 응답할 수 있게 하기 위해서다.
 */
export async function createTraineeSupervision(
  input: SupervisionCandidate,
): Promise<CreateSupervisionResult> {
  return withTraineeLock(input.traineeId, (tx) => createTraineeSupervisionInTx(tx, input));
}

export type CloseSupervisionResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_CLOSED" | "INVALID_RANGE"; message: string };

/**
 * 담당 관계를 종료한다(종료일 기록).
 *
 * ★삭제를 기본 동작으로 쓰지 않는다 — 이력을 보존해야 과거 기간 문서의 접근권 판정이
 *  그때 기준으로 재현된다.
 *
 * ★종료일은 시작일 이후여야 한다. 검증 없이 저장하면 `endDate < startDate`인 뒤집힌 구간이 생기고,
 *  그 행은 어떤 날짜와도 겹치지 않아 접근권 판정에서 조용히 사라진다(중복 검사도 통과해 버린다).
 */
export async function closeTraineeSupervision(
  id: bigint,
  endDate: Date,
): Promise<CloseSupervisionResult> {
  const row = await prisma.traineeSupervision.findUnique({
    where: { id },
    select: { startDate: true, endDate: true },
  });
  if (!row) return { ok: false, code: "NOT_FOUND", message: "담당 관계를 찾을 수 없습니다." };
  if (row.endDate != null) {
    return { ok: false, code: "ALREADY_CLOSED", message: "이미 종료된 담당 관계입니다." };
  }
  if (toKstDay(endDate, NaN) < toKstDay(row.startDate, NaN)) {
    return { ok: false, code: "INVALID_RANGE", message: "종료일이 담당 시작일보다 이릅니다." };
  }

  // ★원자적 CAS — 조회 후 비교 사이에 다른 요청이 먼저 종료했을 수 있다.
  //  `endDate: null` 조건을 쓰기 구문에 실어 count===0이면 경합에서 진 것으로 본다.
  const r = await prisma.traineeSupervision.updateMany({
    where: { id, endDate: null },
    data: { endDate },
  });
  if (r.count === 0) {
    return { ok: false, code: "ALREADY_CLOSED", message: "이미 종료된 담당 관계입니다." };
  }
  return { ok: true };
}
