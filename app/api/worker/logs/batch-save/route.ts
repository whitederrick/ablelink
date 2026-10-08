// app/api/worker/logs/batch-save/route.ts
// 일지 초안 일괄 저장 API
// 날짜별 DailyAttendance가 없으면 자동 생성(소급 입력 지원)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { WorkStatus } from "@prisma/client";
import { audit } from "@/lib/audit";
import { traineeCountOnDate, type PlacementSpan } from "@/lib/traineePlacement";
import { getKstDateString, isValidYmd } from "@/lib/time";
import { checkLogText, checkLogHours, MAX_BATCH_LOGS } from "@/lib/docs/logTextLimit";

interface LogEntry {
  date: string;
  traineeId: string;
  trainingType?: string;
  time1on1?: number;
  timeGroup?: number;
  content?: string;
  evaluation?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { assignmentId, logs }: { assignmentId: string; logs: LogEntry[] } = body;

    if (!assignmentId || !/^[0-9]+$/.test(String(assignmentId)) || !Array.isArray(logs) || logs.length === 0) {
      return NextResponse.json({ success: false, message: "assignmentId와 logs가 필요합니다." }, { status: 400 });
    }

    // ★2026-07-21 감사 P2: 각 로그 date를 왕복검증(isValidYmd). 무검증이면 "garbage"→Prisma DateTime 필터 500,
    //  "2026-02-30"→비실존 날짜의 DailyAttendance 유령행 생성(출근부·급여 오염). 형식+실존 모두 강제.
    if (!logs.every(l => typeof l?.date === "string" && isValidYmd(l.date))) {
      return NextResponse.json({ success: false, message: "유효하지 않은 날짜가 포함되어 있습니다." }, { status: 400 });
    }
    // ★2026-07-21 감사 P2: 지도사항(content)·평가(evaluation) 길이 상한 — 장문 일지 PDF 셀 붕괴 방어.
    //  2026-10-08 감사 P3: logs 배열 개수 상한과 지도시간 숫자 검증(NaN·음수·과대값).
    if (logs.length > MAX_BATCH_LOGS) {
      return NextResponse.json({ success: false, message: `한 번에 ${MAX_BATCH_LOGS}건까지만 저장할 수 있습니다.` }, { status: 400 });
    }
    for (const l of logs) {
      const lenErr = checkLogText("지도사항", l?.content) ?? checkLogText("평가", l?.evaluation)
        ?? checkLogHours("1:1 지도시간", l?.time1on1) ?? checkLogHours("1:多 지도시간", l?.timeGroup);
      if (lenErr) return NextResponse.json({ success: false, message: lenErr }, { status: 400 });
    }

    const writerId = BigInt(session.workerId);
    const assignId = BigInt(assignmentId);

    // 배정 정보 조회 (siteId, workerId 확인)
    const assignment = await prisma.siteAssignment.findUnique({
      where: { id: assignId },
      select: { workerId: true, siteId: true, startDate: true, endDate: true },
    });
    if (!assignment || assignment.workerId !== writerId) {
      return NextResponse.json({ success: false, message: "배정 정보를 찾을 수 없습니다." }, { status: 403 });
    }

    const { siteId } = assignment;
    // M8: 배정 기간 밖 날짜엔 출근기록 생성 금지(cron·bulk-generate와 동일 기준).
    const asgStart = assignment.startDate ? getKstDateString(assignment.startDate) : null;
    const asgEnd = assignment.endDate ? getKstDateString(assignment.endDate) : null;

    // IDOR + 날짜정합: 현장·기간 재적 placement를 일괄 조회(N+1 제거)해 두 가지를 판정.
    //   (1) IDOR 하드차단 — 현장·봉투기간에 재적 이력이 전혀 없는 훈련생이 섞이면 거부(임의 주입 방지).
    //   (2) 날짜정합 — 각 로그의 '그 날짜'가 그 훈련생 재적 기간 안인지 개별 검증(아래 저장 루프).
    //       봉투[minDate,maxDate] 1회 검사만 하면, 봉투 일부만 재적한 훈련생의 봉투 밖 날짜 로그가
    //       통과해 문서 내용이 오염된다(단건 save는 날짜별 차단이므로 배치도 날짜별로 맞춘다).
    const allDates = logs.map(l => l.date).filter(Boolean).sort();
    const minDate = allDates[0], maxDate = allDates[allDates.length - 1];
    const uniqueTraineeIds = [...new Set(logs.map(l => String(l.traineeId)))];
    for (const tid of uniqueTraineeIds) {
      if (!/^[0-9]+$/.test(tid)) {
        return NextResponse.json({ success: false, message: "잘못된 훈련생 정보입니다." }, { status: 400 });
      }
    }
    const placements = await prisma.traineePlacement.findMany({
      where: {
        siteId,
        traineeId: { in: uniqueTraineeIds.map(t => BigInt(t)) },
        startDate: { lte: new Date(maxDate + "T23:59:59+09:00") },
        OR: [{ endDate: null }, { endDate: { gte: new Date(minDate + "T00:00:00+09:00") } }],
      },
      select: { traineeId: true, siteId: true, startDate: true, endDate: true },
    });
    const placementsByTrainee = new Map<string, PlacementSpan[]>();
    for (const p of placements) {
      const k = String(p.traineeId);
      const arr = placementsByTrainee.get(k);
      if (arr) arr.push(p); else placementsByTrainee.set(k, [p]);
    }
    for (const tid of uniqueTraineeIds) {
      if (!placementsByTrainee.has(tid)) {
        return NextResponse.json({ success: false, message: "이 현장에 배정되지 않은 훈련생이 포함되어 있습니다." }, { status: 403 });
      }
    }

