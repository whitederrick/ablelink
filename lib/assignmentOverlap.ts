// lib/assignmentOverlap.ts
// 멀티현장 배정 시간겹침 검증 — 같은 날 근무형태가 시간상 겹치는 2배정 방지.
//
// 근무형태별 표준시각(computeWorkTimes)은 출퇴근지도 padding 때문에 AM(…~14:00)·PM(12:30~…)이
// 의도적으로 겹친다. 따라서 시각 구간 교집합으로 판정하면 정상 패턴(AM+PM 멀티현장)을 오탐한다.
// → 반나절 슬롯 점유(AM/PM)로 판정한다:
//   · AM        → {AM}
//   · PM        → {PM}
//   · FULL_DAY  → {AM, PM}
//   · CUSTOM    → 시각이 정오(13:00) 이전이면 AM, 이후면 PM(양쪽 걸치면 둘 다)
// 두 배정의 날짜범위가 겹치고(공유일 존재) 슬롯이 겹치면 시간충돌.
//   예) 한 현장 오전(AM) + 다른 현장 종일(FULL_DAY) → {AM} ∩ {AM,PM} ≠ ∅ → 충돌
//       한 현장 오전(AM) + 다른 현장 오후(PM)      → {AM} ∩ {PM} = ∅   → 정상

export type Half = "AM" | "PM";

const NOON_MIN = 13 * 60; // AM/PM 분기 기준(13:00)

function toMin(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 근무형태 → 점유 반나절 슬롯 집합. */
export function occupiedHalves(
  workType: string | null | undefined,
  customWorkStart?: string | null,
  customWorkEnd?: string | null,
): Set<Half> {
  switch (workType) {
    case "AM": return new Set<Half>(["AM"]);
    case "PM": return new Set<Half>(["PM"]);
    case "FULL_DAY": return new Set<Half>(["AM", "PM"]);
    case "CUSTOM": {
      const s = toMin(customWorkStart), e = toMin(customWorkEnd);
      const out = new Set<Half>();
      if (s == null || e == null || e <= s) return new Set<Half>(["AM", "PM"]); // 불명확 → 종일로 간주(보수적)
      // e>s 보장 → s<정오면 AM, 아니면(s>=정오) e>s>=정오라 PM. 항상 1개 이상이라 빈 집합 폴백은 도달 불가.
      if (s < NOON_MIN) out.add("AM");
      if (e > NOON_MIN) out.add("PM");
      return out;
    }
    default: return new Set<Half>(["AM", "PM"]); // 미지정 → 종일(보수적)
  }
}

export interface AssignmentSlot {
  workType?: string | null;
  customWorkStart?: string | null;
  customWorkEnd?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
}

/** 두 날짜범위가 하루라도 겹치는가(endDate=null=열린 배정). */
export function dateRangesOverlap(a: AssignmentSlot, b: AssignmentSlot): boolean {
  const toT = (v: Date | string | null | undefined, fallback: number): number => {
    if (v == null) return fallback;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? fallback : t;
  };
  const aStart = toT(a.startDate, -Infinity), aEnd = toT(a.endDate, Infinity);
  const bStart = toT(b.startDate, -Infinity), bEnd = toT(b.endDate, Infinity);
  return aStart <= bEnd && bStart <= aEnd;
}

function halvesIntersect(a: Set<Half>, b: Set<Half>): boolean {
  for (const h of a) if (b.has(h)) return true;
  return false;
}

/** 두 배정이 시간충돌(날짜범위 겹침 + 반나절 슬롯 겹침)인가. */
export function assignmentsTimeConflict(a: AssignmentSlot, b: AssignmentSlot): boolean {
  if (!dateRangesOverlap(a, b)) return false;
  return halvesIntersect(
    occupiedHalves(a.workType, a.customWorkStart, a.customWorkEnd),
    occupiedHalves(b.workType, b.customWorkStart, b.customWorkEnd),
  );
}

/**
 * candidate 와 시간충돌하는 기존 배정을 반환(없으면 null).
 * existing 은 호출부가 조회한 "같은 워커의 진행중(ASSIGNED/CONFIRMED/ACTIVE) 배정"(candidate 자신 제외).
 * (helper 를 순수 유지해 테스트 가능하게 — prisma 조회는 라우트가 담당)
 */
export function findTimeConflict<T extends AssignmentSlot>(
  candidate: AssignmentSlot,
  existing: T[],
): T | null {
  for (const e of existing) {
    if (assignmentsTimeConflict(candidate, e)) return e;
  }
  return null;
}
