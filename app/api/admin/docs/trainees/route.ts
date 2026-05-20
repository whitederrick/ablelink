// app/api/admin/docs/trainees/route.ts
// 직무지도원의 담당 훈련생 목록 조회 (문서 뷰어 선택용)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    await requireAdminSession(request);
    const { searchParams } = new URL(request.url);
    const coachUserId = searchParams.get("coachUserId") ?? "";
    if (!coachUserId) return NextResponse.json({ success: false, message: "coachUserId 필요" }, { status: 400 });

    const userId = BigInt(coachUserId);

    // 직무지도원의 현장 배정 확인
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED","CONFIRMED","ACTIVE"] } },
      select: { siteId: true },
      orderBy: { assignedAt: "desc" },
    });

    if (!assignment) {
      return NextResponse.json({ success: true, trainees: [] });
    }

    // 해당 현장의 활성 훈련생 조회 (TraineePlacement 기반)
    const placements = await prisma.traineePlacement.findMany({
      where: {
        siteId: assignment.siteId,
        status: "ACTIVE",
      },
      include: {
        trainee: { select: { id: true, name: true, gender: true, status: true } },
      },
    });

    // TraineeStatus: TRAINING | EMPLOYED | DROPOUT | PAUSED
    const trainees = placements
      .filter(p => p.trainee.status === "TRAINING")
      .map(p => ({
        id:     String(p.trainee.id),
        name:   p.trainee.name,
        gender: p.trainee.gender,
      }));

    return NextResponse.json({ success: true, trainees });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/trainees]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}