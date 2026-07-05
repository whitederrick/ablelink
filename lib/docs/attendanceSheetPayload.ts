// lib/docs/attendanceSheetPayload.ts
// 출근부(ATTENDANCE_SHEET) payload 단일 출처.
// ⚠️ 이전엔 동일 로직이 7곳(제출/워커·운영자 generate·preview/운영자 sign/감사ZIP)에 복제돼
//    근무시간·연장·1:多 규칙을 바꿀 때마다 7곳을 일일이 고쳐야 했고 드리프트(missedClockOut 누락 등)도 발생했다.
//    그 규칙 전부를 이 함수 하나로 모은다. 호출부는 식별자/서명만 넘긴다.
//
// 규칙(사용자 확정, 절대 변경 금지 — work_hours_rules 메모리):
//  · 일별 인정 지도시간 = 근무형태 기준 측정시간(dailyDocTimes.measHours, 전일 8 / 오전·오후 4.5~5.5). 워커 입력값 아님.
//  · 1:1 vs 1:多 = 현장(site) 배정 훈련생 수로 택1(1명→일반, 2명+→1:多). 둘 다 채우지 않음.
//  · 연장 = 일반 배정은 퇴근시각 자동(전일 저녁식사 1h 무급 제외), 면제 배정은 일지 수동입력.
//  · 보정대기(pending) = 퇴근 미실행(missedClockOut) 또는 급여 게이트(isPayrollPending) → 출근부에 시각·시간 미표기.

export const runtime = "nodejs";

import { prisma } from "@/lib/prisma";
import { buildDocFileName } from "@/lib/pdf/filename";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { isPayrollPending } from "@/lib/attendance/payrollGate";
import { overtimeMinutesForDay } from "@/lib/attendance/overtime";

function fmtHHMM(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}
function fmtDot(s: string) { return s.replace(/-/g, "."); }

// 근무형태/지도 관련 배정 필드(단일 배정 폴백 + 일별 배정 우선).
export interface AttendanceAssignmentFields {
  workType: string | null;
  commuteGuidanceIncluded: boolean | null;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  attendanceButtonExempt: boolean | null;
}

export interface AttendanceSheetSignatures {
  govAgent: { name: string; imageUrl: string | undefined };
  companyManager: { name: string; imageUrl: string | undefined };
  worker: { name: string; imageUrl: string | undefined };
}

export interface BuildAttendanceSheetArgs {
  workerId: bigint;
  start: string;                       // YYYY-MM-DD
  end: string;                         // YYYY-MM-DD
  siteId: bigint;
  companyName: string;
  workerName: string;
  workerPhone: string;
  /** 일별 배정(dailyAttendance.assignment)이 없을 때 쓰는 기본 배정 필드. */
  fallbackAssignment: AttendanceAssignmentFields;
  /** 서명은 호출 맥락마다 다름(제출=실서명, 미리보기·생성=공란 등) → 호출부가 결정. */
  signatures: AttendanceSheetSignatures;
}

export interface BuildAttendanceSheetResult {
  payload: any;
  fileName: string;
}

/**
 * 출근부 payload + 파일명 빌드(단일 출처).
 * dailyAttendance·traineePlacement 조회를 내부에서 수행하므로, 호출부는 식별자와 서명만 넘긴다.
 */
