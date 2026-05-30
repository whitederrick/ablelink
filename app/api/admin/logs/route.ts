// 에이전시 관리자: 직무지도원 일지 내용 열람
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);

    const dateFrom  = searchParams.get("dateFrom")  ?? "";
    const dateTo    = searchParams.get("dateTo")    ?? "";
    const workerId   = searchParams.get("workerId")   ?? "";
    const traineeId = searchParams.get("traineeId") ?? "";
    const completed = searchParams.get("completed") ?? ""; // "true"|"false"|""

    // 에이전시 스코프 — 본인 소속 직무지도원만
    const agencyFilter = scope.agencyId
      ? { agencyId: scope.agencyId }
      : {};

    // 에이전시 내 배정 목록으로 접근 가능한 userId 범위 결정
    const assignments = scope.agencyId
      ? await prisma.siteAssignment.findMany({
          where: { agencyId: scope.agencyId, status: { in: ["ACTIVE","ASSIGNED","CONFIRMED"] } },
          select: { userId: true },
        })
      : [];
    const allowedUserIds = scope.agencyId
      ? assignments.map(a => a.userId)
      : undefined; // ADMIN은 전체

    const logs = await prisma.traineeLog.findMany({
      where: {
        ...(allowedUserIds ? { writerId: { in: allowedUserIds } } : {}),
        ...(workerId   ? { writerId:  BigInt(workerId)   } : {}),
        ...(traineeId ? { traineeId: BigInt(traineeId) } : {}),
        ...(completed === "true"  ? { isCompleted: true  } : {}),
        ...(completed === "false" ? { isCompleted: false } : {}),
        attendance: dateFrom && dateTo
          ? { workDate: { gte: dateFrom, lte: dateTo } }
          : undefined,
      },
      include: {
        trainee:    { select: { id: true, name: true, gender: true } },
        writer:     { select: { id: true, userName: true } },
        attendance: { select: { workDate: true, site: { select: { companyName: true } } } },
        tasks:      { take: 1 },
      },
      orderBy: { id: "desc" },
      take: 200,
    });

    return NextResponse.json({
      success: true,
      logs: logs.map(l => ({
        id:           l.id.toString(),
        traineeId:    l.traineeId.toString(),
        traineeName:  l.trainee.name,
        writerId:     l.writerId.toString(),
        workerName:    l.writer.userName,
        siteName:     l.attendance.site?.companyName ?? "",
        workDate:     l.attendance.workDate,
        trainingType: l.trainingType,
        attendance:   l.evaluation ?? "출석",
        totalTime:    Number(l.totalRecognizedTime),
        content:      l.content ?? "",
        taskName:     l.tasks[0]?.taskName ?? "",
        taskScore:    l.tasks[0]?.performanceScore ?? null,
        isCompleted:  l.isCompleted,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
