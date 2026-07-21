export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { effectiveTrainingType } from "@/lib/serviceStep";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const workerId = BigInt(session.workerId);

    // 최근 3개월 출근 기록 중 일지가 하나도 없는 것
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const from = threeMonthsAgo.toISOString().slice(0, 10);

    const attendances = await prisma.dailyAttendance.findMany({
      where: {
        workerId,
        workDate: { gte: from },
        logs: { none: { writerId: workerId } },
      },
      include: {
        site: {
          select: {
            companyName: true,
            agencyId: true, // 공유현장 크로스테넌트 PII 스코프 판정용(아래)
            trainees: {
              where: { status: { in: ["TRAINING", "EMPLOYED"] } },
              select: { id: true, name: true, gender: true },
            },
          },
        },
        assignment: {
          select: { serviceStep: true, adaptationStartDate: true, agencyId: true },
        },
      },
      orderBy: { workDate: "desc" },
      take: 30,
    });

    return NextResponse.json({
      success: true,
      attendances: attendances.map(a => {
        // 해당 출근일 기준 단계(전환일 반영)
        const trainingType = effectiveTrainingType((a.assignment as any)?.serviceStep, (a.assignment as any)?.adaptationStartDate, a.workDate);
        // 공유(divergent) 현장 크로스테넌트 PII 차단(2026-07-21 감사 P2): 배정 기관과 현장 소유 기관이 일치할
        //  때만 훈련생 노출. 불일치·null이면 빈 목록(fail-closed) — worker/site/current·docs/context와 동일.
        const asgAgencyId = a.assignment?.agencyId;
        const scopedTrainees = asgAgencyId != null && a.site.agencyId === asgAgencyId
          ? a.site.trainees
          : [];
        return {
          attendanceId:  a.id.toString(),
          workDate:      a.workDate,
          siteName:      a.site.companyName,
          trainingType,
          trainees:      scopedTrainees.map(t => ({
            id:     t.id.toString(),
            name:   t.name,
            gender: t.gender,
          })),
        };
      }),
    });
  } catch (e: any) {
    console.error("[logs/missing]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
