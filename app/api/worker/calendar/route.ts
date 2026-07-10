// app/api/worker/calendar/route.ts
// 월별 출근/일지 현황 조회 API (캘린더용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { getKrHolidays } from "@/lib/krHolidays";
import { effectiveTrainingType } from "@/lib/serviceStep";
import { getKstDateString } from "@/lib/time";
import { resolveWorkerAssignment } from "@/lib/worker/assignmentResolve";

function pad2(n: number) { return String(n).padStart(2, "0"); }

type DayStatus = "GREEN" | "ORANGE" | "RED" | "NONE" | "HOLIDAY";

function calcStatus(opts: {
  hasStart: boolean;
  hasEnd: boolean;
  isFinalClosed: boolean;
  completedLogs: number;
  traineeCount: number;
  isGpsModified: boolean;
}): DayStatus {
  const { hasStart, isFinalClosed, completedLogs, traineeCount, isGpsModified } = opts;

  if (!hasStart) return "RED";

  if (traineeCount > 0) {
    // 훈련생 있음: 모든 훈련생 일지 완료 + 종료되면 GREEN
    return completedLogs >= traineeCount && isFinalClosed ? "GREEN" : "ORANGE";
  } else {
    // 훈련생 없음: 출근 종료 + GPS 이탈 없음이면 GREEN
    return isFinalClosed && !isGpsModified ? "GREEN" : "ORANGE";
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    // 기본 연/월 = KST 기준(서버 UTC라 월경계 자정~09시에 전월로 잡히던 문제 방지)
    const [kstY, kstM] = getKstDateString().split("-").map(Number);
    const year  = Number(searchParams.get("year")  ?? kstY);
    const month = Number(searchParams.get("month") ?? kstM);

    const workerId = BigInt(session.workerId);

    const startDate = `${year}-${pad2(month)}-01`;
    const endDay    = new Date(year, month, 0).getDate();
    const endDate   = `${year}-${pad2(month)}-${pad2(endDay)}`;

    // ★멀티현장: 선택 배정을 monthly와 동일한 규칙(resolveWorkerAssignment, 오늘 활성만·낡은 쿠키면 최신 활성
    //  폴백)으로 해석 — 두 근태 화면이 같은 쿠키로 서로 다른 배정 기준 결근을 그리던 불일치 제거.
    const rawSel = searchParams.get("assignmentId");
    const candidates = await prisma.siteAssignment.findMany({
      where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } },
      select: { id: true, status: true, startDate: true, endDate: true },
    });
    const resolvedSel = resolveWorkerAssignment({
      requestedId: rawSel,
      allowEnded: false,
      assignments: candidates.map((c) => ({
        id: c.id.toString(),
        status: c.status,
        startDate: getKstDateString(c.startDate),
        endDate: c.endDate ? getKstDateString(c.endDate) : null,
      })),
      todayStr: getKstDateString(),
    });
    const assignment = resolvedSel.assignmentId
      ? await prisma.siteAssignment.findFirst({ where: { id: BigInt(resolvedSel.assignmentId), workerId }, include: { site: true } })
      : null;

    // ★해당 월 출근 기록 = workerId 전체(그 달 모든 배정, ENDED 포함) — 월중 현장전환 시 이전(종료) 배정
    //  기록이 캘린더에서 사라지던 회귀 방지. 같은 날 다중현장 충돌은 아래 dayMap에서 활성 배정 우선으로 해소.
    const attendances = await prisma.dailyAttendance.findMany({
      where: { workerId, workDate: { gte: startDate, lte: endDate } },
      include: { logs: { select: { id: true, isCompleted: true } } },
      orderBy: { workDate: "asc" },
    });

    // 월내 기록에 등장한 현장·배정 집합(멀티현장·월중 전환 포함). 활성 배정 현장도 포함.
    const monthSiteIds = [...new Set(attendances.map(a => a.siteId.toString()))];
    if (assignment?.siteId && !monthSiteIds.includes(assignment.siteId.toString())) monthSiteIds.push(assignment.siteId.toString());
    const monthSiteIdBig = monthSiteIds.map(s => BigInt(s));
    const monthAsgIds = [...new Set(attendances.map(a => a.assignmentId?.toString()).filter((x): x is string => !!x))];

    // 현장명(라벨용) — 같은날 다중현장 기록을 시각적으로 구분하기 위해.
    const sites = monthSiteIdBig.length
      ? await prisma.site.findMany({ where: { id: { in: monthSiteIdBig } }, select: { id: true, companyName: true } })
      : [];
    const siteNameById = new Map(sites.map(s => [s.id.toString(), s.companyName]));

    // 휴무일 조회 (공휴일 + 사이트별 커스텀)
    const nationalHolidays = getKrHolidays(year, month);
    // 활성 배정 커스텀 휴무 — RED 결근 제외·표시 기준(선택현장 결근 판정에 영향).
    const customHolidayRows = assignment
      ? await prisma.siteHoliday.findMany({
          where: { assignmentId: assignment.id, date: { gte: startDate, lte: endDate } },
          select: { date: true, reason: true },
        })
      : [];
    const customHolidays: Record<string, string> = {};
    for (const r of customHolidayRows) customHolidays[r.date] = r.reason ?? "휴무";
    // 월내 등장한 '타 배정' 커스텀 휴무 — 표시 라벨용(RED 이후 빈 날에만 채움 → 결근 판정에 영향 없음).
    const otherAsgIds = monthAsgIds.filter(id => id !== assignment?.id?.toString()).map(id => BigInt(id));
    const otherHolidayRows = otherAsgIds.length
      ? await prisma.siteHoliday.findMany({
          where: { assignmentId: { in: otherAsgIds }, date: { gte: startDate, lte: endDate } },
          select: { date: true, reason: true },
        })
      : [];

    // 훈련생 수 — ★기록의 실제 현장별로 그날 배치 인원을 계산(타현장 기록을 활성현장 인원으로 오판정하던 문제 수정).
    // 배치 [startDate, endDate] 가 그날을 덮으면 그날 재적(현재 상태 무관 — endDate가 이탈 시점을 이미 표현).
    const placementsAll = monthSiteIdBig.length
      ? await prisma.traineePlacement.findMany({
          where: {
            siteId: { in: monthSiteIdBig },
            startDate: { lte: new Date(endDate + "T23:59:59+09:00") },
            OR: [{ endDate: null }, { endDate: { gte: new Date(startDate + "T00:00:00+09:00") } }],
          },
          select: { siteId: true, startDate: true, endDate: true },
        })
      : [];
    const rangesBySite = new Map<string, { s: string; e: string | null }[]>();
    for (const p of placementsAll) {
      const k = p.siteId.toString();
      const arr = rangesBySite.get(k) ?? [];
      arr.push({ s: getKstDateString(p.startDate), e: p.endDate ? getKstDateString(p.endDate) : null });
      rangesBySite.set(k, arr);
    }
    const traineeCountOnSite = (siteId: string, dateStr: string): number =>
      (rangesBySite.get(siteId) ?? []).filter(p => p.s <= dateStr && (p.e === null || p.e >= dateStr)).length;
    // 조회 월 말일 기준 인원(요약/응답 표시용 대표값) — 활성 현장 기준.
    const traineeCount = assignment?.siteId ? traineeCountOnSite(assignment.siteId.toString(), endDate) : 0;

    // 오늘 날짜 문자열 (KST)
    const nowKst   = new Date(Date.now() + 9 * 3600000);
    const todayStr = nowKst.toISOString().slice(0, 10);

    // 날짜별 상태 맵
    type DayEntry = {
      status: DayStatus;
      attendanceId: string;
      startTime: string | null;
      endTime: string | null;
      isFinalClosed: boolean;
      logCount: number;
      traineeCount: number;
      holidayName?: string;
      siteName?: string | null; // 그날 표시된 기록의 현장명(멀티현장 구분용)
    };
    const dayMap: Record<string, DayEntry> = {};

    // 출근 기록이 있는 날 처리 — 그날 기준 인원으로 판정.
    //  같은 날 다중현장(AM/PM) 충돌 시 활성(선택) 배정 기록이 이기도록, 활성 배정 기록을 뒤에 써서 우선.
    const activeAsgId = assignment?.id?.toString() ?? null;
    const orderedAtt = [...attendances].sort((a, b) => {
      if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
      const aActive = activeAsgId && a.assignmentId.toString() === activeAsgId ? 1 : 0;
      const bActive = activeAsgId && b.assignmentId.toString() === activeAsgId ? 1 : 0;
      return aActive - bActive;
    });
    for (const att of orderedAtt) {
      const completedLogs = att.logs.filter(l => l.isCompleted).length;
      // ★그 기록의 실제 현장 인원으로 색상 판정(활성현장 인원으로 타현장 기록을 오판정하던 문제 수정).
      const dayTraineeCount = traineeCountOnSite(att.siteId.toString(), att.workDate);
      dayMap[att.workDate] = {
        status: calcStatus({
          hasStart:       !!att.startTime,
          hasEnd:         !!att.endTime,
          isFinalClosed:  att.isFinalClosed,
          completedLogs,
          traineeCount:   dayTraineeCount,
          isGpsModified:  att.isGpsModified,
        }),
        attendanceId: att.id.toString(),
        startTime:    att.startTime?.toISOString() ?? null,
        endTime:      att.endTime?.toISOString()   ?? null,
        isFinalClosed: att.isFinalClosed,
        logCount:     completedLogs,
        traineeCount: dayTraineeCount,
        siteName:     siteNameById.get(att.siteId.toString()) ?? null,
      };
    }

    // 공휴일 + 커스텀 휴무일 처리
    const allHolidays = { ...nationalHolidays, ...customHolidays };
    for (const [date, name] of Object.entries(allHolidays)) {
      if (date >= startDate && date <= endDate && !dayMap[date]) {
        dayMap[date] = {
          status: "HOLIDAY",
          attendanceId: "",
          startTime: null,
          endTime: null,
          isFinalClosed: false,
          logCount: 0,
          traineeCount,
          holidayName: name,
        };
      } else if (dayMap[date]) {
        // 출근 기록이 있어도 휴무일 이름은 표시
        (dayMap[date] as any).holidayName = name;
      }
    }

    // 주말(토·일)은 휴무 — 결근(RED) 아님. 출근부 일괄생성도 주말을 제외하므로 주말은 근무일이 아니며,
    // 급여 소정근로일 산정 시 제외 대상. (출근 기록이 있는 주말은 위에서 이미 근무로 처리됨)
    for (let d = 1; d <= endDay; d++) {
      const key = `${year}-${pad2(month)}-${pad2(d)}`;
      const dow = new Date(year, month - 1, d).getDay();
      if ((dow === 0 || dow === 6) && !dayMap[key] && !allHolidays[key]) {
        dayMap[key] = {
          status: "HOLIDAY", attendanceId: "", startTime: null, endTime: null,
          isFinalClosed: false, logCount: 0, traineeCount, holidayName: "주말",
        };
      }
    }

    // 배정 기간 내 + 오늘 이전 날짜 중 출근 기록 없는 날 → RED (주말·휴무는 위에서 dayMap에 있어 제외됨)
    if (assignment) {
      // ★KST 기준(월간 라우트·absentDays와 동일). UTC 변환은 시각값 저장 배정에서 하루 어긋나 RED가 밀렸다.
      const assignStart = getKstDateString(assignment.startDate);
      const assignEnd   = assignment.endDate
        ? getKstDateString(assignment.endDate)
        : todayStr;

      // 이 월에서 실제로 RED 처리할 범위
      const redFrom = assignStart > startDate ? assignStart : startDate;
      const redTo   = assignEnd   < todayStr  ? assignEnd   : todayStr; // 오늘 포함, 미래 제외

      // ★결근 억제 기준 = '선택(활성) 배정'의 출근기록일자만. 표시는 workerId 전체지만, 같은날 타현장(동시활성)
      //  기록이 선택현장의 실제 결근을 가리지 않도록 활성 배정 기록만으로 판정하고, 결근일이면 RED로 덮어쓴다.
      //
      // ⓘ [의도된 동작 — 캘린더 스코프 정책] 캘린더는 '선택(활성) 현장' 기준의 월 개요로, 셀이 날짜당 1개다.
      //   동시활성(오전A/오후B) 상태에서 어느 날 B만 출근·A는 결근이면, 캘린더는 그 셀을 RED(선택현장 A 결근)로
      //   덮어써 B의 출근 흔적을 캘린더에선 보이지 않게 한다. 이는 '선택현장 결근을 가리지 않는다'는 정책의 결과다.
      //   → 같은날 두 사실(B 출근 + A 결근)을 모두 봐야 하면 '출근부 검토(월별 리스트)' 화면을 쓴다(거기선 두 행 다 표시).
      //   두 화면의 결근 '판정' 로직은 동일(같은 활성배정·범위·휴무·existingDates); 표시 형태만 셀(1) vs 리스트(N)로 다르다.
      //   급여는 isFinalClosed 기록을 직접 집계하므로 이 표시 차이와 무관. (재감사 확정 P3, 사용자 확정=현상유지)
      const activeRecordDates = new Set(
        activeAsgId ? attendances.filter(a => a.assignmentId.toString() === activeAsgId).map(a => a.workDate) : [],
      );

      // 날짜 순회 — ★UTC 고정("Z"·getUTCDay·setUTCDate)으로 호스트 타임존 무관하게(lib/attendance/absentDays와 동일).
      //  로컬 파싱+toISOString 혼용 시 KST 호스트(로컬 dev)에서 key가 하루 밀려 RED가 엉뚱한 날에 찍히던 문제 방지.
      const cur = new Date(redFrom + "T00:00:00Z");
      const end = new Date(redTo   + "T00:00:00Z");
      while (cur <= end) {
        const key = cur.toISOString().slice(0, 10);
        const dow = cur.getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        // 활성 배정 기간 내 · 평일 · 휴무 아님 · 활성 배정 출근기록 없는 날 → RED(선택현장 결근).
        if (key >= startDate && key <= endDate && !isWeekend && !allHolidays[key] && !activeRecordDates.has(key)) {
          dayMap[key] = {
            status:        "RED",
            attendanceId:  "",
            startTime:     null,
            endTime:       null,
            isFinalClosed: false,
            logCount:      0,
            traineeCount,
          };
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    // ★월중 전환 시 '타 배정(ENDED 포함)' 커스텀 휴무 라벨을 빈 날에만 채운다(표시 전용).
    //  RED 합성 이후 실행 + dayMap 미존재 날에만 → 결근/기록을 덮지 않아 오억제·오귀속 없음.
    for (const r of otherHolidayRows) {
      // r.date<=todayStr: 미래 날짜엔 안 칠함 — 활성배정의 미래 근무일이 종료된 타현장 휴무로 오라벨링되는 것 방지.
      if (r.date >= startDate && r.date <= endDate && r.date <= todayStr && !dayMap[r.date]) {
        dayMap[r.date] = {
          status: "HOLIDAY", attendanceId: "", startTime: null, endTime: null,
          isFinalClosed: false, logCount: 0, traineeCount, holidayName: r.reason ?? "휴무",
        };
      }
    }

    const allDays = Object.values(dayMap);
    const totalWorkDays   = allDays.filter(d => d.startTime).length;
    const totalGreenDays  = allDays.filter(d => d.status === "GREEN").length;
    const totalOrangeDays = allDays.filter(d => d.status === "ORANGE").length;
    const totalRedDays    = allDays.filter(d => d.status === "RED").length;

    const totalHolidayDays = Object.values(dayMap).filter(d => d.status === "HOLIDAY").length;

    return NextResponse.json({
      success: true,
      data: {
        year, month,
        siteName:        assignment?.site?.companyName ?? null,
        assignmentStart: assignment?.startDate?.toISOString().slice(0, 10) ?? null,
        assignmentEnd:   assignment?.endDate?.toISOString().slice(0, 10)   ?? null,
        // 출퇴근 버튼 면제(자동기록·시프티 병행) 배정만 '출퇴근 없이 일괄 작성' 노출 대상.
        attendanceButtonExempt: assignment?.attendanceButtonExempt ?? false,
        // 조회 월 말일 기준 단계(전환일 반영). 일별 일지 종류는 작성 시점 API에서 해당일 기준으로 판정.
        trainingType: effectiveTrainingType(assignment?.serviceStep, assignment?.adaptationStartDate, endDate),
        days: dayMap,
        holidays: allHolidays,
        customHolidays,
        totalWorkDays,
        totalGreenDays,
        totalOrangeDays,
        totalRedDays,
        totalHolidayDays,
      },
    });
  } catch (error: any) {
    console.error("[worker/calendar]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
