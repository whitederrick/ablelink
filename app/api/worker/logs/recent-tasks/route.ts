// app/api/worker/logs/recent-tasks/route.ts
// 수행과제 재사용(#8): 해당 훈련생에 대해 최근 작성한 수행과제 목록을 중복 제거해 반환.
// 작성자(workerId)+traineeId 기준. 기간(periodStart/End) 주면 그 기간으로 한정.
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const traineeId = searchParams.get("traineeId");
    const periodStart = searchParams.get("periodStart");
    const periodEnd = searchParams.get("periodEnd");
    if (!traineeId || !/^\d+$/.test(traineeId)) return NextResponse.json({ success: false, message: "traineeId가 필요합니다." }, { status: 400 });

    const logs = await prisma.traineeLog.findMany({
      where: {
        traineeId: BigInt(traineeId),
        writerId: BigInt(session.workerId),
        ...(periodStart && periodEnd
          ? { attendance: { workDate: { gte: periodStart, lte: periodEnd } } }
          : {}),
      },
      include: { tasks: { take: 1 } },
      orderBy: { id: "desc" },
      take: 60,
    });

    // taskName 기준 중복 제거(최신 우선), 빈 과제 제외
    const seen = new Set<string>();
    const tasks: { taskName: string; taskScore: number | null; measurementTime: string }[] = [];
    for (const l of logs) {
      const t = l.tasks[0];
      const name = t?.taskName?.trim();
      if (!name || name === "수행과제" || seen.has(name)) continue;
      seen.add(name);
      tasks.push({
        taskName: name,
        taskScore: t?.performanceScore ?? null,  // 미입력 보존(2026-08-22)
        measurementTime: t?.difficulty ?? "",
      });
      if (tasks.length >= 10) break;
    }

    return NextResponse.json({ success: true, tasks });
  } catch (error: any) {
    console.error("[worker/logs/recent-tasks]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
