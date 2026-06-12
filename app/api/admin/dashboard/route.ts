// app/api/admin/dashboard/route.ts
// 관리자 대시보드 — 에이전시 관점 통합 현황 API

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);
    const agencyFilter = { agencyId: scope.agencyId };

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const now = new Date();

    const in5Days = new Date(today); in5Days.setDate(in5Days.getDate() + 5);
    const in10Days = new Date(today); in10Days.setDate(in10Days.getDate() + 10);
    const issueFloor = new Date(today); issueFloor.setDate(issueFloor.getDate() - 45);
    const issueFloorStr = issueFloor.toISOString().slice(0, 10);

    // ── 5개 쿼리 병렬 실행 ────────────────────────────────────────
    const [
      todayAttendances,
      recentAttendances,
      docRunsOpen,
      endingSoonAssignments,
      allActiveSites,
    ] = await Promise.all([
      // 1. 오늘 출근 현황
      prisma.dailyAttendance.findMany({
        where: { workDate: todayStr, assignment: { ...agencyFilter } },
        select: {
          id: true, startTime: true, endTime: true, isFinalClosed: true, isGpsModified: true,
          user: { select: { workerName: true } },
          site: { select: { companyName: true } },
          logs: { select: { isCompleted: true } },
          attendanceIssue: { select: { id: true, status: true, issueTypes: true } },
        },
      }),
      // 2. 미확인 근태 — AttendanceIssue(인박스 열람 시 lazy 생성)에 의존하지 않고
      //    최근 출근기록에서 직접 도출(범위이탈/누락/시간이상). RESOLVED만 제외.
      prisma.dailyAttendance.findMany({
        where: { workDate: { gte: issueFloorStr }, assignment: { ...agencyFilter } },
        take: 400,
        orderBy: { workDate: "desc" },
        select: {
          id: true, workDate: true, startTime: true, endTime: true, status: true,
          startDistanceM: true, rangeM: true,
          user: { select: { workerName: true } },
          site: { select: { companyName: true } },
          assignment: { select: { workType: true } },
          attendanceIssue: { select: { status: true } },
        },
      }),
      // 3. 제출 문서 현황 — 매니저 처리 대기(제출완료/확정/수정요청) 최근 50건
      prisma.documentRun.findMany({
        where: { agencyId: scope.agencyId, signStage: { in: ["SUBMITTED", "CONFIRMED", "CHANGES_REQUESTED"] } },
        take: 50,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true, docType: true, dueAt: true, currentVersionId: true, signStage: true,
          worker: { select: { workerName: true } },
          site: { select: { companyName: true } },
        },
      }),
      // 4. 배정 종료 임박
      prisma.siteAssignment.findMany({
        where: { status: "ACTIVE", endDate: { gte: today, lte: in10Days }, ...agencyFilter },
        select: {
          id: true, endDate: true, serviceStep: true,
          user: { select: { workerName: true } },
          site: { select: { companyName: true } },
        },
        orderBy: { endDate: "asc" },
      }),
      // 5. 미배정 Site
      prisma.site.findMany({
        where: { isActive: true, agencyId: scope.agencyId },
        select: {
          id: true, companyName: true,
          assignments: { where: { status: "ACTIVE" }, select: { id: true } },
        },
      }),
    ]);

    // 최근 출근기록 → 근태 이슈 직접 도출(RESOLVED 제외). 인박스 열람 여부와 무관하게 정확.
    const derivedIssues = recentAttendances
      .map(r => ({ r, types: deriveDashboardIssueTypes(r, todayStr) }))
      .filter(x => x.types.length > 0 && x.r.attendanceIssue?.status !== "RESOLVED")
      .map(x => ({
        id: x.r.id.toString(),
        workerName: x.r.user?.workerName || "-",
        siteName: x.r.site?.companyName || "-",
        workDate: x.r.workDate,
        issueTypes: x.types,
        createdAt: x.r.startTime ? x.r.startTime.toISOString() : new Date(`${x.r.workDate}T00:00:00Z`).toISOString(),
      }));

    const todayWorking = todayAttendances.filter(a => a.startTime && !a.isFinalClosed).length;
    const todayDone = todayAttendances.filter(a => a.isFinalClosed).length;
    const logDoneCount = todayAttendances.filter(a => a.logs.length > 0 && a.logs.every(l => l.isCompleted)).length;
    const logPendingCount = todayAttendances.filter(a => !a.logs.every(l => l.isCompleted) || a.logs.length === 0).length;
    const docPendingSubmit = docRunsOpen.filter(r => r.signStage === "SUBMITTED").length;     // 확정 대기
    const docOverdue = docRunsOpen.filter(r => r.signStage === "CONFIRMED").length;           // 서명 대기
    const endingIn5 = endingSoonAssignments.filter(a => a.endDate && a.endDate <= in5Days).length;
    const unassignedSites = allActiveSites.filter(s => s.assignments.length === 0);

    // ── 6. 운영 리스크 알림 ───────────────────────────────────────
    const riskAlerts: Array<{
      type: string; id?: string; label: string; target: string; detail: string; severity: "high" | "medium" | "low";
    }> = [];

    for (const issue of derivedIssues.slice(0, 15)) {
      const daysAgo = Math.floor((now.getTime() - new Date(`${issue.workDate}T00:00:00Z`).getTime()) / 86400000);
      if (daysAgo >= 3) {
        riskAlerts.push({
          type: "attendance", id: String(issue.id), label: "[근태]",
          target: issue.workerName,
          detail: `${daysAgo}일 경과 미확인 근태 — 『${issue.siteName}』`,
          severity: daysAgo >= 7 ? "high" : "medium",
        });
      }
    }

    for (const r of docRunsOpen.filter(r => r.signStage === "SUBMITTED").slice(0, 8)) {
      riskAlerts.push({
        type: "document", id: String(r.id), label: "[문서]",
        target: r.worker?.workerName || "-",
        detail: `${docTypeLabel(r.docType)} 확정 대기 — 『${r.site?.companyName || ""}』`,
        severity: "medium",
      });
    }

    for (const a of endingSoonAssignments.slice(0, 8)) {
      const daysLeft = a.endDate
        ? Math.ceil((a.endDate.getTime() - today.getTime()) / 86400000)
        : 0;
      riskAlerts.push({
        type: "assignment", id: String(a.id), label: "[배정]",
        target: a.user?.workerName || "-",
        detail: `배정 종료 D-${daysLeft} — 『${a.site?.companyName || ""}』`,
        severity: daysLeft <= 3 ? "high" : "medium",
      });
    }

    for (const s of unassignedSites.slice(0, 3)) {
      riskAlerts.push({
        type: "site", id: String(s.id), label: "[미배정]",
        target: s.companyName,
        detail: "활성 직무지도원 배정 없음",
        severity: "low",
      });
    }

    const severityOrder = { high: 0, medium: 1, low: 2 };
    riskAlerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return NextResponse.json({
      success: true,
      data: {
        today: todayStr,
        summary: {
          todayWorking,
          todayDone,
          logDoneCount,
          logPendingCount,
          unconfirmedCount: derivedIssues.length,
          docPendingSubmit,
          docOverdue,
          endingIn5,
          endingIn10: endingSoonAssignments.length,
          unassignedSiteCount: unassignedSites.length,
          unassignedSiteList: unassignedSites.slice(0, 10).map(s => ({ id: s.id.toString(), companyName: s.companyName })),
        },
        attendanceIssueList: derivedIssues.slice(0, 10),
        docList: docRunsOpen.slice(0, 8).map(r => ({
          id: r.id.toString(),
          docType: r.docType,
          docTypeLabel: docTypeLabel(r.docType),
          workerName: r.worker?.workerName || "-",
          siteName: r.site?.companyName || "-",
          dueAt: r.dueAt.toISOString(),
          isOverdue: r.dueAt <= now,
          hasVersion: !!r.currentVersionId,
          signStage: r.signStage,
        })),
        assignmentAlerts: endingSoonAssignments.slice(0, 8).map(a => ({
          id: a.id.toString(),
          workerName: a.user?.workerName || "-",
          siteName: a.site?.companyName || "-",
          endDate: a.endDate ? a.endDate.toISOString() : null,
          serviceStep: a.serviceStep,
          daysLeft: a.endDate
            ? Math.ceil((a.endDate.getTime() - today.getTime()) / 86400000)
            : null,
        })),
        riskAlerts: riskAlerts.slice(0, 20),
        todayList: todayAttendances.map(a => ({
          id: a.id.toString(),
          workerName: a.user?.workerName || "-",
          siteName: a.site?.companyName || "-",
          clockIn: a.startTime ? formatHHMM(a.startTime) : null,
          clockOut: a.endTime ? formatHHMM(a.endTime) : null,
          isFinalClosed: a.isFinalClosed,
          isGpsModified: a.isGpsModified,
          hasIssue: !!a.attendanceIssue && a.attendanceIssue.status === "OPEN",
          logStatus: a.logs.length === 0 ? "미작성"
            : a.logs.every(l => l.isCompleted) ? "완료" : "임시저장",
        })),
      },
    });
  } catch (error: any) {
    if (error && typeof error.status === "number") return error as any;
    console.error("[admin/dashboard]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// 인박스와 동일 기준으로 출근기록에서 이슈 도출(범위이탈/누락/시간이상).
// 진행 중(오늘 WORKING·미퇴근)은 '퇴근 누락'으로 보지 않음.
function deriveDashboardIssueTypes(
  r: {
    workDate: string; status: string;
    startTime: Date | null; endTime: Date | null;
    startDistanceM: number | null; rangeM: number | null;
    assignment: { workType: string | null } | null;
  },
  todayStr: string,
): string[] {
  const out: string[] = [];
  if (!r.startTime) out.push("MISSING_CLOCK_IN");
  if (!r.endTime && !(r.workDate === todayStr && r.status === "WORKING")) out.push("MISSING_CLOCK_OUT");
  if (r.startDistanceM != null && r.rangeM != null && r.startDistanceM > r.rangeM) out.push("OUT_OF_RANGE");

  const wt = r.assignment?.workType ?? null;
  const exp = wt === "PM" ? 13 * 60 : (wt === "AM" || wt === "FULL_DAY") ? 9 * 60 : null;
  if (exp != null && r.startTime) {
    const kst = new Date(r.startTime.getTime() + 9 * 3600000);
    const actual = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    const diff = actual - exp;
    if (diff >= 1 || diff <= -60) out.push("TIME_ANOMALY");
  }
  return out;
}

function formatHHMM(d: Date) {
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function docTypeLabel(type: string) {
  const map: Record<string, string> = {
    ATTENDANCE_SHEET: "직무지도원 출근부",
    TRAINING_DAILY_LOG: "지원고용 훈련일지",
    TRAINEE_COMPREHENSIVE_EVAL: "훈련생 종합평가",
    POST_EMPLOY_ADAPT_LOG: "적응지도 일지",
    ADAPTATION_COMPREHENSIVE_EVAL: "적응지도 종합평가",
    CHECKLIST: "체크리스트",
  };
  return map[type] || type;
}