export async function buildAttendanceSheetPayload(
  args: BuildAttendanceSheetArgs,
): Promise<BuildAttendanceSheetResult> {
  const { workerId, start, end, siteId, companyName, workerName, workerPhone, fallbackAssignment, signatures } = args;

  // ★현장 필터 필수: 멀티현장 직무지도원이 같은 기간 다른 현장(B) 출근기록을 가지면
  //   siteId 필터가 없을 경우 이 현장(siteId=A) 출근부에 B현장 행이 섞인다(공단 문서 오염).
  //   DailyAttendance.siteId는 non-null(모든 생성경로 필수)이라 필터로 정상 행 누락 없음.
  const attendances = await prisma.dailyAttendance.findMany({
    where: { workerId, siteId, workDate: { gte: start, lte: end } },
    include: {
      logs: { select: { extTime1on1: true, extTimeGroup: true } },
      assignment: {
        select: {
          workType: true, commuteGuidanceIncluded: true,
          customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true,
        },
      },
    },
    orderBy: { workDate: "asc" },
  });

  // 1:1 vs 1:多 = "그 날짜에 이 현장(site)에 재적한 훈련생 수"로 날짜별 결정(워커 입력 아님).
  //  · 1명  → 그 날은 일반(1:1) 칸에 인정 지도시간
  //  · 2명+ → 그 날은 1:多 칸에 인정 지도시간
  // ★월 중 훈련생 수가 바뀌면(1→2명 등) 날짜마다 판정이 달라진다. 기간 단일값이 아니라 날짜별로 계산.
  // status 필터 없이 기간겹침으로만 집계 — 이탈 훈련생은 endDate로 표현되므로 과거기간 재생성도 정확.
  const placements = await prisma.traineePlacement.findMany({
    where: {
      siteId,
      startDate: { lte: new Date(end + "T23:59:59+09:00") },
      OR: [{ endDate: null }, { endDate: { gte: new Date(start + "T00:00:00+09:00") } }],
    },
    select: { startDate: true, endDate: true },
  });
  // 특정 날짜(yyyy-mm-dd, KST)에 재적(기간포함)한 훈련생 수가 2명 이상인지.
  const isMultiOnDate = (ymd: string): boolean => {
    const dayStart = new Date(ymd + "T00:00:00+09:00");
    const dayEnd   = new Date(ymd + "T23:59:59+09:00");
    let n = 0;
    for (const p of placements) {
      if (p.startDate <= dayEnd && (p.endDate == null || p.endDate >= dayStart)) {
        if (++n >= 2) return true;
      }
    }
    return false;
  };

  // 지각 인정 기준(분) = 현장값 ?? 위탁기관 기본값 ?? 30. 보정대기 게이트와 동일 기준.
  const siteRow: any = await prisma.site.findUnique({ where: { id: siteId }, select: { lateThresholdMin: true, agencyId: true } as any });
  let lateThresholdMin: number | null = siteRow?.lateThresholdMin ?? null;
  if (lateThresholdMin == null && siteRow?.agencyId) {
    const ag: any = await prisma.agency.findUnique({ where: { id: siteRow.agencyId }, select: { lateThresholdMin: true } as any });
    lateThresholdMin = ag?.lateThresholdMin ?? null;
  }
  const resolvedLateThreshold = lateThresholdMin ?? 30;

  const entries = attendances.map(a => {
    // 일별 배정 우선, 없으면 단일 배정 폴백.
    const af: AttendanceAssignmentFields = (a as any).assignment ?? fallbackAssignment;
    // 근무형태 인정 지도시간(전일 8 / 오전·오후 4.5~5.5) — dailyDocTimes 단일 출처.
    const recognizedHours = dailyDocTimes(
      af.workType, af.commuteGuidanceIncluded, af.customWorkStart, af.customWorkEnd,
    ).measHours;

    // 퇴근 미실행(퇴근 버튼 미실행·미확정) → 시각 미확정 → 출근부 '보정대기'.
    const missedClockOut = !a.endTime && !(af.attendanceButtonExempt ?? false);
    const pending = missedClockOut || isPayrollPending({
      actualStartTime: a.actualStartTime ?? null,
      actualEndTime: a.actualEndTime ?? null,
      payrollConfirmedAt: a.payrollConfirmedAt ?? null,
      workType: af.workType ?? null,
      commuteGuidanceIncluded: af.commuteGuidanceIncluded ?? null,
      customWorkStart: af.customWorkStart ?? null,
      customWorkEnd: af.customWorkEnd ?? null,
      exempt: af.attendanceButtonExempt ?? false,
    }, resolvedLateThreshold);
    const baseH = pending ? 0 : recognizedHours;
    // 연장 = 일반 배정은 퇴근시각 자동(전일 저녁식사 1h 제외), 면제 배정은 일지 수동입력.
    const extH = pending ? 0 : +(overtimeMinutesForDay({
      workType: af.workType,
      exempt: af.attendanceButtonExempt,
      actualEndTime: a.actualEndTime,
      commuteGuidanceIncluded: af.commuteGuidanceIncluded,
      customWorkStart: af.customWorkStart,
      customWorkEnd: af.customWorkEnd,
      manualExtHours: a.logs.reduce((s, l) => s + Number(l.extTime1on1) + Number(l.extTimeGroup), 0),
    }) / 60).toFixed(2);
    const multi = isMultiOnDate(a.workDate); // 그 날짜 기준 1:多 여부(날짜별)
    return {
      date: a.workDate,
      start: pending ? "" : (a.startTime ? fmtHHMM(a.startTime) : ""),
      end:   pending ? "" : (a.endTime   ? fmtHHMM(a.endTime)   : ""),
      pending,
      hours: baseH,                    // 총 지도시간(근무형태 인정시간)
      multiHours: multi ? baseH : 0,   // 1:多 지도(그 날 2인 이상 재적일 때만)
      _ext: extH,                      // 연장 지도시간(합계 집계용, 렌더 미사용)
      _multi: multi,                   // 날짜별 1:多 플래그(총계 분리용, 렌더 미사용)
    };
  });

  const baseTotal = entries.reduce((s, e) => s + Number(e.hours), 0);
  const extTotal  = entries.reduce((s, e) => s + Number(e._ext), 0);
  // 총계 1:1 vs 1:多 분리 = 날짜별 플래그로 각 날의 시간을 해당 버킷에 합산.
  const oneToManyBase = entries.reduce((s, e) => s + (e._multi ? Number(e.hours) : 0), 0);
  const oneToManyExt  = entries.reduce((s, e) => s + (e._multi ? Number(e._ext)  : 0), 0);

  const payload = {
    workerName,
    workerPhone,
    companyName,
    periodStartYMD: fmtDot(start),
    periodEndYMD:   fmtDot(end),
    totalDays: entries.length,
    totalHours: baseTotal + extTotal,
    weeklyHolidayCount: 0,
    monthlyLeaveCount: 0,
    allowanceTotalWon: "0",
    // 일반(1:1)·1:多는 날짜별 재적 훈련생 수로 각 날을 분리 합산(기간 단일값 아님).
    oneToOneHours:    baseTotal - oneToManyBase,
    oneToManyHours:   oneToManyBase,
    otOneToOneHours:  extTotal - oneToManyExt,
    otOneToManyHours: oneToManyExt,
    entries: entries.map(({ _ext, _multi, ...e }) => e),
    signatures: { govAgent: signatures.govAgent, companyManager: signatures.companyManager, worker: signatures.worker },
  };
  const fileName = buildDocFileName("ATTENDANCE_SHEET", { companyName, start, end });

  return { payload, fileName };
}
