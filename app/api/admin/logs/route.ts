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
    // 비숫자 id는 아래 BigInt()에서 500 나므로 400(P3 위생).
    if ((workerId && !/^\d+$/.test(workerId)) || (traineeId && !/^\d+$/.test(traineeId)))
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
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

    // ★15차: 훈련일지의 '근무 현장'이 이 기관인 것만. writerId(현재 배정 워커)만 스코프하면, 멀티기관 배정 워커가
    //  타 기관(B) 현장에서 작성한 훈련일지가 A 매니저에게 유출된다(로그 내용=크로스테넌트). attendance.site.agencyId로
    //  스코프해 차단(attendanceId는 non-null이라 정당 로그 배제 없음). 운영자(agencyId 없음)는 전체.
    const attendanceWhere: { site?: { agencyId: bigint }; workDate?: { gte: string; lte: string } } = {};
    if (scope.agencyId) attendanceWhere.site = { agencyId: scope.agencyId };
    if (dateFrom && dateTo) attendanceWhere.workDate = { gte: dateFrom, lte: dateTo };

    const logs = await prisma.traineeLog.findMany({
      where: {
        ...(writerFilter !== undefined ? { writerId: writerFilter } : {}),
        ...(traineeId ? { traineeId: BigInt(traineeId) } : {}),
        ...(completed === "true"  ? { isCompleted: true  } : {}),
        ...(completed === "false" ? { isCompleted: false } : {}),
        ...(Object.keys(attendanceWhere).length ? { attendance: attendanceWhere } : {}),
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
