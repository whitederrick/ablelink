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

    // ── 5개 쿼리 병렬 실행 ────────────────────────────────────────
    const [
      todayAttendances,
      unconfirmedIssues,
      docRunsOpen,
      endingSoonAssignments,
      allActiveSites,
    ] = await Promise.all([
      // 1. 오늘 출근 현황
      prisma.dailyAttendance.findMany({
        where: { workDate: todayStr, assignment: { ...agencyFilter } },
        select: {
          id: true, startTime: true, endTime: true, isFinalClosed: true, isGpsModified: true,
          user: { select: { userName: true } },
          site: { select: { companyName: true } },
          logs: { select: { isCompleted: true } },
          attendanceIssue: { select: { id: true, status: true, issueTypes: true } },
        },
      }),
      // 2. 미확인 근태 (최근 50건)
      prisma.attendanceIssue.findMany({
        where: { status: "OPEN", dailyAttendance: { assignment: { ...agencyFilter } } },
        take: 50,
        select: {
          id: true, issueTypes: true, createdAt: true,
          dailyAttendance: {
            select: {
              workDate: true,
              user: { select: { userName: true } },
              site: { select: { companyName: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      // 3. 보고서 현황 (최근 50건)
      prisma.documentRun.findMany({
        where: { status: "OPEN", agencyId: scope.agencyId },
        take: 50,
        select: {
          id: true, docType: true, dueAt: true, currentVersionId: true,
          coach: { select: { userName: true } },
          site: { select: { companyName: true } },
        },
      }),
      // 4. 배정 종료 임박
      prisma.siteAssignment.findMany({
        where: { status: "ACTIVE", endDate: { gte: today, lte: in10Days }, ...agencyFilter },
        select: {
          id: true, endDate: true, serviceStep: true,
          user: { select: { userName: true } },
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

    const todayWorking = todayAttendances.filter(a => a.startTime && !a.isFinalClosed).length;
    const todayDone = todayAttendances.filter(a => a.isFinalClosed).length;
    const logDoneCount = todayAttendances.filter(a => a.logs.length > 0 && a.logs.every(l => l.isCompleted)).length;
    const logPendingCount = todayAttendances.filter(a => !a.logs.every(l => l.isCompleted) || a.logs.length === 0).length;
    const docPendingSubmit = docRunsOpen.filter(r => !r.currentVersionId && r.dueAt > now).length;
    const docOverdue = docRunsOpen.filter(r => !r.currentVersionId && r.dueAt <= now).length;
    const endingIn5 = endingSoonAssignments.filter(a => a.endDate && a.endDate <= in5Days).length;
    const unassignedSites = allActiveSites.filter(s => s.assignments.length === 0);

    // ── 6. 운영 리스크 알림 ───────────────────────────────────────
    const riskAlerts: Array<{
      type: string; label: string; target: string; detail: string; severity: "high" | "medium" | "low";
    }> = [];

    for (const issue of unconfirmedIssues.slice(0, 15)) {
      const daysAgo = Math.floor((now.getTime() - issue.createdAt.getTime()) / 86400000);
      if (daysAgo >= 3) {
        riskAlerts.push({
          type: "attendance", label: "[근태]",
          target: issue.dailyAttendance?.user?.userName || "-",
          detail: `${daysAgo}일 연속 미확인 근태 — 『${issue.dailyAttendance?.site?.companyName || ""}』`,
          severity: daysAgo >= 7 ? "high" : "medium",
        });
      }
    }

    for (const r of docRunsOpen.filter(r => !r.currentVersionId && r.dueAt <= now).slice(0, 8)) {
      const daysOver = Math.ceil((now.getTime() - r.dueAt.getTime()) / 86400000);
      riskAlerts.push({
        type: "document", label: "[보고서]",
        target: r.site?.companyName || "-",
        detail: `${docTypeLabel(r.docType)} 미제출(D+${daysOver}) — 『${r.coach?.userName || ""}』`,
        severity: daysOver >= 7 ? "high" : "medium",
      });
    }

    for (const a of endingSoonAssignments.slice(0, 8)) {
      const daysLeft = a.endDate
        ? Math.ceil((a.endDate.getTime() - today.getTime()) / 86400000)
        : 0;
      riskAlerts.push({
        type: "assignment", label: "[배정]",
        target: a.user?.userName || "-",
        detail: `배정 종료 D-${daysLeft} — 『${a.site?.companyName || ""}』`,
        severity: daysLeft <= 3 ? "high" : "medium",
      });
    }

    for (const s of unassignedSites.slice(0, 3)) {
      riskAlerts.push({
        type: "site", label: "[미배정]",
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
          unconfirmedCount: unconfirmedIssues.length,
          docPendingSubmit,
          docOverdue,
          endingIn5,
          endingIn10: endingSoonAssignments.length,
          unassignedSiteCount: unassignedSites.length,
          unassignedSiteList: unassignedSites.slice(0, 10).map(s => ({ id: s.id.toString(), companyName: s.companyName })),
        },
        attendanceIssueList: unconfirmedIssues.slice(0, 10).map(i => ({
          id: i.id.toString(),
          userName: i.dailyAttendance?.user?.userName || "-",
          siteName: i.dailyAttendance?.site?.companyName || "-",
          workDate: i.dailyAttendance?.workDate || "-",
          issueTypes: i.issueTypes,
          createdAt: i.createdAt.toISOString(),
        })),
        docList: docRunsOpen.slice(0, 8).map(r => ({
          id: r.id.toString(),
          docType: r.docType,
          docTypeLabel: docTypeLabel(r.docType),
          coachName: r.coach?.userName || "-",
          siteName: r.site?.companyName || "-",
          dueAt: r.dueAt.toISOString(),
          isOverdue: r.dueAt <= now,
          hasVersion: !!r.currentVersionId,
        })),
        assignmentAlerts: endingSoonAssignments.slice(0, 8).map(a => ({
          id: a.id.toString(),
          userName: a.user?.userName || "-",
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
          userName: a.user?.userName || "-",
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
