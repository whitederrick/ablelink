// app/api/admin/trainee-report/route.ts
// 훈련생 진척도 리포트 API — STANDARD+ 전용
// GET /api/admin/trainee-report?year=2026&month=5

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";

function pad2(n: number) { return String(n).padStart(2, "0"); }

export async function GET(request: NextRequest) {
  try {
    const scope    = await requireAdminSession(request);
    const agencyId = requireAgencyScope(scope);

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
        user: { select: { userName: true } },
        site: { select: { companyName: true, id: true } },
      },
    });

    const result: any[] = [];

    for (const asgn of assignments) {
      if (!asgn.site) continue;

      // 이 현장의 훈련 중 훈련생
      const trainees = await prisma.trainee.findMany({
        where: {
          currentSiteId: asgn.site.id,
          status: { in: ["TRAINING", "EMPLOYED"] },
        },
        select: { id: true, name: true, gender: true, disabilityType: true, status: true },
      });

      // 해당 직무지도원의 이 달 출근 기록 + 일지 + 태스크
      const attendances = await prisma.dailyAttendance.findMany({
        where: { userId: asgn.userId, workDate: { gte: periodStart, lte: periodEnd } },
        include: {
          logs: {
            include: { tasks: { select: { performanceScore: true } } },
          },
        },
      });

      const totalWorkDays = attendances.filter(a => a.startTime).length;

      for (const trainee of trainees) {
        const tid = trainee.id;

        // 이 훈련생에 대한 일지가 있는 출근일
        const daysWithLog = attendances.filter(a =>
          a.startTime && a.logs.some(l => l.traineeId === tid)
        ).length;

        // 전체 태스크 점수
        const scores = attendances
          .flatMap(a => a.logs.filter(l => l.traineeId === tid))
          .flatMap(l => l.tasks.map(t => t.performanceScore));

        const avgScore = scores.length > 0
          ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10
          : null;

        // 최신 종합평가
        const latestEval = await prisma.traineeEvaluation.findFirst({
          where: { traineeId: tid, writerId: asgn.userId },
          orderBy: { updatedAt: "desc" },
          select: { evalType: true, periodStart: true, periodEnd: true, scores: true, updatedAt: true },
        });

        // 평가 점수 평균 계산 (JSON scores 구조: { CATEGORY: [{initial, final}] })
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
    return NextResponse.json({ success: false, message: e.message || "오류" }, { status: 500 });
  }
}
