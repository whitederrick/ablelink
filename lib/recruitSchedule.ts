// lib/recruitSchedule.ts
// 매칭 공고 신청 시 "현재 직무지도 기간"과의 일정 겹침 판정.
// 현재 직무지도 = 워커의 ACTIVE SiteAssignment 기간[startDate, endDate].
// endDate null(무기한) = [startDate, ∞) 으로 보아 이후 시작 공고도 겹침 처리(사용자 결정).

import { prisma } from "./prisma";
import { OCCUPYING_STATUSES } from "./assignmentOverlap";

const FAR_FUTURE = new Date(8640000000000000); // endDate 미정(무기한) 대용

/**
 * 공고 직무지도 기간[serviceStart, serviceEnd]이 워커의 진행 중(ACTIVE) 배정 기간과 겹치는지.
 * 기간이 하나라도 비어 있으면(과거 데이터 등) 판정하지 않음(false).
 */
export async function hasScheduleConflict(
  workerId: bigint,
  serviceStart: Date | null,
  serviceEnd: Date | null,
): Promise<boolean> {
  if (!serviceStart || !serviceEnd) return false;
  // E4: 수락(findTimeConflict)과 상태집합을 통일 — 공고는 FULL_DAY 서비스라 진행중 배정과 날짜가 겹치면
  //  수락 단계에서 어차피 충돌(409)한다. 신청 단계에서 ACTIVE만 보면 ASSIGNED/CONFIRMED/ACCEPTED 배정과의
  //  겹침을 놓쳐 "신청은 통과했는데 수락은 막히는" 불일치가 생김 → 같은 in-progress 집합으로 판정.
  const actives = await prisma.siteAssignment.findMany({
    where: { workerId, status: { in: [...OCCUPYING_STATUSES] } },
    select: { startDate: true, endDate: true },
  });
  // 구간 교집합: as <= pe && ps <= (ae ?? ∞)
  return actives.some(
    (a) => a.startDate <= serviceEnd && serviceStart <= (a.endDate ?? FAR_FUTURE),
  );
}
