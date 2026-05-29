// app/api/worker/logs/prev/route.ts
// 전일 일지 내용 불러오기 API

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const traineeId = searchParams.get("traineeId");

    if (!traineeId) {
      return NextResponse.json({ success: false, message: "traineeId가 필요합니다." }, { status: 400 });
    }

    const prevLog = await prisma.traineeLog.findFirst({
      where: {
        traineeId: BigInt(traineeId),
        writerId: BigInt(session.userId),
      },
      include: { tasks: { take: 1 } },
      orderBy: { id: "desc" },
    });

    if (!prevLog) {
      return NextResponse.json({ success: false, message: "이전 일지 내용이 없습니다." });
    }

    return NextResponse.json({
      success: true,
      content:         prevLog.content ?? "",
      taskName:        prevLog.tasks[0]?.taskName ?? "",
      taskScore:       prevLog.tasks[0]?.performanceScore ?? 3,
      measurementTime: prevLog.tasks[0]?.difficulty ?? "",
    });
  } catch (error: any) {
    console.error("[worker/logs/prev]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
