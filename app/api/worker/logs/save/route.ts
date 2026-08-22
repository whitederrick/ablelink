// app/api/worker/logs/save/route.ts
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { getKstDateString, isValidYmd } from "@/lib/time";
import { checkLogText } from "@/lib/docs/logTextLimit";
import { audit } from "@/lib/audit";
import { findTraineeAtSiteInPeriod } from "@/lib/docs/traineeSiteGuard";

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    const {
      traineeId, attendanceId, trainingType,
      attendance,
      time1on1, timeGroup, extTime1on1, extTimeGroup,
      totalRecognizedTime,
      taskName,
      taskScore,
      measurementTime,
      specialNotes,
      content,
      isCompleted,
      logDate,    // attendanceId 없을 때 날짜 기준 조회/생성용
      siteId,     // 출근 기록 자동 생성 시 필요
      assignmentId: assignmentIdFromBody,
      logId,      // 수정 모드: 있으면 해당 일지를 logDate의 출근기록으로 이동(날짜 이동) 가능
    } = body;

    if (!traineeId || !/^[0-9]+$/.test(String(traineeId))) {
      return NextResponse.json({ success: false, message: "traineeId는 필수입니다." }, { status: 400 });
    }

    // ★2026-07-21 감사 P2: logDate가 오면 왕복검증(isValidYmd). 무검증이면 임의 문자열이 workDate로 저장되거나
    //  (findOrCreateAttendance) 하류 traineePlacement의 new Date(ymd)가 Invalid Date→DateTime 필터 500이 된다.
    if (logDate != null && logDate !== "" && !isValidYmd(String(logDate))) {
      return NextResponse.json({ success: false, message: "유효하지 않은 날짜입니다." }, { status: 400 });
    }

    // ★2026-07-21 감사 P2: 지도사항(content)·특이사항(specialNotes) 길이 상한(무상한이면 장문 일지가 PDF 셀 붕괴).
    const lenErr = checkLogText("지도사항", content) ?? checkLogText("특이사항", specialNotes);
    if (lenErr) return NextResponse.json({ success: false, message: lenErr }, { status: 400 });

    const writerId = BigInt(session.workerId);

    // 날짜 기준 출근기록 조회/생성 (없으면 현장 배정 기반 생성)
    async function findOrCreateAttendance(workDate: string): Promise<bigint> {
      // ★멀티현장: assignmentId가 주어지면 그 배정으로 스코프해 조회한다(@@unique(assignmentId,workDate)).
      //  과거엔 {workerId, workDate}로 아무 현장 기록이나 집어와, 같은 날 다른 현장에 배정된 워커의 일지가
      //  엉뚱한 현장 출근기록에 붙거나 훈련생 가드에 오차단됐다. (소유 검증은 아래 create 경로 + 하단 attRow 검증.)
      const scoped = assignmentIdFromBody && /^[0-9]+$/.test(String(assignmentIdFromBody));
      const ex = scoped
        ? await prisma.dailyAttendance.findFirst({ where: { assignmentId: BigInt(assignmentIdFromBody), workDate } })
        : await prisma.dailyAttendance.findFirst({ where: { workerId: writerId, workDate }, orderBy: { id: "desc" } });
      if (ex) return ex.id;
      if (!siteId || !assignmentIdFromBody) {
        throw new Error("VALIDATION:출근 기록이 없습니다. 출근 체크인 후 일지를 작성해주세요.");
      }
      // IDOR 방지: body의 assignmentId/siteId를 그대로 신뢰하지 않고, 그 배정이 내 것이고 siteId가 일치하는지 검증.
      if (!/^[0-9]+$/.test(String(assignmentIdFromBody)) || !/^[0-9]+$/.test(String(siteId))) {
        throw new Error("VALIDATION:잘못된 배정 정보입니다.");
      }
      const asg = await prisma.siteAssignment.findUnique({
        where: { id: BigInt(assignmentIdFromBody) },
        select: { workerId: true, siteId: true, startDate: true, endDate: true },
      });
      if (!asg || asg.workerId !== writerId || asg.siteId !== BigInt(siteId)) {
        throw new Error("VALIDATION:본인 배정이 아니거나 현장 정보가 일치하지 않습니다.");
      }
      // M8: 배정 기간 밖 날짜엔 출근기록 생성 금지(cron·bulk-generate와 동일 기준). 기간 밖 날짜가 출근부·급여에 새는 것 방지.
      const asgStart = asg.startDate ? getKstDateString(asg.startDate) : null;
      const asgEnd = asg.endDate ? getKstDateString(asg.endDate) : null;
      if ((asgStart && workDate < asgStart) || (asgEnd && workDate > asgEnd)) {
        throw new Error("VALIDATION:배정 기간 밖의 날짜에는 출근기록을 만들 수 없습니다.");
      }
      const created = await prisma.dailyAttendance.create({
        data: { workerId: writerId, siteId: asg.siteId, assignmentId: BigInt(assignmentIdFromBody), workDate },
      });
      return created.id;
    }

    // attendanceId 해석:
    // - 수정 모드(logId): logDate 기준으로 결정 → 날짜를 바꾸면 그 날짜 출근기록으로 이동
    // - 신규(출근에서 진입): attendanceId 직접 사용 / 자유작성: logDate 기준
    let resolvedAttendanceId: bigint;
    const workDate = logDate || getKstDateString(); // KST 기준(서버 UTC라 자정~09시 전날로 잡히던 문제 방지)
    try {
      if (logId) {
        resolvedAttendanceId = await findOrCreateAttendance(workDate);
      } else if (attendanceId) {
        if (!/^[0-9]+$/.test(String(attendanceId))) throw new Error("VALIDATION:잘못된 출근 기록입니다.");
        resolvedAttendanceId = BigInt(attendanceId);
      } else {
        resolvedAttendanceId = await findOrCreateAttendance(workDate);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.startsWith("VALIDATION:")) return NextResponse.json({ success: false, message: msg.slice(11) }, { status: 400 });
      throw e;
    }

    // IDOR 방지: 해석된 출근기록이 본인 것인지 확인(body attendanceId를 그대로 신뢰하지 않음).
    const attRow = await prisma.dailyAttendance.findUnique({
      where: { id: resolvedAttendanceId },
      select: { workerId: true, siteId: true, workDate: true },
    });
    if (!attRow || attRow.workerId !== writerId) {
      return NextResponse.json({ success: false, message: "본인 출근 기록이 아닙니다." }, { status: 403 });
    }
    // IDOR 방지: traineeId가 그 현장·그 날짜에 재적한 훈련생인지 검증(임의 훈련생 주입 차단).
    const traineeOk = await findTraineeAtSiteInPeriod(BigInt(traineeId), attRow.siteId, attRow.workDate, attRow.workDate);
    if (!traineeOk) {
      return NextResponse.json({ success: false, message: "이 현장에 배정된 훈련생이 아닙니다." }, { status: 403 });
    }

    // 수정 모드: 소유권 + 날짜 이동 충돌 검사
    if (logId) {
      if (!/^[0-9]+$/.test(String(logId))) return NextResponse.json({ success: false, message: "잘못된 일지 ID입니다." }, { status: 400 });
      const own = await prisma.traineeLog.findUnique({ where: { id: BigInt(logId) }, select: { writerId: true } });
      if (!own) return NextResponse.json({ success: false, message: "일지를 찾을 수 없습니다." }, { status: 404 });
      if (own.writerId !== writerId) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
      const conflict = await prisma.traineeLog.findFirst({
        where: { traineeId: BigInt(traineeId), attendanceId: resolvedAttendanceId, id: { not: BigInt(logId) } },
        select: { id: true },
      });
      if (conflict) return NextResponse.json({ success: false, message: "선택한 날짜에 이미 해당 훈련생의 일지가 있습니다." }, { status: 409 });
    }

    // 수정 모드면 그 일지(logId)를, 아니면 (traineeId, 출근기록) 기준으로 upsert
    const existing = logId
      ? await prisma.traineeLog.findUnique({ where: { id: BigInt(logId) } })
      : await prisma.traineeLog.findFirst({ where: { traineeId: BigInt(traineeId), attendanceId: resolvedAttendanceId } });

    const logData = {
      traineeId: BigInt(traineeId),
      attendanceId: resolvedAttendanceId,
      writerId,
      trainingType: trainingType || "FIELD",
      time1on1: Number(time1on1 ?? 0),
      timeGroup: Number(timeGroup ?? 0),
      extTime1on1: Number(extTime1on1 ?? 0),
      extTimeGroup: Number(extTimeGroup ?? 0),
      totalRecognizedTime: Number(totalRecognizedTime ?? 0),
      content: content?.trim() || null,
      evaluation: attendance || "출석",  // 출결 상태 저장 (기존 completionRate 버그 수정)
      isCompleted: isCompleted === true,
    };

    let log;
    if (existing) {
      log = await prisma.traineeLog.update({ where: { id: existing.id }, data: logData });
    } else {
      // DB 유니크(attendance_id, trainee_id)로 동시 저장/재시도 중복 방지 — 충돌 시 이미 생성된 행을 갱신.
      try {
        log = await prisma.traineeLog.create({ data: logData });
      } catch (e: any) {
        if (e?.code !== "P2002") throw e;
        const dup = await prisma.traineeLog.findFirst({ where: { attendanceId: resolvedAttendanceId, traineeId: BigInt(traineeId) }, select: { id: true } });
        if (!dup) throw e;
        log = await prisma.traineeLog.update({ where: { id: dup.id }, data: logData });
      }
    }

    // 수행정도는 ★미입력(null)이 기본이다 — 기관에 따라 일지에 측정시간만 기재한다(사용자 확정 2026-08-22).
    //  종전 `Number(taskScore) || 3` 은 선택하지 않아도 3(보통)을 저장해, '보통을 고른 것'과 구분이 불가능했다.
    //  1~5 정수만 인정하고 그 밖(미선택·빈값·범위 밖)은 전부 null 로 떨어뜨린다.
    const scoreNum = Number(taskScore);
    const performanceScore =
      Number.isInteger(scoreNum) && scoreNum >= 1 && scoreNum <= 5 ? scoreNum : null;

    // 과제 정보 저장
    await prisma.traineeLogTask.deleteMany({ where: { logId: log.id } });
    // ★측정시간도 이 행에 저장되므로 생성 조건에 포함한다. 수행정도가 기본 미입력이 되면서,
    //  '과제명 없이 측정시간만' 입력한 일지의 시간이 통째로 사라질 수 있었다.
    if (performanceScore != null || taskName || measurementTime) {
      await prisma.traineeLogTask.create({
        data: {
          logId: log.id,
          taskName: taskName?.trim() || "수행과제",
          performanceScore,
          difficulty: measurementTime ? String(measurementTime).trim() : null,  // 측정시간
          feedback: specialNotes?.trim() || null,                               // 특이사항
        },
      });
    }

    await audit(session, { entityType: "TraineeLog", entityId: log.id, action: existing ? "update" : "create", summary: "일지 저장" });

    return NextResponse.json({ success: true, logId: log.id.toString() });
  } catch (error: unknown) {
    console.error("[worker/logs/save]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
