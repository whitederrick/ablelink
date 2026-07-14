// lib/attendance/ownership.ts
// ★단일 소스(구조적 종결): 근태(DailyAttendance)의 위탁기관 소유권 판정.
//
//  근태의 실귀속 = assignment.agencyId(SiteAssignment 생성 시 설정, 배정 파이프라인의 소유 기관).
//  Site.agencyId는 "현재 운영 주체 참고용"이며 nullable·공유현장(물리 placeId 중복) 가능이라 소유권 판정에
//  쓰면 크로스테넌트로 샌다(매니저 A가 공유현장의 매니저 B 워커 근태를 조작). 목록·읽기 라우트는 이미
//  assignment.agencyId로 스코프하므로, 쓰기/액션 라우트도 반드시 이 헬퍼를 통해 동일 기준으로 판정한다.
//  → 라우트마다 where를 손으로 짜며 일부가 site.agencyId로 새던 '형제갭'을 원천 차단(단일 소스).

import type { Prisma } from "@prisma/client";

/** 근태 소유권 where 조각. `where: { id, ...ownedAttendanceWhere(agencyId) }` 형태로 합성한다. */
export function ownedAttendanceWhere(agencyId: bigint): Prisma.DailyAttendanceWhereInput {
  return { assignment: { agencyId } };
}
