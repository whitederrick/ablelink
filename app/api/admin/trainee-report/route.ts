// app/api/admin/trainee-report/route.ts
// 훈련생 진척도 리포트 API — STANDARD+ 전용
// GET /api/admin/trainee-report?year=2026&month=5

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";

function pad2(n: number) { return String(n).padStart(2, "0"); }

export async function GET(request: NextRequest) {
  try {
    const scope    = await requireManagerSession(request);
    const agencyId = scope.agencyId;

    const planCheck = await checkAgencyPlanAccess(agencyId, "TRAINEE_REPORT");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const now   = new Date();
    const year  = Number(searchParams.get("year")  || now.getFullYear());
    const month = Number(searchParams.get("month") || now.getMonth() + 1);

    const periodStart = `${year}-${pad2(month)}-01`;
    const periodEnd   = `${year}-${pad2(month)}-31`;

    // 에이전시 소속 활성 배정 전체
    const assignments = await prisma.siteAssignment.findMany({
      where: { agencyId, status: "ACTIVE" },
      include: {
        user: { select: { id: true, userName: true } },
        site: { select: { companyName: true, id: true } },
      },
    });

    if (assignments.length === 0) {
      return NextResponse.json({ success: true, data: [], year, month });
    }

    const siteIds = [...new Set(assignments.filter(a => a.site).map(a => a.site!.id))];
    const userIds = [...new Set(assignments.map(a => a.userId))];

    // N+1 제거: 3개 쿼리로 전체 데이터 일괄 조회
    const [allTrainees, allAttendances] = await Promise.all([
      prisma.trainee.findMany({
        where: { currentSiteId: { in: siteIds }, status: { in: ["TRAINING", "EMPLOYED"] } },
        select: { id: true, name: true, gender: true, disabilityType: true, status: true, currentSiteId: true },
      }),
      prisma.dailyAttendance.findMany({
        where: { userId: { in: userIds }, workDate: { gte: periodStart, lte: periodEnd } },
        include: { logs: { include: { tasks: { select: { performanceScore: true } } } } },
      }),
    ]);

    const allEvals = await prisma.traineeEvaluation.findMany({
      where: { traineeId: { in: allTrainees.map(t => t.id) }, writerId: { in: userIds } },
      orderBy: { updatedAt: "desc" },
      select: { traineeId: true, writerId: true, evalType: true, periodStart: true, periodEnd: true, scores: true, updatedAt: true },
    });

    // 조회 결과를 메모리 맵으로 인덱싱
    const traineesBySite = new Map<bigint, typeof allTrainees>();
    for (const t of allTrainees) {
      if (!t.currentSiteId) continue;
      if (!traineesBySite.has(t.currentSiteId)) traineesBySite.set(t.currentSiteId, []);
      traineesBySite.get(t.currentSiteId)!.push(t);
    }

    const attendancesByUser = new Map<bigint, typeof allAttendances>();
    for (const a of allAttendances) {
      if (!attendancesByUser.has(a.userId)) attendancesByUser.set(a.userId, []);
      attendancesByUser.get(a.userId)!.push(a);
    }

    // 평가: traineeId+writerId → 가장 최신 1건
    const evalKey = (traineeId: bigint, writerId: bigint) => `${traineeId}_${writerId}`;
    const latestEvalMap = new Map<string, (typeof allEvals)[0]>();
    for (const ev of allEvals) {
      const k = evalKey(ev.traineeId, ev.writerId);
      if (!latestEvalMap.has(k)) latestEvalMap.set(k, ev); // orderBy desc이므로 첫 번째가 최신
    }

    const result: any[] = [];

    for (const asgn of assignments) {
      if (!asgn.site) continue;
      const trainees  = traineesBySite.get(asgn.site.id) ?? [];
      const attendances = attendancesByUser.get(asgn.userId) ?? [];
      const totalWorkDays = attendances.filter(a => a.startTime).length;

      for (const trainee of trainees) {
        const tid = trainee.id;

        const daysWithLog = attendances.filter(a =>
          a.startTime && a.logs.some(l => l.traineeId === tid)
        ).length;

        const scores = attendances
          .flatMap(a => a.logs.filter(l => l.traineeId === tid))
          .flatMap(l => l.tasks.map(t => t.performanceScore));
        const avgScore = scores.length > 0
          ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10
          : null;

        const latestEval = latestEvalMap.get(evalKey(tid, asgn.userId)) ?? null;

        let evalAvg: number | null = null;
        if (latestEval?.scores && typeof latestEval.scores === "object") {
          const allItems: number[] = [];
          for (const vals of Object.values(latestEval.scores as Record<string, any[]>)) {
            if (!Array.isArray(vals)) continue;
            for (const item of vals) {
              if (typeof item.final === "number") allItems.push(item.final);
            }
          }
          if (allItems.length > 0) {
            evalAvg = Math.round((allItems.reduce((s, v) => s + v, 0) / allItems.length) * 10) / 10;
          }
        }

        result.push({
          traineeId:    tid.toString(),
          traineeName:  trainee.name,
          gender:       trainee.gender,
          disabilityType: trainee.disabilityType || "-",
          status:       trainee.status,
          coachName:    asgn.user?.userName || "-",
          siteName:     asgn.site.companyName,
          totalWorkDays,
          daysWithLog,
          logRate:      totalWorkDays > 0 ? Math.round(daysWithLog / totalWorkDays * 100) : 0,
          avgScore,
          evalType:     latestEval?.evalType ?? null,
          evalPeriod:   latestEval ? `${latestEval.periodStart} ~ ${latestEval.periodEnd}` : null,
          evalAvg,
          evalUpdatedAt: latestEval?.updatedAt ?? null,
        });
      }
    }

    // 사이트명 → 코치명 → 훈련생명 순 정렬
    result.sort((a, b) =>
      a.siteName.localeCompare(b.siteName) ||
      a.coachName.localeCompare(b.coachName) ||
      a.traineeName.localeCompare(b.traineeName)
    );

    return NextResponse.json({ success: true, data: result, year, month });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[trainee-report]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
