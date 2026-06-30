// app/api/admin/dashboard/route.ts
// 관리자 대시보드 — 위탁기관 관점 통합 현황 API

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { getKstDateString } from "@/lib/time";
import { getConfigNumber } from "@/lib/systemConfig";
import { deriveAttendanceIssues, ATTENDANCE_ISSUE_WINDOW_DAYS } from "@/lib/attendance/issueDerivation";

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);
    const agencyFilter = { agencyId: scope.agencyId };

    const today = new Date();
    // 저장 workDate는 KST 기준 문자열(lib/time)이므로 오늘도 KST로 산출.
    // (UTC toISOString 사용 시 KST 자정~오전9시에 '어제'를 오늘로 집계하는 버그)
    const todayStr = getKstDateString();
    const now = new Date();

    const in5Days = new Date(today); in5Days.setDate(in5Days.getDate() + 5);
    const in10Days = new Date(today); in10Days.setDate(in10Days.getDate() + 10);
    const issueFloor = new Date(today); issueFloor.setDate(issueFloor.getDate() - 45);
    const issueFloorStr = issueFloor.toISOString().slice(0, 10);
    // 근무 종료(배정 종료일 경과) 후 만족도 평가 미요청 — 최근 60일 이내 종료분만 환기(스테일 누적 방지)
    const endedFloor = new Date(today); endedFloor.setDate(endedFloor.getDate() - 60);

    // 지각(TIME_ANOMALY) 판정 임계(분) — 인박스와 동일 운영설정값 사용
    const lateThresholdMin = await getConfigNumber("LATE_THRESHOLD_MIN");

    // ── 6개 쿼리 병렬 실행 ────────────────────────────────────────
    const [
      todayAttendances,
      recentAttendances,
      docRunsOpen,
      endingSoonAssignments,
      allActiveSites,
      endedAssignments,
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
          actualStartTime: true, startDistanceM: true, rangeM: true,
          user: { select: { workerName: true } },
          site: { select: { companyName: true } },
          assignment: { select: { workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true } },
          attendanceIssue: { select: { status: true } },
        },
      }),
      // 3. 제출 문서 현황 — 매니저 처리 대기(제출완료/확정/수정요청) 최근 50건
      prisma.documentRun.findMany({
        where: { agencyId: scope.agencyId, signStage: { in: ["SUBMITTED", "CONFIRMED", "CHANGES_REQUESTED"] } },
        take: 200,
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
          // 미배정 판정 = ACTIVE뿐 아니라 ASSIGNED(계약 대기)·CONFIRMED(연결 대기)도 '배정 있음'으로 간주
          // (시스템 충원 판정 assignedCount와 동일 기준). 0건일 때만 미배정.
          assignments: { where: { status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } }, select: { id: true } },
        },
      }),
      // 6. 근무 종료(배정 종료일 경과) — 만족도 평가 미요청 환기 후보(최근 60일)
      prisma.siteAssignment.findMany({
        where: { status: { in: ["ACTIVE", "CONFIRMED"] }, endDate: { lt: today, gte: endedFloor }, ...agencyFilter },
        select: {
          id: true, endDate: true, workerId: true,
          user: { select: { workerName: true } },
          site: { select: { companyName: true } },
        },
        orderBy: { endDate: "desc" },
        take: 100,
      }),
    ]);

    // 근무 종료 배정 중 '만족도 평가 미요청'만 추림 — 종료일(−7일 버퍼) 이후 생성된 평가가 없으면 미요청으로 간주
    const endedWorkerIds = [...new Set(endedAssignments.map(a => a.workerId))];
    const endedSurveys = endedWorkerIds.length
      ? await prisma.satisfactionSurvey.findMany({
          where: { agencyId: scope.agencyId, workerId: { in: endedWorkerIds } },
          select: { workerId: true, createdAt: true },
        })
      : [];
    const surveyDatesByWorker = new Map<string, Date[]>();
    for (const s of endedSurveys) {
      const k = String(s.workerId);
      (surveyDatesByWorker.get(k) ?? surveyDatesByWorker.set(k, []).get(k)!).push(s.createdAt);
    }
    const evalDue = endedAssignments.filter(a => {
      if (!a.endDate) return false;
      const buffer = new Date(a.endDate); buffer.setDate(buffer.getDate() - 7);
      const dates = surveyDatesByWorker.get(String(a.workerId)) ?? [];
      return !dates.some(d => d >= buffer);
    });

    // 최근 출근기록 → 근태 이슈 직접 도출(RESOLVED 제외). 인박스 열람 여부와 무관하게 정확.
    // 도출 규칙은 인박스와 공용 함수(lib/attendance/issueDerivation)로 통일. 면제 배정은 인박스와 동일하게 제외.
    const derivedIssues = recentAttendances
      .filter(r => !r.assignment?.attendanceButtonExempt)
      .map(r => ({
        r,
        types: deriveAttendanceIssues({
          startTime: r.startTime, endTime: r.endTime, actualStartTime: r.actualStartTime ?? null,
          startDistanceM: r.startDistanceM ?? null, rangeM: r.rangeM ?? null,
          workType: r.assignment?.workType ?? null,
          commuteGuidanceIncluded: r.assignment?.commuteGuidanceIncluded ?? null,
          customWorkStart: r.assignment?.customWorkStart ?? null,
          customWorkEnd: r.assignment?.customWorkEnd ?? null,
          status: r.status, workDate: r.workDate,
        }, { lateThresholdMin, todayStr }),
      }))
      .filter(x => x.types.length > 0 && x.r.attendanceIssue?.status !== "RESOLVED")
      .map(x => ({
        id: x.r.id.toString(),
        workerName: x.r.user?.workerName || "-",
        siteName: x.r.site?.companyName || "-",
        workDate: x.r.workDate,
        issueTypes: x.types,
        createdAt: x.r.startTime ? x.r.startTime.toISOString() : new Date(`${x.r.workDate}T00:00:00Z`).toISOString(),
      }));

    // '미확인 근태' 헤드라인/분해 카운트는 인박스 기본 조회기간(최근 14일, t-13~t)과 동일 모집단으로 한정 →
    // '더 보기'(인박스 기본 LAST_14)와 숫자가 일치. (45일 전체 derivedIssues는 아래 운영 리스크 알림에만 사용)
    const windowFloor = new Date(today); windowFloor.setDate(windowFloor.getDate() - (ATTENDANCE_ISSUE_WINDOW_DAYS - 1));
    const windowFloorStr = getKstDateString(windowFloor);
    const recentIssues = derivedIssues.filter(i => i.workDate >= windowFloorStr);

    const todayWorking = todayAttendances.filter(a => a.startTime && !a.isFinalClosed).length;
    const todayDone = todayAttendances.filter(a => a.isFinalClosed).length;
    const logDoneCount = todayAttendances.filter(a => a.logs.length > 0 && a.logs.every(l => l.isCompleted)).length;
    const logPendingCount = todayAttendances.filter(a => !a.logs.every(l => l.isCompleted) || a.logs.length === 0).length;
    const docPendingSubmit = docRunsOpen.filter(r => r.signStage === "SUBMITTED").length;     // 확정 대기
    const docOverdue = docRunsOpen.filter(r => r.signStage === "CONFIRMED").length;           // 서명 대기
    const endingIn5 = endingSoonAssignments.filter(a => a.endDate && a.endDate <= in5Days).length;
    const unassignedSites = allActiveSites.filter(s => s.assignments.length === 0);

    // ── 6. 운영 리스크 알림 ───────────────────────────────────────
    // 소스별 동일 상한(누락 최소화). 클라이언트는 5개씩 페이징하므로 상한만큼 페이지가 늘어남.
    const RISK_CAP = 50;
    const riskAlerts: Array<{
      type: string; id?: string; label: string; target: string; detail: string; severity: "high" | "medium" | "low";
    }> = [];

    // 미확인 근태: 조건(3일 경과) 충족분을 먼저 거른 뒤 상한 적용(상한에 가려 누락되지 않도록)
    const staleAttendance = derivedIssues
      .map(issue => ({ issue, daysAgo: Math.floor((now.getTime() - new Date(`${issue.workDate}T00:00:00Z`).getTime()) / 86400000) }))
      .filter(x => x.daysAgo >= 3);
    for (const { issue, daysAgo } of staleAttendance.slice(0, RISK_CAP)) {
      riskAlerts.push({
        type: "attendance", id: String(issue.id), label: "[근태]",
        target: issue.workerName,
        detail: `${daysAgo}일 경과 미확인 근태 — 『${issue.siteName}』`,
        severity: daysAgo >= 7 ? "high" : "medium",
      });
    }

    for (const r of docRunsOpen.filter(r => r.signStage === "SUBMITTED").slice(0, RISK_CAP)) {
      riskAlerts.push({
        type: "document", id: String(r.id), label: "[문서]",
        target: r.worker?.workerName || "-",
        detail: `${docTypeLabel(r.docType)} 확정 대기 — 『${r.site?.companyName || ""}』`,
        severity: "medium",
      });
    }

    for (const a of endingSoonAssignments.slice(0, RISK_CAP)) {
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

    for (const s of unassignedSites.slice(0, RISK_CAP)) {
      riskAlerts.push({
        type: "site", id: String(s.id), label: "[미배정]",
        target: s.companyName,
        detail: "활성 직무지도원 배정 없음",
        severity: "low",
      });
    }

    // 근무 종료 후 만족도 평가 미요청 — 배정 관리(근무 종료 필터)로 유도
    for (const a of evalDue.slice(0, RISK_CAP)) {
      const daysAgo = Math.floor((today.getTime() - a.endDate!.getTime()) / 86400000);
      riskAlerts.push({
        type: "survey_due", id: String(a.id), label: "[평가]",
        target: a.user?.workerName || "-",
        detail: `근무 종료 ${daysAgo}일 경과 — 만족도 평가 미요청 · 『${a.site?.companyName || ""}』`,
        severity: daysAgo >= 14 ? "medium" : "low",
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
          unconfirmedCount: recentIssues.length,
          docPendingSubmit,
          docOverdue,
          endingIn5,
          endingIn10: endingSoonAssignments.length,
          unassignedSiteCount: unassignedSites.length,
          unassignedSiteList: unassignedSites.map(s => ({ id: s.id.toString(), companyName: s.companyName })),
        },
        // 헤드라인(unconfirmedCount)과 동일한 14일 모집단 전체를 반환(슬라이스 금지) — 클라가 유형별
        // (출퇴근누락·지각/범위이탈)로 분해 카운트하므로 일부만 주면 분해 합계가 헤드라인과 어긋남.
        attendanceIssueList: recentIssues,
        docList: docRunsOpen.map(r => ({
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
        assignmentAlerts: endingSoonAssignments.map(a => ({
          id: a.id.toString(),
          workerName: a.user?.workerName || "-",
          siteName: a.site?.companyName || "-",
          endDate: a.endDate ? a.endDate.toISOString() : null,
          serviceStep: a.serviceStep,
          daysLeft: a.endDate
            ? Math.ceil((a.endDate.getTime() - today.getTime()) / 86400000)
            : null,
        })),
        riskAlerts: riskAlerts.slice(0, RISK_CAP * 5),
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
