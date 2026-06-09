// lib/pdf/dailyDocTimes.ts
// 일지 PDF(지원고용 훈련일지·취업 후 적응지도 일지)에 들어가는 "근무형태 기준 고정 시간값" 단일 출처.
// - 훈련시간/측정시간/근무시간(범위)/출퇴근·휴게 지도 Y/N 를 근무형태로 결정.
// - 실제 출퇴근(버튼) 시각이나 워커가 입력한 측정시간은 PDF에 쓰지 않는다(별도 관리).
//
// 규칙(2026-06-09 사용자 정의, 추후 변경 가능):
//  · 오전/오후 = 4H 근무, 전일 = 8H 근무, 커스텀 = (종료-시작)H
//  · 출퇴근지도(commute) 있으면: 측정시간 = 근무 + 1.5H(출퇴근 30+30 + 휴게 30), 근무범위 = 시작-30 ~ 종료+30
//  · 출퇴근지도 없으면(전일 등): 가산 없음, 근무범위 = 시작 ~ 종료
//  · 전일(FULL_DAY)은 항상 출퇴근지도 없음(8H 고정)

type Base = { h: number; start: string; end: string };

const BASE: Record<string, Base> = {
  AM:       { h: 4, start: "09:00", end: "13:00" },
  PM:       { h: 4, start: "13:00", end: "17:00" },
  FULL_DAY: { h: 8, start: "09:00", end: "18:00" },
};

function toMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function fromMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function shift(hhmm: string, deltaMin: number): string {
  const t = toMin(hhmm);
  return t == null ? hhmm : fromMin(t + deltaMin);
}
function fmtH(h: number): string {
  // 4 → "4H", 5.5 → "5.5H"
  return `${Number.isInteger(h) ? String(h) : String(h)}H`;
}

export type DailyDocTimes = {
  trainingTimeH: string;  // 훈련시간 (예: "4H")
  measTimeH: string;      // 수행정도 아래 측정시간 (예: "5.5H")
  workTimeRange: string;  // 근무시간 범위 (예: "08:30~13:30")
  guidanceYN: "Y" | "N";  // 출퇴근·휴게 지도 여부
};

export function dailyDocTimes(
  workType: string | null | undefined,
  commuteGuidanceIncluded: boolean | null | undefined,
  customWorkStart?: string | null,
  customWorkEnd?: string | null,
): DailyDocTimes {
  let base: Base;
  if (workType === "CUSTOM" && customWorkStart && customWorkEnd) {
    const s = toMin(customWorkStart), e = toMin(customWorkEnd);
    const dur = s != null && e != null && e > s ? (e - s) / 60 : 0;
    base = { h: dur, start: customWorkStart, end: customWorkEnd };
  } else {
    base = BASE[workType ?? ""] ?? BASE.FULL_DAY;
  }

  // 전일은 항상 출퇴근지도 없음. 그 외는 등록된 commute 여부.
  const commute = (workType === "FULL_DAY") ? false : Boolean(commuteGuidanceIncluded);

  const measH = base.h + (commute ? 1.5 : 0);
  const range = commute
    ? `${shift(base.start, -30)}~${shift(base.end, 30)}`
    : `${base.start}~${base.end}`;

  return {
    trainingTimeH: fmtH(base.h),
    measTimeH: fmtH(measH),
    workTimeRange: range,
    guidanceYN: commute ? "Y" : "N",
  };
}
