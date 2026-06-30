// app/api/admin/attendance-inbox/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { getKstDateString } from "@/lib/time";
import { getConfigNumber } from "@/lib/systemConfig";
import { isPayrollPending, lateMinutes, earlyLeaveMinutes, SERIOUS_LATE_MIN } from "@/lib/attendance/payrollGate";
// 근태 이슈 도출은 대시보드와 공용(lib/attendance/issueDerivation)으로 통일
import { deriveAttendanceIssues, expectedStartHHMM } from "@/lib/attendance/issueDerivation";

// 타임라인 이벤트(AttendanceIssueEvent.type) → 한글 라벨
const EVENT_LABEL: Record<string, string> = {
  ISSUE_CREATED:        "이슈 등록",
  REASON_REQUESTED:     "담당자 사유 등록 요청",
  REASON_REPLIED:       "직무지도원 사유 회신",
  SUPPLEMENT_REQUESTED: "담당자 보완 요청",
  RESOLVED:             "담당자 처리 완료",
  MEMO_UPDATED:         "운영 메모 갱신",
};

type IssueType = "OUT_OF_RANGE" | "TIME_ANOMALY" | "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
type InboxStatus =
  | "ADMIN_UNCONFIRMED"
  | "WORKER_CONFIRM_REQUESTED"
  | "WORKER_REASON_MISSING"
  | "WORKER_REPLIED"
  | "ADMIN_RESOLVED";

