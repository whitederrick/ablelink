// lib/pilot/workday.ts
// 파일럿 회차 근무일 확인·정정 — v1.8 §10, §12 8단계.
//
// ★왜 별도 경로인가
//  파일럿에는 위탁기관 담당자가 없다. 평소라면 근태 정정은 직무지도원이 요청하고 매니저가
//  승인하는 경로(AttendanceIssue·AttendanceEditRequest)를 타는데, 승인할 사람이 없어서
//  그 경로가 끝까지 안 간다. 그래서 운영자가 파일럿 관리 화면에서 직접 확인·정정한다.
//
// ★기존 근태 경로는 한 줄도 건드리지 않는다.
//  워커의 출퇴근 버튼·일괄생성(worker/attendance/**)은 그대로다. 여기 있는 함수들은
//  **pilotSessionId가 박힌 배정**만 대상으로 하고, 그 외 배정은 NOT_FOUND로 거부한다.
//  (파일럿 화면이 실수로 운영 근태를 고치는 일이 구조적으로 불가능해야 한다.)

import { prisma } from "@/lib/prisma";
import { getKstDateString, isValidYmd } from "@/lib/time";
import { computeWorkTimes, kstWallTimeToInstant } from "@/lib/workSchedule";
import type { Prisma } from "@prisma/client";

export type WorkdayFailure =
  | "NOT_FOUND"
  | "NOT_PILOT"          // 파일럿 배정이 아니다 — 운영 근태는 이 경로로 못 고친다
  | "SESSION_NOT_ACTIVE"
  | "INVALID_DATE"
  | "FUTURE_DATE"        // §10: 미래 근무일은 사전 생성하지 않는다
  | "OUT_OF_RANGE"       // 회차 ∩ 배정 기간 밖
  | "DUPLICATE"
  | "HAS_LINKED_LOGS";   // §10: 일지가 붙은 근무일 — 확인 없이 지우지 않는다

export type WorkdayResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: WorkdayFailure; message: string; status: number };

class Abort extends Error {
  constructor(readonly status: number, readonly reason: WorkdayFailure, readonly detail: string) { super(reason); }
}
function fail(status: number, reason: WorkdayFailure, detail: string): never {
  throw new Abort(status, reason, detail);
}
async function run<T>(fn: () => Promise<T>): Promise<WorkdayResult<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (e) {
    if (e instanceof Abort) return { ok: false, code: e.reason, message: e.detail, status: e.status };
    throw e;
  }
}

/** 시각 문자열 "HH:MM" 검사. */
function isHhMm(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

const ASSIGNMENT_SELECT = {
  id: true, workerId: true, siteId: true, startDate: true, endDate: true,
  workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true,
  pilotSessionId: true,
  pilotSession: { select: { id: true, status: true, startDate: true, endDate: true } },
} satisfies Prisma.SiteAssignmentSelect;

/**
 * 파일럿 배정인지 확인하고 회차·배정 기간을 함께 돌려준다.
 *
 * ★쓰기 경로는 전부 이 함수를 먼저 통과한다. `pilotSessionId`가 없으면 여기서 끝난다 —
 *  운영 배정의 근태가 이 경로로 수정될 길을 하나만 남겨 두고 그 하나를 막는다.
 */
async function loadPilotAssignment(assignmentId: bigint, pilotSessionId: bigint, requireActive: boolean) {
  const a = await prisma.siteAssignment.findUnique({ where: { id: assignmentId }, select: ASSIGNMENT_SELECT });
  if (!a) fail(404, "NOT_FOUND", "배정을 찾을 수 없습니다.");
  if (!a.pilotSessionId || a.pilotSessionId !== pilotSessionId) {
    fail(404, "NOT_PILOT", "이 회차의 파일럿 배정이 아닙니다.");
  }
  if (requireActive && a.pilotSession?.status !== "ACTIVE") {
    fail(409, "SESSION_NOT_ACTIVE", "진행 중(ACTIVE)인 회차에서만 근무일을 정정할 수 있습니다.");
  }
  return a;
}

/** 회차 ∩ 배정 기간 안의 날짜인지. 둘 다 만족해야 문서 기간과 어긋나지 않는다. */
function assertInRange(a: { startDate: Date | null; endDate: Date | null; pilotSession: { startDate: Date; endDate: Date } | null }, date: string): void {
  const bounds: [string | null, string | null][] = [
    [a.startDate ? getKstDateString(a.startDate) : null, a.endDate ? getKstDateString(a.endDate) : null],
    [a.pilotSession ? getKstDateString(a.pilotSession.startDate) : null, a.pilotSession ? getKstDateString(a.pilotSession.endDate) : null],
  ];
  for (const [from, to] of bounds) {
    if ((from && date < from) || (to && date > to)) {
      fail(400, "OUT_OF_RANGE", "회차 기간과 배정 기간 안의 날짜만 등록할 수 있습니다.");
    }
  }
}

export interface WorkdayRow {
  id: string;
  assignmentId: string;
  workDate: string;
  start: string | null;
  end: string | null;
  /** 이 근무일에 붙은 일지 수 — 삭제 시 함께 사라지므로 화면에 반드시 보여준다. */
  linkedLogs: number;
}

/** 회차의 근무일 목록(배정별). 조회는 회차 상태와 무관하게 허용한다. */
export async function listPilotWorkdays(pilotSessionId: bigint): Promise<WorkdayRow[]> {
  const assignments = await prisma.siteAssignment.findMany({
    where: { pilotSessionId },
    select: { id: true },
  });
  if (assignments.length === 0) return [];

  const rows = await prisma.dailyAttendance.findMany({
    where: { assignmentId: { in: assignments.map(a => a.id) } },
    select: {
      id: true, assignmentId: true, workDate: true, startTime: true, endTime: true,
      _count: { select: { logs: true } },
    },
    orderBy: [{ assignmentId: "asc" }, { workDate: "asc" }],
  });

  return rows.map(r => ({
    id: r.id.toString(),
    assignmentId: r.assignmentId.toString(),
    workDate: r.workDate,
    start: r.startTime ? kstHhMm(r.startTime) : null,
    end: r.endTime ? kstHhMm(r.endTime) : null,
    linkedLogs: r._count.logs,
  }));
}

/** UTC Date → KST "HH:MM". */
function kstHhMm(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}

export interface CreateWorkdayInput {
  pilotSessionId: bigint;
  assignmentId: bigint;
  workDate: string;
  start?: string | null;
  end?: string | null;
}

/** 근무일 1건 생성. 시각을 안 주면 근무형태 표준 시각을 쓴다(일괄생성과 같은 규칙). */
export async function createPilotWorkday(input: CreateWorkdayInput): Promise<WorkdayResult<{ id: string }>> {
  return run(async () => {
    if (!isValidYmd(input.workDate)) fail(400, "INVALID_DATE", "날짜를 YYYY-MM-DD 형식으로 입력해주세요.");
    // ★미래 금지(§10) — 아직 오지 않은 날의 근무를 미리 만들면 그대로 문서·급여에 들어간다.
    if (input.workDate > getKstDateString()) fail(400, "FUTURE_DATE", "미래 날짜의 근무일은 만들 수 없습니다.");

    const a = await loadPilotAssignment(input.assignmentId, input.pilotSessionId, true);
    assertInRange(a, input.workDate);

    const times = computeWorkTimes(a.workType, a.commuteGuidanceIncluded, a.customWorkStart, a.customWorkEnd);
    const startHhMm = input.start != null && input.start !== "" ? input.start : times.start;
    const endHhMm = input.end != null && input.end !== "" ? input.end : times.end;
    if (!isHhMm(startHhMm) || !isHhMm(endHhMm)) fail(400, "INVALID_DATE", "시각을 HH:MM 형식으로 입력해주세요.");
    if (startHhMm >= endHhMm) fail(400, "INVALID_DATE", "퇴근 시각이 출근 시각보다 빨라야 할 수 없습니다.");

    try {
      const created = await prisma.dailyAttendance.create({
        data: {
          workerId: a.workerId, siteId: a.siteId, assignmentId: a.id, workDate: input.workDate,
          startTime: kstWallTimeToInstant(input.workDate, startHhMm),
          endTime: kstWallTimeToInstant(input.workDate, endHhMm),
          status: "DONE",
        },
        select: { id: true },
      });
      return { id: created.id.toString() };
    } catch (e) {
      // ★(assignment_id, work_date) unique — 동시 등록의 패자는 500이 아니라 409를 받아야 한다.
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        fail(409, "DUPLICATE", "이미 등록된 근무일입니다.");
      }
      throw e;
    }
  });
}

