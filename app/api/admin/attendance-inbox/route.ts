// app/api/admin/attendance-inbox/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

type IssueType = "OUT_OF_RANGE" | "TIME_ANOMALY" | "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
type InboxStatus =
  | "ADMIN_UNCONFIRMED"
  | "COACH_CONFIRM_REQUESTED"
  | "COACH_REASON_MISSING"
  | "COACH_REPLIED"
  | "ADMIN_RESOLVED";

function getWorkTypeDefaultExpectedStartMin(workType: string | null | undefined): number | null {
  if (!workType) return null;
  const t = workType.toUpperCase();
  if (t === "PM") return 13 * 60;
  if (t === "AM") return 9 * 60;
  if (t === "FULL") return 9 * 60;
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
  coachReasonText: string | null;
}): InboxStatus {
  if (issue.status === "RESOLVED") return "ADMIN_RESOLVED";
  if (issue.status === "REPLIED") return "COACH_REPLIED";
  if (issue.status === "REQUESTED") {
    return issue.coachReasonText ? "COACH_CONFIRM_REQUESTED" : "COACH_REASON_MISSING";
  }
  return "ADMIN_UNCONFIRMED";
}

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);

    // ✅ ADMIN은 전체 조회, AGENCY는 소속 기관만 조회
    let agencyId: bigint | null = null;
    if (scope.role === "AGENCY") {
      if (!scope.agencyId) {
        return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
      }
      agencyId = scope.agencyId;
    }
    // ADMIN 롤은 agencyId = null → 전체 조회

    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") ?? "").trim();
    const from = searchParams.get("from"); // YYYY-MM-DD
    const to = searchParams.get("to"); // YYYY-MM-DD
    const issue = (searchParams.get("issue") ?? "ALL").toUpperCase(); // ALL | OUT_OF_RANGE ...
    const statusesParam = (searchParams.get("statuses") ?? "").trim(); // comma-separated

    const statuses: InboxStatus[] = statusesParam
      ? (statusesParam.split(",").map((s) => s.trim()).filter(Boolean) as InboxStatus[])
      : [];

    const where: any = agencyId ? { site: { agencyId } } : {};

    if (from || to) {
      where.workDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    if (q) {
      // ✅ 괄호 오류 수정(컴파일 에러 원인)
      where.OR = [
        { user: { userName: { contains: q } } },
        { site: { companyName: { contains: q } } },
      ];
    }

    // ✅ 클라이언트가 10개 단위 페이징(slice)하므로, 서버 skip/take는 적용하지 않음(충돌 방지)
    const rows = await prisma.dailyAttendance.findMany({
      where,
      orderBy: [{ workDate: "desc" }, { id: "desc" }],
      select: {
        id: true,
        workDate: true,
        startTime: true,
        endTime: true,
        rangeM: true,
        startDistanceM: true,
        endDistanceM: true,
        user: { select: { id: true, userName: true } },
        site: { select: { id: true, companyName: true, workType: true } },
        issue: {
          select: {
            status: true,
            issueTypes: true,
            coachReasonText: true,
            adminMemo: true,
            updatedAt: true,
            createdAt: true,
          },
        },
      },
    });

    const items: any[] = [];

    for (const r of rows) {
      const derived = deriveIssueTypes({
        startTime: r.startTime,
        endTime: r.endTime,
        startDistanceM: r.startDistanceM ?? null,
        rangeM: r.rangeM ?? null,
        workType: r.site.workType ?? null,
      });

      // 이슈 없는 날 제외
      if (derived.length === 0) continue;

      const upserted = await prisma.attendanceIssue.upsert({
        where: { dailyAttendanceId: r.id },
        create: {
          dailyAttendanceId: r.id,
          issueTypes: derived as any,
          events: {
            create: [
              {
                type: "ISSUE_CREATED",
                actorRole: "ADMIN",
                actorUserId: scope.userId,
                message: `이슈 등록: ${derived.join(", ")}`,
              },
            ],
          },
        },
        update: {
          // ✅ OPEN 상태일 때만 자동 동기화(운영상 안전)
          ...(r.issue?.status === "OPEN" ? { issueTypes: derived as any } : {}),
        },
        select: {
          status: true,
          issueTypes: true,
          coachReasonText: true,
          adminMemo: true,
          updatedAt: true,
          createdAt: true,
        },
      });

      const inboxStatus = mapIssueStatusToInboxStatus({
        status: upserted.status as any,
        coachReasonText: upserted.coachReasonText,
      });

      if (statuses.length > 0 && !statuses.includes(inboxStatus)) continue;
      if (issue !== "ALL" && !upserted.issueTypes.includes(issue as any)) continue;

      items.push({
        id: r.id.toString(),
        coachName: r.user.userName ?? "-",
        siteName: r.site.companyName ?? "-",
        workDate: r.workDate,

        issueTypes: (upserted.issueTypes as any) as IssueType[],
        status: inboxStatus,

        workType: r.site.workType ?? null,
        expectedStartAt: null,

        clockInAt: r.startTime ? r.startTime.toISOString() : null,
        clockOutAt: r.endTime ? r.endTime.toISOString() : null,

        rangeM: r.rangeM ?? null,
        startDistanceM: r.startDistanceM ?? null,
        endDistanceM: r.endDistanceM ?? null,

        coachReasonText: upserted.coachReasonText ?? null,
        adminMemo: upserted.adminMemo ?? null,
        updatedAt: (upserted.updatedAt ?? upserted.createdAt).toISOString(),

        timeline: [], // 상세 조회 API로 분리 권장
      });
    }

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_ATTENDANCE_INBOX_GET_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
