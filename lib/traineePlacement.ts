// lib/traineePlacement.ts
// 훈련생 현장배치 이력(TraineePlacement) 유지 헬퍼 — 단일 소스.
// ⚠️ 이 테이블은 급여(1:1 vs 1:多 배율)·출근부(1:1/1:多 표기)·훈련생 목록·캘린더가 "그 시점 현장 인원"을
//    계산하는 근거다. 과거엔 읽기만 4곳 있고 쓰기가 없어 항상 0 → 급여/문서 무증상 오작동이었음.
//    훈련생 생성·상태변경 시 반드시 이 헬퍼로 배치 이력을 남긴다.
//
// 규칙:
//  - 재적(status TRAINING/EMPLOYED) = ACTIVE 배치(endDate null).
//  - 이탈(DROPOUT/PAUSED) = 열린 ACTIVE 배치를 endDate + 상태(DROPOUT/PAUSED)로 마감.
//  - "그 시점 현장 인원" = ACTIVE + 기간겹침(startDate<=날짜 && (endDate null || endDate>=날짜)).

import type { Prisma, PrismaClient, TraineeStatus, TraineePlacementStatus } from "@prisma/client";

// prisma 또는 트랜잭션 클라이언트 모두 허용
type Db = PrismaClient | Prisma.TransactionClient;

/** 훈련생이 현재 활동 중(현장 재적)인 상태인가 */
export function isActiveTraineeStatus(s: TraineeStatus | string): boolean {
  return s === "TRAINING" || s === "EMPLOYED";
}

// ── 1:1 vs 1:多 판정(단일 규칙) ─────────────────────────────────────
// 출근부(attendanceSheetPayload)와 급여(computeRun)가 각각 구현하던 "그 날짜 동시 재적 수"를 통일.
//  경계 의미가 갈리면 공식문서와 급여가 어긋나므로 단일 함수로 계산한다.
//  status 필터 없음 — 이탈은 endDate로 표현되므로 과거기간 재계산도 그때 재적이 정확.
export interface PlacementSpan {
  siteId?: bigint | number | string | null;
  startDate: Date;
  endDate: Date | null;
}

/** 특정 날짜(KST yyyy-mm-dd)에 기간겹침으로 재적한 배치 수. siteId 지정 시 그 현장만 집계. */
export function traineeCountOnDate(placements: PlacementSpan[], ymd: string, siteId?: bigint | null): number {
  const dayStart = new Date(ymd + "T00:00:00+09:00");
  const dayEnd   = new Date(ymd + "T23:59:59+09:00");
  let n = 0;
  for (const p of placements) {
    if (siteId != null && p.siteId != null && String(p.siteId) !== String(siteId)) continue;
    if (p.startDate <= dayEnd && (p.endDate == null || p.endDate >= dayStart)) n++;
  }
  return n;
}

/** 그 날짜에 2명 이상 동시 재적 = 1:多. */
export function isMultiTraineeOnDate(placements: PlacementSpan[], ymd: string, siteId?: bigint | null): boolean {
  return traineeCountOnDate(placements, ymd, siteId) >= 2;
}

/** 열린 ACTIVE 배치가 없으면 새로 연다(중복 방지). 이미 열려 있으면 그대로 둔다. */
export async function openTraineePlacement(db: Db, traineeId: bigint, siteId: bigint, startDate: Date): Promise<void> {
  const existing = await db.traineePlacement.findFirst({
    where: { traineeId, siteId, status: "ACTIVE", endDate: null },
    select: { id: true },
  });
  if (existing) return;
  await db.traineePlacement.create({
    data: { traineeId, siteId, startDate, status: "ACTIVE" },
  });
}

/** 해당 훈련생의 열린 ACTIVE 배치를 모두 마감(endDate + 상태). */
export async function closeTraineePlacements(
  db: Db, traineeId: bigint, endDate: Date, status: Extract<TraineePlacementStatus, "COMPLETED" | "DROPOUT" | "PAUSED">
): Promise<void> {
  await db.traineePlacement.updateMany({
    where: { traineeId, status: "ACTIVE", endDate: null },
    data: { endDate, status },
  });
}

/** 훈련생 상태 변경에 맞춰 배치 이력 동기화.
 *  - 활성(TRAINING/EMPLOYED)로 전환/유지: 현재 현장에 ACTIVE 배치 보장.
 *  - 이탈(DROPOUT/PAUSED): 열린 배치 마감. */
export async function syncPlacementForStatus(
  db: Db, traineeId: bigint, newStatus: TraineeStatus | string, currentSiteId: bigint | null, at: Date
): Promise<void> {
  if (isActiveTraineeStatus(newStatus)) {
    if (currentSiteId != null) await openTraineePlacement(db, traineeId, currentSiteId, at);
  } else {
    const st: "DROPOUT" | "PAUSED" = newStatus === "PAUSED" ? "PAUSED" : "DROPOUT";
    await closeTraineePlacements(db, traineeId, at, st);
  }
}
