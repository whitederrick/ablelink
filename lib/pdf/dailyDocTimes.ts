// lib/pdf/dailyDocTimes.ts
// 일지 PDF(지원고용 훈련일지·취업 후 적응지도 일지)에 들어가는 "근무형태 기준 고정 시간값" 단일 출처.
// - 훈련시간/측정시간/근무시간(범위)/출퇴근·휴게 지도 Y/N 를 근무형태로 결정.
// - 실제 출퇴근(버튼) 시각이나 워커가 입력한 측정시간은 PDF에 쓰지 않는다(별도 관리).
//
// 규칙(2026-06-09 사용자 정의, 추후 변경 가능):
//  · 근무시간 범위(workTimeRange)는 lib/workSchedule.computeWorkTimes 단일 출처를 그대로 사용.
//    → 출근부 출퇴근 시각과 일지 근무시간이 항상 동일(AM 08:30~13:30 / PM 12:30~17:30 / 전일 09:00~18:00).
//  · 오전/오후 = 4H 훈련, 전일 = 8H 훈련, 커스텀 = (종료-시작)H
//  · 출퇴근지도(commute) 있으면: 측정시간 = 훈련 + 1.5H(출퇴근 30+30 + 휴게 30)
//  · 전일(FULL_DAY)은 항상 출퇴근지도 없음(8H 고정)

import { computeWorkTimes } from "@/lib/workSchedule";

function toMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function fmtH(h: number): string {
  // 4 → "4H", 5.5 → "5.5H"
  return `${Number.isInteger(h) ? String(h) : String(h)}H`;
}

export type DailyDocTimes = {
  trainingTimeH: string;  // 훈련시간 (예: "4H")
  measTimeH: string;      // 출근부 인정 지도시간 (예: "5.5H") — ★직무지도원 관점
  trainingHours: number;  // 훈련시간 숫자값 (예: 4)
  measHours: number;      // 측정(인정) 시간 숫자값 (예: 5.5) — ★직무지도원 관점
  workTimeRange: string;  // 근무시간 범위 (예: "08:30~13:30")
  guidanceYN: "Y" | "N";  // 출퇴근·휴게 지도 여부
  traineeMeasTimeH: string;  // 일지 '수행정도(측정시간)' 기본값 (예: "4.5H") — ★장애인 관점
  traineeMeasHours: number;  // 위 숫자값 (예: 4.5)
};

export function dailyDocTimes(
  workType: string | null | undefined,
  commuteGuidanceIncluded: boolean | null | undefined,
  customWorkStart?: string | null,
  customWorkEnd?: string | null,
): DailyDocTimes {
  // 전일은 항상 출퇴근지도 없음. 그 외는 등록된 commute 여부.
  const commute = (workType === "FULL_DAY") ? false : Boolean(commuteGuidanceIncluded);

  // 근무시간 범위 = 출근부와 동일한 단일 출처(workSchedule).
  const wt = computeWorkTimes(workType, commute, customWorkStart, customWorkEnd);

  // 훈련시간: 오전/오후 4H, 전일 8H, 커스텀 = (종료-시작)H.
  let trainH: number;
  if (workType === "CUSTOM") {
    const s = toMin(wt.start), e = toMin(wt.end);
    trainH = s != null && e != null && e > s ? (e - s) / 60 : 0;
  } else if (workType === "FULL_DAY") {
    trainH = 8;
  } else {
    trainH = 4; // AM / PM
  }

  // 측정(인정)시간 = 훈련시간 + 휴게/출퇴근 지도시간.
  //  · 전일(FULL_DAY): 8H 고정(출퇴근·휴게 지도 미포함, 점심은 별도 무급).
  //  · 오전/오후(AM/PM): 휴게지도 0.5H 항상 포함 + 출퇴근지도(앞30+뒤30=1H) 인정 시 추가.
  //      → 인정 5.5H(08:30~14:00 / 12:30~18:00), 미인정 4.5H(09:00~13:30 / 13:00~17:30).
  //  · 커스텀(CUSTOM): 관리자 지정 창 기준(기존 동작 유지, commute 시 +1.5).
  let extraH: number;
  if (workType === "FULL_DAY") extraH = 0;
  else if (workType === "CUSTOM") extraH = commute ? 1.5 : 0;
  else extraH = 0.5 + (commute ? 1.0 : 0); // AM / PM
  const measH = trainH + extraH;

  // 일지 '수행정도(측정시간)' 기본값 = ★장애인(훈련생)이 실제 근무한 시간 (사용자 확정 2026-08-22).
  //  위 measH 는 **직무지도원 관점**의 인정 지도시간(출퇴근지도 1H 포함 → AM/PM 5.5)이고 출근부·급여의
  //  기준이라 절대불변이다(work_hours_rules 2026-06-18). 일지는 관점이 달라 값도 다르다 —
  //  일지를 쓰는 순간의 주어는 장애인이므로 출퇴근지도 시간은 들어가지 않는다.
  //   · 오전/오후 = 근무 4H + 휴게 0.5H = 4.5H
  //   · 전일      = 8H (근로시간 상한이라 휴게를 더해 8을 넘길 수 없다)
  //   · 커스텀    = 지정 창 그대로(종료-시작)
  //  ★이 값은 어디까지나 **기본값(프리필)** 이다. 직무지도원이 입력한 값이 있으면 그 값이 그대로 일지에 나간다.
  const traineeMeasH =
    workType === "FULL_DAY" ? 8
    : workType === "CUSTOM" ? trainH
    : trainH + 0.5; // AM / PM

  return {
    trainingTimeH: fmtH(trainH),
    measTimeH: fmtH(measH),
    trainingHours: trainH,
    measHours: measH,
    workTimeRange: `${wt.start}~${wt.end}`,
    guidanceYN: commute ? "Y" : "N",
    traineeMeasTimeH: fmtH(traineeMeasH),
    traineeMeasHours: traineeMeasH,
  };
}
