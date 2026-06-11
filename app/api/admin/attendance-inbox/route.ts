// app/api/admin/attendance-inbox/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { computeWorkTimes } from "@/lib/workSchedule";
import { getConfigNumber } from "@/lib/systemConfig";
import { isPayrollPending, lateMinutes, SERIOUS_LATE_MIN } from "@/lib/attendance/payrollGate";

type IssueType = "OUT_OF_RANGE" | "TIME_ANOMALY" | "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
type InboxStatus =
  | "ADMIN_UNCONFIRMED"
  | "WORKER_CONFIRM_REQUESTED"
  | "WORKER_REASON_MISSING"
  | "WORKER_REPLIED"
  | "ADMIN_RESOLVED";

function hhmmToMin(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 근무형태별 표준 출근시각(HH:MM) — 단일 출처(lib/workSchedule)에서 계산
function getExpectedStartHHMM(row: {
  workType: string | null;
  commuteGuidanceIncluded: boolean | null;
  customWorkStart: string | null;
  customWorkEnd: string | null;
}): string | null {
  if (!row.workType) return null;
  return computeWorkTimes(
    row.workType,
    row.commuteGuidanceIncluded ?? true,
    row.customWorkStart,
    row.customWorkEnd,
  ).start;
}

// 저장된 instant(UTC) → KST 벽시계 분(0~1439). 서버가 UTC 이므로 +9h 후 UTC 필드로 환산.
function instantToKstMin(d: Date | null | undefined): number | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

// 지각 판정 임계(분): 실제 출근이 표준보다 이만큼 이상 늦으면 이상 표시(운영자 설정값, 기본 15)
function deriveIssueTypes(row: {
  startTime: Date | null;
  endTime: Date | null;
  actualStartTime: Date | null;
  startDistanceM: number | null;
  rangeM: number | null;
  workType: string | null;
  commuteGuidanceIncluded: boolean | null;
  customWorkStart: string | null;
  customWorkEnd: string | null;
}, lateThresholdMin: number): IssueType[] {
  const out: IssueType[] = [];

  if (!row.startTime) out.push("MISSING_CLOCK_IN");
  if (!row.endTime) out.push("MISSING_CLOCK_OUT");

  if (row.startDistanceM != null && row.rangeM != null && row.startDistanceM > row.rangeM) {
    out.push("OUT_OF_RANGE");
  }

  // ✅ 지각 판정은 출근부 고정시각이 아니라 "실제 출근 버튼 시각" 기준.
  //    실제 시각이 없으면(과거 기록·기간 일괄생성 등) 판정하지 않음 → 오탐 방지.
  const expectedStartMin = hhmmToMin(getExpectedStartHHMM(row));
  const actualStartMin = instantToKstMin(row.actualStartTime);
  if (expectedStartMin != null && actualStartMin != null && actualStartMin - expectedStartMin >= lateThresholdMin) {
    out.push("TIME_ANOMALY");
  }

  return out;
}

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

    // 소속 기관만 조회
    const agencyId = scope.agencyId;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const issue = (searchParams.get("issue") ?? "ALL").toUpperCase();
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
        startTime: true,
        endTime: true,
        actualStartTime: true,
        actualEndTime: true,
        payrollConfirmedAt: true,
        rangeM: true,
        startDistanceM: true,
        endDistanceM: true,
        user: { select: { id: true, workerName: true } },
        site: { select: { id: true, companyName: true } },
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

    const items: any[] = [];

    for (const r of rows) {
      // 출퇴근 버튼 면제 배정 → 실제 버튼시각 무시(지각·범위 등 근태 이슈 미발생)
      if (r.assignment?.attendanceButtonExempt) continue;
      const workType = r.assignment?.workType ?? null;
      const commuteGuidanceIncluded = r.assignment?.commuteGuidanceIncluded ?? true;
      const customWorkStart = r.assignment?.customWorkStart ?? null;
      const customWorkEnd = r.assignment?.customWorkEnd ?? null;
      const expectedStartAt = getExpectedStartHHMM({
        workType,
        commuteGuidanceIncluded,
        customWorkStart,
        customWorkEnd,
      });

      const derived = deriveIssueTypes({
        startTime: r.startTime,
        endTime: r.endTime,
        actualStartTime: r.actualStartTime ?? null,
        startDistanceM: r.startDistanceM ?? null,
        rangeM: r.rangeM ?? null,
        workType,
        commuteGuidanceIncluded,
        customWorkStart,
        customWorkEnd,
      }, lateThresholdMin);

      if (derived.length === 0) continue;

      // 기존 이슈 조회 → 없으면 생성 (upsert race condition 방지)
      let existing = await prisma.attendanceIssue.findUnique({
        where: { dailyAttendanceId: r.id },
        select: { status: true, issueTypes: true, workerReasonText: true, adminMemo: true, updatedAt: true, createdAt: true },
      });

      if (!existing) {
        try {
          existing = await prisma.attendanceIssue.create({
            data: {
              dailyAttendanceId: r.id,
              issueTypes: derived as any,
              events: {
                create: [{
                  type: "ISSUE_CREATED",
                  actorRole: "MANAGER",
                  actorManagerId: scope.managerId,
                  message: `이슈 등록: ${derived.join(", ")}`,
                }],
              },
            },
            select: { status: true, issueTypes: true, workerReasonText: true, adminMemo: true, updatedAt: true, createdAt: true },
          });
        } catch (e: any) {
          // 동시 요청으로 이미 생성된 경우 재조회
          if (e?.code === "P2002") {
            existing = await prisma.attendanceIssue.findUnique({
              where: { dailyAttendanceId: r.id },
              select: { status: true, issueTypes: true, workerReasonText: true, adminMemo: true, updatedAt: true, createdAt: true },
            });
          } else {
            throw e;
          }
        }
      } else if (existing.status === "OPEN") {
        existing = await prisma.attendanceIssue.update({
          where: { dailyAttendanceId: r.id },
          data: { issueTypes: derived as any },
          select: { status: true, issueTypes: true, workerReasonText: true, adminMemo: true, updatedAt: true, createdAt: true },
        });
      }

      const upserted = existing;
      if (!upserted) continue;

      const inboxStatus = mapIssueStatusToInboxStatus({
        status: upserted.status as any,
        workerReasonText: upserted.workerReasonText,
      });

      if (statuses.length > 0 && !statuses.includes(inboxStatus)) continue;
      if (issue !== "ALL" && !upserted.issueTypes.includes(issue as any)) continue;

      // 급여 보호 게이트: 심한지각(30분+) 미컨펌일 = 출근부 '보정대기'(급여 산정 보류)
      const gateInput = {
        actualStartTime: r.actualStartTime ?? null,
        payrollConfirmedAt: r.payrollConfirmedAt ?? null,
        workType,
        commuteGuidanceIncluded,
        customWorkStart,
        customWorkEnd,
        exempt: r.assignment?.attendanceButtonExempt ?? false,
      };
      const lateMin = lateMinutes(gateInput);

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
        payrollPending: isPayrollPending(gateInput),
        payrollConfirmedAt: r.payrollConfirmedAt ? r.payrollConfirmedAt.toISOString() : null,
        seriousLateMin: SERIOUS_LATE_MIN,
        updatedAt: (upserted.updatedAt ?? upserted.createdAt).toISOString(),
        timeline: [],
      });
    }

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_ATTENDANCE_INBOX_GET_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}