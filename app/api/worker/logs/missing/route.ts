export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

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
            trainees: {
              where: { status: "TRAINING" },
              select: { id: true, name: true, gender: true },
            },
          },
        },
        assignment: {
          select: { serviceStep: true },
        },
      },
      orderBy: { workDate: "desc" },
      take: 30,
    });

    return NextResponse.json({
      success: true,
      attendances: attendances.map(a => {
        const step = (a.assignment as any)?.serviceStep;
        const trainingType =
          step === "PRE_TRAINING" ? "PRE" :
          step === "ADAPTATION"   ? "ADAPTATION" : "FIELD";
        return {
          attendanceId:  a.id.toString(),
          workDate:      a.workDate,
          siteName:      a.site.companyName,
          trainingType,
          trainees:      a.site.trainees.map(t => ({
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
