// app/api/admin/attendance-inbox/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

type IssueType = "OUT_OF_RANGE" | "TIME_ANOMALY" | "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
type InboxStatus =
  | "ADMIN_UNCONFIRMED"
  | "WORKER_CONFIRM_REQUESTED"
  | "WORKER_REASON_MISSING"
  | "WORKER_REPLIED"
  | "ADMIN_RESOLVED";

function getWorkTypeDefaultExpectedStartMin(workType: string | null | undefined): number | null {
  if (!workType) return null;
  const t = workType.toUpperCase();
  if (t === "PM") return 13 * 60;
  if (t === "AM" || t === "FULL_DAY") return 9 * 60;
  return null;
}

function isoToLocalMin(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

function deriveIssueTypes(row: {
  startTime: Date | null;
  endTime: Date | null;
  startDistanceM: number | null;
  rangeM: number | null;
  workType: string | null;
}): IssueType[] {
  const out: IssueType[] = [];

  if (!row.startTime) out.push("MISSING_CLOCK_IN");
  if (!row.endTime) out.push("MISSING_CLOCK_OUT");

  if (row.startDistanceM != null && row.rangeM != null && row.startDistanceM > row.rangeM) {
    out.push("OUT_OF_RANGE");
  }

  const expectedStartMin = getWorkTypeDefaultExpectedStartMin(row.workType);
  const actualStartMin = row.startTime ? isoToLocalMin(row.startTime.toISOString()) : null;
  if (expectedStartMin != null && actualStartMin != null) {
    const diff = actualStartMin - expectedStartMin;
    if (diff >= 1 || diff <= -60) out.push("TIME_ANOMALY");
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
        rangeM: true,
        startDistanceM: true,
        endDistanceM: true,
        user: { select: { id: true, workerName: true } },
        site: { select: { id: true, companyName: true } },
        // ✅ workType은 Site가 아닌 SiteAssignment에 있음
        assignment: { select: { id: true, workType: true } },
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
      const workType = r.assignment?.workType ?? null;

      const derived = deriveIssueTypes({
        startTime: r.startTime,
        endTime: r.endTime,
        startDistanceM: r.startDistanceM ?? null,
        rangeM: r.rangeM ?? null,
        workType,
      });

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

      items.push({
        id: r.id.toString(),
        workerName: r.user?.workerName ?? "-",
        siteName: r.site?.companyName ?? "-",
        workDate: r.workDate,
        issueTypes: (upserted.issueTypes as any) as IssueType[],
        status: inboxStatus,
        workType,
        expectedStartAt: null,
        clockInAt: r.startTime ? r.startTime.toISOString() : null,
        clockOutAt: r.endTime ? r.endTime.toISOString() : null,
        rangeM: r.rangeM ?? null,
        startDistanceM: r.startDistanceM ?? null,
        endDistanceM: r.endDistanceM ?? null,
        workerReasonText: upserted.workerReasonText ?? null,
        adminMemo: upserted.adminMemo ?? null,
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