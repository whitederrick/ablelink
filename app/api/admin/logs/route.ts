// 위탁기관 관리자: 직무지도원 일지 내용 열람
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { logAccess } from "@/lib/accessLog";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);

    const dateFrom  = searchParams.get("dateFrom")  ?? "";
    const dateTo    = searchParams.get("dateTo")    ?? "";
    const workerId   = searchParams.get("workerId")   ?? "";
    const traineeId = searchParams.get("traineeId") ?? "";
    const completed = searchParams.get("completed") ?? ""; // "true"|"false"|""

    // 위탁기관 내 배정 목록으로 접근 가능한 workerId 범위 결정
    const assignments = scope.agencyId
      ? await prisma.siteAssignment.findMany({
          where: { agencyId: scope.agencyId, status: { in: ["ACTIVE","ASSIGNED","CONFIRMED"] } },
          select: { workerId: true },
        })
      : [];
    const allowedUserIds = scope.agencyId
      ? assignments.map(a => a.workerId)
      : undefined; // ADMIN은 전체

    // writerId 필터 병합 — 같은 키를 두 번 스프레드하면 뒤 값이 이겨 기관 스코프가 사라진다(크로스테넌트 IDOR).
    //  workerId가 오면 기관 허용범위 안일 때만 그 워커로 좁히고, 범위 밖이면 403.
    let writerFilter: bigint | { in: bigint[] } | undefined = undefined;
    if (workerId) {
      const wid = BigInt(workerId);
      if (allowedUserIds && !allowedUserIds.some(id => id === wid)) {
        return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
      }
      writerFilter = wid;
    } else if (allowedUserIds) {
      writerFilter = { in: allowedUserIds };
    }

    const logs = await prisma.traineeLog.findMany({
      where: {
        ...(writerFilter !== undefined ? { writerId: writerFilter } : {}),
        ...(traineeId ? { traineeId: BigInt(traineeId) } : {}),
        ...(completed === "true"  ? { isCompleted: true  } : {}),
        ...(completed === "false" ? { isCompleted: false } : {}),
        attendance: dateFrom && dateTo
          ? { workDate: { gte: dateFrom, lte: dateTo } }
          : undefined,
      },
      include: {
        trainee:    { select: { id: true, name: true, gender: true } },
        writer:     { select: { id: true, workerName: true } },
        attendance: { select: { workDate: true, site: { select: { companyName: true } } } },
        tasks:      { take: 1 },
      },
      orderBy: { id: "desc" },
      take: 200,
    });

    // 개인정보 접속기록: 취급자(관리자)의 훈련생 일지 내용 열람.
    await logAccess(req, scope, {
      subjectType: "Trainee",
      subjectId: traineeId || null,
      resource: "trainee_logs",
      action: "view",
    });

    return NextResponse.json({
      success: true,
      logs: logs.map(l => ({
        id:           l.id.toString(),
        traineeId:    l.traineeId.toString(),
        traineeName:  l.trainee.name,
        writerId:     l.writerId.toString(),
        workerName:    l.writer.workerName,
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
