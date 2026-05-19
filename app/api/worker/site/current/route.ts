// app/api/worker/site/current/route.ts
// 현재 배정된 Site 정보 조회 (업무일지 작성용)

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

    const userId = BigInt(session.userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assignment = await prisma.siteAssignment.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: {
        site: { include: { trainees: { where: { status: "TRAINING" } } } },
        agency: true,
      },
      orderBy: { startDate: "desc" },
    });

    if (!assignment?.site) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." });
    }

    const site = assignment.site;
    const agency = assignment.agency;

    // 직무지도원 정보 조회
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userName: true, phoneNumber: true, signatureUrl: true },
    });

    // 사이트 담당자 정보
    const manager = site.managerId
      ? await prisma.agencyManager.findUnique({
          where: { id: site.managerId },
          select: { name: true, email: true, phoneNumber: true },
        })
      : null;

    return NextResponse.json({
      success: true,
      data: {
        siteId: site.id.toString(),
        assignmentId: assignment.id.toString(),
        companyName: site.companyName,
        workType: assignment.workType || site.workType || "전일(8H)",
        isExtraTime: assignment.isExtraTime,
        traineeCount: site.trainees.length,
        trainees: site.trainees.map(t => ({
          id: t.id.toString(),
          name: t.name,
          gender: t.gender,
        })),
        agencyPlanType: agency?.planType ?? "FREE",
        trialEndsAt: agency?.trialEndsAt ?? null,
        // 이메일 발송용 추가 정보
        coachName: user?.userName ?? "",
        coachPhone: user?.phoneNumber ?? "",
        signatureUrl: user?.signatureUrl ?? null,
        managerName: manager?.name ?? "",
        managerEmail: manager?.email ?? "",
        managerPhone: manager?.phoneNumber ?? "",
        fieldTrainingStart: assignment.startDate?.toISOString() ?? null,
        fieldTrainingEnd: assignment.endDate?.toISOString() ?? null,
      },
    });
  } catch (error: any) {
    console.error("[worker/site/current]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