function mapIssueStatusToInboxStatus(issue: {
  status: "OPEN" | "REQUESTED" | "REPLIED" | "RESOLVED";
  workerReasonText: string | null;
}): InboxStatus {
  if (issue.status === "RESOLVED") return "ADMIN_RESOLVED";
  if (issue.status === "REPLIED") return "WORKER_REPLIED";
  if (issue.status === "REQUESTED") {
    return issue.workerReasonText ? "WORKER_CONFIRM_REQUESTED" : "WORKER_REASON_MISSING";
  }
  return "ADMIN_UNCONFIRMED";
}

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);
    const lateThresholdMin = await getConfigNumber("LATE_THRESHOLD_MIN");
    const today = getKstDateString();

    // 소속 기관만 조회
    const agencyId = scope.agencyId;
    // 지각 인정 기준 폴백(위탁기관 기본값). 현장에 별도 설정 있으면 그 값 우선.
    const agencyRow: any = agencyId ? await prisma.agency.findUnique({ where: { id: agencyId }, select: { lateThresholdMin: true } as any }) : null;
    const agencyLateThreshold: number = agencyRow?.lateThresholdMin ?? 30;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    // 이슈 필터 — 복수 선택(issues=A,B,C). 구버전 단일 param(issue=) 하위호환.
    const issuesParam = (searchParams.get("issues") ?? "").trim();
    const legacyIssue = (searchParams.get("issue") ?? "").trim().toUpperCase();
    const issueFilter: string[] = issuesParam
      ? issuesParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : (legacyIssue && legacyIssue !== "ALL" ? [legacyIssue] : []);
    const statusesParam = (searchParams.get("statuses") ?? "").trim();

    const statuses: InboxStatus[] = statusesParam
      ? (statusesParam.split(",").map((s) => s.trim()).filter(Boolean) as InboxStatus[])
      : [];

    // ✅ agencyId 필터는 assignment 기준으로 (Site에 agencyId 없을 수 있음)
    const where: any = agencyId ? { assignment: { agencyId } } : {};

    if (from || to) {
      where.workDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    if (q) {
      where.OR = [
        { user: { workerName: { contains: q } } },
        { site: { companyName: { contains: q } } },
      ];
    }

    const rows = await prisma.dailyAttendance.findMany({
      where,
      take: 300,
      orderBy: [{ workDate: "desc" }, { id: "desc" }],
      select: {
        id: true,
        workDate: true,
        status: true,
        isFinalClosed: true,
        startTime: true,
        endTime: true,
        actualStartTime: true,
        actualEndTime: true,
        payrollConfirmedAt: true,
        correctionRequestedAt: true,
        rangeM: true,
        startDistanceM: true,
        endDistanceM: true,
        user: { select: { id: true, workerName: true } },
        site: { select: { id: true, companyName: true, lateThresholdMin: true } },
        // 직무지도원이 제출한 수정요청 중 승인 대기(PENDING)가 있으면 보정요청 대신 '검토' 유도(중복 요청 방지).
        editRequests: { where: { status: "PENDING" }, select: { id: true }, take: 1 },
        // ✅ workType은 Site가 아닌 SiteAssignment에 있음
        assignment: {
          select: {
            id: true,
            workType: true,
            commuteGuidanceIncluded: true,
            customWorkStart: true,
            customWorkEnd: true,
            attendanceButtonExempt: true,
          },
        },
        attendanceIssue: {
          select: {
            status: true,
            issueTypes: true,
            workerReasonText: true,
            adminMemo: true,
            updatedAt: true,
            createdAt: true,
          },
        },
      },
    });

    // ── 성능: 행별 순차 DB 조회/쓰기(N+1) 제거 ──
    //  1) 면제 제외 + 이슈 있는 행만 후보 수집(행별 컨텍스트 1회 계산)
    //  2) 기존 이슈 일괄 findMany(1쿼리)  3) 신규만 create / 변경된 OPEN만 update(불필요 쓰기 스킵)
    const issueSelect = { dailyAttendanceId: true, status: true, issueTypes: true, workerReasonText: true, adminMemo: true, updatedAt: true, createdAt: true,
      events: { select: { id: true, type: true, message: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 50 },
    } as const;

    type Cand = {
      r: (typeof rows)[number]; derived: IssueType[];
      workType: string | null; commuteGuidanceIncluded: boolean;
      customWorkStart: string | null; customWorkEnd: string | null; expectedStartAt: string | null;
    };
    const candidates: Cand[] = [];
    for (const r of rows) {
      if (r.assignment?.attendanceButtonExempt) continue;
      const workType = r.assignment?.workType ?? null;
      const commuteGuidanceIncluded = r.assignment?.commuteGuidanceIncluded ?? true;
      const customWorkStart = r.assignment?.customWorkStart ?? null;
      const customWorkEnd = r.assignment?.customWorkEnd ?? null;
      const derived = deriveAttendanceIssues({
        startTime: r.startTime, endTime: r.endTime, actualStartTime: r.actualStartTime ?? null,
        startDistanceM: r.startDistanceM ?? null, rangeM: r.rangeM ?? null,
        workType, commuteGuidanceIncluded, customWorkStart, customWorkEnd,
        status: r.status, workDate: r.workDate,
      }, { lateThresholdMin, todayStr: today });
      if (derived.length === 0) continue;
      const expectedStartAt = expectedStartHHMM({ workType, commuteGuidanceIncluded, customWorkStart, customWorkEnd });
      candidates.push({ r, derived, workType, commuteGuidanceIncluded, customWorkStart, customWorkEnd, expectedStartAt });
    }

    // 2) 기존 이슈 일괄 조회
    const existingRows = candidates.length
      ? await prisma.attendanceIssue.findMany({ where: { dailyAttendanceId: { in: candidates.map(c => c.r.id) } }, select: issueSelect })
      : [];
    const issueMap = new Map<string, any>(existingRows.map(e => [e.dailyAttendanceId.toString(), e]));

    // 3) 신규 생성 / 변경된 OPEN 갱신만(병렬). 동일 issueTypes면 쓰기 스킵 → 반복 로딩 빨라짐.
    const sameTypes = (a: any[], b: any[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
    await Promise.all(candidates.map(async (c) => {
      const key = c.r.id.toString();
      const ex = issueMap.get(key);
      if (!ex) {
        try {
          const created = await prisma.attendanceIssue.create({
            data: {
              dailyAttendanceId: c.r.id, issueTypes: c.derived as any,
              events: { create: [{ type: "ISSUE_CREATED", actorRole: "MANAGER", actorManagerId: scope.managerId, message: `이슈 등록: ${c.derived.join(", ")}` }] },
            },
            select: issueSelect,
          });
          issueMap.set(key, created);
        } catch (e: any) {
          if (e?.code === "P2002") {
            const re = await prisma.attendanceIssue.findUnique({ where: { dailyAttendanceId: c.r.id }, select: issueSelect });
            if (re) issueMap.set(key, re);
          } else throw e;
        }
      } else if (ex.status === "OPEN" && !sameTypes(ex.issueTypes as any[], c.derived)) {
        const upd = await prisma.attendanceIssue.update({ where: { dailyAttendanceId: c.r.id }, data: { issueTypes: c.derived as any }, select: issueSelect });
        issueMap.set(key, upd);
      }
    }));

    // 4) 필터 + 게이트 + items 구성
    const items: any[] = [];
    for (const c of candidates) {
      const r = c.r;
      const { workType, commuteGuidanceIncluded, customWorkStart, customWorkEnd, expectedStartAt } = c;
      const upserted = issueMap.get(r.id.toString());
      if (!upserted) continue;

      const inboxStatus = mapIssueStatusToInboxStatus({
        status: upserted.status as any,
        workerReasonText: upserted.workerReasonText,
      });

      if (statuses.length > 0 && !statuses.includes(inboxStatus)) continue;
      // 복수 이슈 필터 — 선택한 유형 중 하나라도 포함하면 통과(OR)
      if (issueFilter.length > 0 && !issueFilter.some((t) => (upserted.issueTypes as any[]).includes(t))) continue;

      // 급여 보호 게이트: 심한지각(30분+) 미컨펌일 = 출근부 '보정대기'(급여 산정 보류)
      const gateInput = {
        actualStartTime: r.actualStartTime ?? null,
        actualEndTime: r.actualEndTime ?? null,
        payrollConfirmedAt: r.payrollConfirmedAt ?? null,
        workType,
        commuteGuidanceIncluded,
        customWorkStart,
        customWorkEnd,
        exempt: r.assignment?.attendanceButtonExempt ?? false,
      };
      const lateMin = lateMinutes(gateInput);
      const earlyMin = earlyLeaveMinutes(gateInput);
      // 이 건의 지각 기준 = 현장값 ?? 위탁기관 기본값.
      const itemThreshold: number = (r.site as any)?.lateThresholdMin ?? agencyLateThreshold;

      items.push({
        id: r.id.toString(),
        workerName: r.user?.workerName ?? "-",
        siteName: r.site?.companyName ?? "-",
        workDate: r.workDate,
        issueTypes: (upserted.issueTypes as any) as IssueType[],
        status: inboxStatus,
        workType,
        expectedStartAt,
        clockInAt: r.startTime ? r.startTime.toISOString() : null,
        clockOutAt: r.endTime ? r.endTime.toISOString() : null,
        // 실제 출퇴근 버튼 시각(지각 판정 근거). 위 clockIn/OutAt은 출근부 고정시각.
        actualClockInAt: r.actualStartTime ? r.actualStartTime.toISOString() : null,
        actualClockOutAt: r.actualEndTime ? r.actualEndTime.toISOString() : null,
        rangeM: r.rangeM ?? null,
        startDistanceM: r.startDistanceM ?? null,
        endDistanceM: r.endDistanceM ?? null,
        workerReasonText: upserted.workerReasonText ?? null,
        adminMemo: upserted.adminMemo ?? null,
        // 급여 보호 게이트
        lateMinutes: lateMin,
        earlyLeaveMinutes: earlyMin,
        payrollPending: isPayrollPending(gateInput, itemThreshold),
        hasPendingEdit: (r.editRequests?.length ?? 0) > 0,
        payrollConfirmedAt: r.payrollConfirmedAt ? r.payrollConfirmedAt.toISOString() : null,
        correctionRequestedAt: r.correctionRequestedAt ? r.correctionRequestedAt.toISOString() : null,
        // 퇴근 미실행(보정대기): 과거 날짜 + 아직 WORKING(퇴근 안 누름) + 미확정.
        // 직무지도원이 끝내 처리 안 하면 매니저가 표준시각으로 확정 가능.
        missedClockOut: r.status === "WORKING" && r.workDate < today && !r.isFinalClosed,
        seriousLateMin: itemThreshold,
        updatedAt: (upserted.updatedAt ?? upserted.createdAt).toISOString(),
        timeline: (((upserted as any).events ?? []) as any[]).map((e) => ({
          id: e.id.toString(),
          at: e.createdAt.toISOString(),
          type: e.type,
          label: EVENT_LABEL[e.type] ?? e.type,
          detail: e.message ?? null,
        })),
      });
    }

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_ATTENDANCE_INBOX_GET_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}