export interface UpdateWorkdayInput {
  pilotSessionId: bigint;
  attendanceId: bigint;
  start: string;
  end: string;
}

/** 근무일 시각 정정. */
export async function updatePilotWorkday(input: UpdateWorkdayInput): Promise<WorkdayResult<{ id: string }>> {
  return run(async () => {
    if (!isHhMm(input.start) || !isHhMm(input.end)) fail(400, "INVALID_DATE", "시각을 HH:MM 형식으로 입력해주세요.");
    if (input.start >= input.end) fail(400, "INVALID_DATE", "퇴근 시각이 출근 시각보다 빨라야 할 수 없습니다.");

    const row = await prisma.dailyAttendance.findUnique({
      where: { id: input.attendanceId },
      select: { id: true, workDate: true, assignmentId: true },
    });
    if (!row) fail(404, "NOT_FOUND", "근무일을 찾을 수 없습니다.");
    await loadPilotAssignment(row.assignmentId, input.pilotSessionId, true);

    await prisma.dailyAttendance.update({
      where: { id: row.id },
      data: {
        startTime: kstWallTimeToInstant(row.workDate, input.start),
        endTime: kstWallTimeToInstant(row.workDate, input.end),
      },
    });
    return { id: row.id.toString() };
  });
}

export interface DeleteWorkdayInput {
  pilotSessionId: bigint;
  attendanceId: bigint;
  /** 일지가 붙어 있어도 지울지 — 화면에서 건수를 보여준 뒤 명시적으로 받는다(§10). */
  force?: boolean;
}

/**
 * 근무일 삭제.
 *
 * ★`TraineeLog.attendanceId`는 onDelete Cascade다. 근무일을 지우면 **일지가 조용히 같이 사라진다.**
 *  그래서 기본은 차단하고, 몇 건이 함께 지워지는지 알려준 뒤 force로만 진행한다.
 */
export async function deletePilotWorkday(input: DeleteWorkdayInput): Promise<WorkdayResult<{ deletedLogs: number }>> {
  return run(async () => {
    const row = await prisma.dailyAttendance.findUnique({
      where: { id: input.attendanceId },
      select: { id: true, assignmentId: true, _count: { select: { logs: true } } },
    });
    if (!row) fail(404, "NOT_FOUND", "근무일을 찾을 수 없습니다.");
    await loadPilotAssignment(row.assignmentId, input.pilotSessionId, true);

    const linked = row._count.logs;
    if (linked > 0 && !input.force) {
      fail(409, "HAS_LINKED_LOGS", `이 근무일에 작성된 일지 ${linked}건이 함께 삭제됩니다. 확인 후 다시 시도해주세요.`);
    }

    await prisma.dailyAttendance.delete({ where: { id: row.id } });
    return { deletedLogs: linked };
  });
}