    // 고유 날짜 목록 추출
    const uniqueDates = [...new Set(logs.map(l => l.date))];

    // 날짜별 attendanceId 확보 (없으면 생성) — 날짜별 순차 2쿼리(N+1) → 일괄 조회+createMany(한 달 31일도 3쿼리).
    const dateToAttendanceId = new Map<string, bigint>();
    const skippedOutOfRange: string[] = []; // 배정 기간 밖이라 저장 못 한 날짜(응답에 명시)
    const skippedNoAttendance: string[] = []; // 출근기록 없는 오늘·미래 날짜(출근 체크인 전이라 저장 못 함 — 응답에 명시)
    {
      const existingRows = await prisma.dailyAttendance.findMany({
        where: { assignmentId: assignId, workDate: { in: uniqueDates } },
        select: { id: true, workDate: true },
      });
      for (const r of existingRows) dateToAttendanceId.set(r.workDate, r.id);

      // 이미 작성된 일지(임시저장·완료)를 조용히 덮어쓰지 않는다 — 어떤 일지가 덮어써지는지 알리고 확인(overwrite:true)을 요구.
      //  출근기록 생성 등 어떤 쓰기보다 먼저 판정해, 취소 시 부작용이 없게 한다.
      if (body.overwrite !== true && existingRows.length > 0) {
        const dupRows = await prisma.traineeLog.findMany({
          where: {
            attendanceId: { in: existingRows.map(r => r.id) },
            traineeId: { in: uniqueTraineeIds.map(t => BigInt(t)) },
          },
          select: { attendanceId: true, traineeId: true, isCompleted: true },
        });
        const dupByKey = new Map(dupRows.map(r => [`${r.attendanceId}_${r.traineeId}`, r.isCompleted]));
        const conflicts: { date: string; traineeId: string; completed: boolean }[] = [];
        const seen = new Set<string>();
        for (const l of logs) {
          const attId = dateToAttendanceId.get(l.date);
          if (attId == null) continue;
          // 저장 루프에서 '훈련생 미재적'으로 건너뛸 로그는 덮어써지지 않으므로 확인창에 올리지 않는다.
          if (traineeCountOnDate(placementsByTrainee.get(String(l.traineeId)) ?? [], l.date, siteId) < 1) continue;
          const k = `${attId}_${l.traineeId}`;
          if (seen.has(k) || !dupByKey.has(k)) continue;
          seen.add(k);
          conflicts.push({ date: l.date, traineeId: String(l.traineeId), completed: dupByKey.get(k) === true });
        }
        if (conflicts.length > 0) {
          return NextResponse.json({
            success: false,
            code: "OVERWRITE_CONFIRM",
            conflicts,
            message: "이미 작성된 일지가 있습니다.",
          }, { status: 409 });
        }
      }

      const todayKST = getKstDateString();
      const toCreate: string[] = [];
      for (const date of uniqueDates) {
        if (dateToAttendanceId.has(date)) continue;
        // M8: 배정 기간 밖 날짜엔 출근기록 생성 금지(기간 밖 날짜가 출근부·급여에 새는 것 방지).
        //  ★조용히 버리지 않고 어떤 날짜가 제외됐는지 응답에 담는다(워커가 일부 누락을 인지하도록).
        if ((asgStart && date < asgStart) || (asgEnd && date > asgEnd)) { skippedOutOfRange.push(date); continue; }
        // 오늘·미래 날짜는 clock-in 없이 생성 불가 — 스킵. ★조용히 버리지 않고 응답에 명시한다(예전엔 안내 없이 누락되고
        //  클라이언트는 saved:0이어도 완료 화면을 띄웠다).
        if (date >= todayKST) { skippedNoAttendance.push(date); continue; }
        toCreate.push(date);
      }
      if (toCreate.length) {
        // 과거 날짜: 소급 일지 입력용 출근기록 생성. ★출퇴근 시각이 없으므로 최종확정하지 않는다(isFinalClosed:false).
        //  (시각 0분인 채 확정하면 급여 엔진이 DAILY/MONTHLY 근무일수로 세어 과지급됨 — 시각은 출퇴근 기록/보정으로 채워져야 함.)
        await prisma.dailyAttendance.createMany({
          data: toCreate.map((date) => ({
            workerId: writerId,
            siteId,
            assignmentId: assignId,
            workDate: date,
            status: WorkStatus.DONE,
            isFinalClosed: false,
          })),
          skipDuplicates: true, // (assignmentId,workDate) unique — 동시 요청 안전
        });
        const createdRows = await prisma.dailyAttendance.findMany({
          where: { assignmentId: assignId, workDate: { in: toCreate } },
          select: { id: true, workDate: true },
        });
        for (const r of createdRows) dateToAttendanceId.set(r.workDate, r.id);
      }
    }

