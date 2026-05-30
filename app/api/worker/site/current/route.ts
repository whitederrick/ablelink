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

    const workerId = BigInt(session.workerId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assignment = await prisma.siteAssignment.findFirst({
      where: {
        workerId,
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

    // 오늘 출근 기록 조회
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const todayAttendance = await prisma.dailyAttendance.findFirst({
      where: { workerId, assignmentId: assignment.id, workDate: todayStr },
      orderBy: { id: "desc" },
    });

    // 직무지도원 정보 조회
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName: true, phoneNumber: true, signatureUrl: true },
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
        agencyId: agency?.id.toString() ?? null,
        companyName: site.companyName,
        workType: assignment.workType || "FULL_DAY",
        commuteGuidanceIncluded: (assignment as any).commuteGuidanceIncluded ?? true,
        customWorkStart: (assignment as any).customWorkStart ?? null,
        customWorkEnd: (assignment as any).customWorkEnd ?? null,
        traineeCount: site.trainees.length,
        trainees: site.trainees.map(t => ({
          id: t.id.toString(),
          name: t.name,
          gender: t.gender,
        })),
        agencyPlanType: agency?.planType ?? "FREE",
        trialEndsAt: agency?.trialEndsAt ?? null,
        // 이메일 발송용 추가 정보
        workerName: user?.workerName ?? "",
        workerPhone: user?.phoneNumber ?? "",
        signatureUrl: user?.signatureUrl ?? null,
        managerName: manager?.name ?? "",
        managerEmail: manager?.email ?? "",
        managerPhone: manager?.phoneNumber ?? "",
        fieldTrainingStart: assignment.startDate?.toISOString() ?? null,
        fieldTrainingEnd: assignment.endDate?.toISOString() ?? null,
        attendanceId: todayAttendance?.id?.toString() ?? null,
        // 훈련 단계
        trainingType: (assignment as any)?.serviceStep === "PRE_TRAINING"
          ? "PRE" : (assignment as any)?.serviceStep === "ADAPTATION"
          ? "ADAPTATION" : "FIELD",
      },
    });
  } catch (error: any) {
    console.error("[worker/site/current]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