    // 기존 로그 일괄 조회(attendance×trainee) — 로그별 findFirst(N+1) 제거. 쓰기는 행별(각기 다른 데이터)이지만
    //  대부분의 재저장 시나리오에서 판정 쿼리가 사라져 한 달 66로그≈160+쿼리 → ~70쿼리.
    const existingLogs = await prisma.traineeLog.findMany({
      // writerId 필터 없음 — 기존 findFirst와 동일 판정((attendanceId,traineeId) unique 단위).
      where: { attendanceId: { in: [...dateToAttendanceId.values()] } },
      select: { id: true, attendanceId: true, traineeId: true },
    });
    const logKey = (att: bigint, tr: bigint) => `${att}_${tr}`;
    const existingByKey = new Map(existingLogs.map((l) => [logKey(l.attendanceId, l.traineeId), l.id]));

    let saved = 0;
    const skippedNotEnrolled: string[] = []; // 그 날짜에 훈련생이 현장 재적이 아니라 건너뛴 로그(조용한 오염 방지)
    for (const entry of logs) {
      const attendanceId = dateToAttendanceId.get(entry.date);
      if (!attendanceId) continue;

      // 날짜정합: 이 훈련생이 '그 날짜'에 현장 재적이 아니면 이 로그는 저장하지 않는다(봉투 밖 날짜 오염 방지).
      if (traineeCountOnDate(placementsByTrainee.get(String(entry.traineeId)) ?? [], entry.date, siteId) < 1) {
        skippedNotEnrolled.push(`${entry.date}(훈련생 미재적)`);
        continue;
      }

      const traineeId = BigInt(entry.traineeId);
      const logData = {
        traineeId,
        attendanceId,
        writerId,
        trainingType: entry.trainingType || "FIELD",
        time1on1:     Number(entry.time1on1  ?? 0),
        timeGroup:    Number(entry.timeGroup ?? 0),
        content:      entry.content?.trim() || null,
        evaluation:   entry.evaluation || null,
        isCompleted:  true,
      };

      const existingId = existingByKey.get(logKey(attendanceId, traineeId));
      const existing = existingId != null ? { id: existingId } : null;

      // 덮어쓰기는 '교체'다(확인창이 "기존 내용은 사라집니다"로 안내). logData에 없는 연장·인정시간과 과제 행(측정시간·특이사항)이
      //  남아 새 내용과 섞이지 않도록 함께 초기화한다(스키마 기본값 0).
      const overwriteData = { ...logData, extTime1on1: 0, extTimeGroup: 0, totalRecognizedTime: 0 };
      if (existing) {
        await prisma.traineeLog.update({ where: { id: existing.id }, data: overwriteData });
        await prisma.traineeLogTask.deleteMany({ where: { logId: existing.id } });
      } else {
        // DB 유니크(attendance_id, trainee_id)로 동시/재시도 중복 방지 — 충돌 시 기존 행 갱신.
        try {
          await prisma.traineeLog.create({ data: logData });
        } catch (e: any) {
          if (e?.code !== "P2002") throw e;
          const dup = await prisma.traineeLog.findFirst({ where: { traineeId, attendanceId }, select: { id: true } });
          if (!dup) throw e;
          await prisma.traineeLog.update({ where: { id: dup.id }, data: overwriteData });
          await prisma.traineeLogTask.deleteMany({ where: { logId: dup.id } });
        }
      }
      saved++;
    }

    if (saved > 0) {
      await audit(session, { entityType: "TraineeLog", action: "createMany", summary: `일지 일괄 저장 ${saved}건` });
    }

    const skipMsgs = [
      ...(skippedOutOfRange.length ? [`${skippedOutOfRange.length}개 날짜는 배정 기간 밖이라 저장되지 않았습니다: ${skippedOutOfRange.join(", ")}`] : []),
      ...(skippedNotEnrolled.length ? [`${skippedNotEnrolled.length}건은 해당 날짜에 훈련생이 현장 재적이 아니라 저장되지 않았습니다: ${skippedNotEnrolled.join(", ")}`] : []),
      ...(skippedNoAttendance.length ? [`${skippedNoAttendance.length}개 날짜는 출근 기록이 없는 오늘·미래 날짜라 저장되지 않았습니다(출근 체크인 후 작성): ${skippedNoAttendance.join(", ")}`] : []),
    ];
    return NextResponse.json({
      success: true,
      saved,
      ...(skippedOutOfRange.length ? { skippedOutOfRange } : {}),
      ...(skippedNotEnrolled.length ? { skippedNotEnrolled } : {}),
      ...(skippedNoAttendance.length ? { skippedNoAttendance } : {}),
      ...(skipMsgs.length ? { message: skipMsgs.join(" / ") } : {}),
    });
  } catch (error: unknown) {
    console.error("[worker/logs/batch-save]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
