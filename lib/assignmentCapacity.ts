// lib/assignmentCapacity.ts
// #7: finalize 슬롯별 정원 검사(순수 로직). 근무형태(AM/PM/FULL_DAY/CUSTOM)별로 독립 버킷을 강제한다.
//
//  · totalCap=0(현장이 정원을 하나도 설정하지 않음) → 무제한(하위호환·M7). 검사 없음(null).
//  · totalCap>0(정원 설정함) → 슬롯별 엄격. 슬롯 정원 0 = 그 형태 0명 허용(UI "0=해당 형태 불필요")이라
//    초과 선정을 막는다. 과거 총합 검사가 amCap만 있어도 PM/맞춤 인원을 통과시키던 #7을 종결.

import type { Prisma } from "@prisma/client";

export const CAPACITY_SLOTS = ["AM", "PM", "FULL_DAY", "CUSTOM"] as const;
export type CapacitySlot = (typeof CAPACITY_SLOTS)[number];

export type SlotOverflow = { slot: CapacitySlot; sel: number; remaining: number };

/** 슬롯별 정원 초과가 있으면 첫 초과 슬롯 정보를, 없으면 null 반환. */
export function findCapacityOverflow(
  capBySlot: Record<CapacitySlot, number>,
  filledBySlot: Record<string, number>,
  selBySlot: Record<string, number>,
): SlotOverflow | null {
  const totalCap = CAPACITY_SLOTS.reduce((t, s) => t + (capBySlot[s] ?? 0), 0);
  if (totalCap <= 0) return null; // 정원 미설정 현장 = 무제한
  for (const slot of CAPACITY_SLOTS) {
    const remaining = Math.max(0, (capBySlot[slot] ?? 0) - (filledBySlot[slot] ?? 0));
    const sel = selBySlot[slot] ?? 0;
    if (sel > remaining) return { slot, sel, remaining };
  }
  return null;
}

// ★단일 chokepoint(구조적 종결): 현장 슬롯 정원을 DB에서 읽어 초과 여부를 판정한다. ASSIGNED 배정을 생성/승격하는
//  모든 경로(직접배정·PATCH·respond·마켓 offers·recruit-applications)가 이 하나를 호출한다 — 경로마다 site 조회+
//  groupBy+findCapacityOverflow를 손으로 재작성하며 일부가 빠지던 '형제갭'을 원천 차단. 반드시 현장 락 안에서
//  호출해 TOCTOU를 막는다(호출부가 withSiteAndWorkersAssignmentLock 보유). 정원 미설정 현장은 null(무제한).
//  filled 집계는 물리 현장(siteId) 기준 — 공유현장의 물리 슬롯 총원을 센다.
//  · selBySlot: 이번에 새로 채우려는 슬롯별 인원(예: { FULL_DAY: 1 }).
//  · opts.excludeAssignmentId: 자기 자신 제외(PATCH가 기존 행의 workType을 바꿀 때 이중 집계 방지).
export async function checkSiteCapacity(
  tx: Prisma.TransactionClient,
  siteId: bigint,
  selBySlot: Record<string, number>,
  opts?: { excludeAssignmentId?: bigint },
): Promise<SlotOverflow | null> {
  const { capBySlot, filledBySlot } = await getSiteCapacityState(tx, siteId, opts);
  return findCapacityOverflow(capBySlot, filledBySlot, selBySlot);
}

/** 정원 상태 조회(chokepoint의 집계 부분). filled = 물리 현장(siteId) 기준 — 집계 기준을 여기 한 곳으로 고정한다.
 *  finalize처럼 초과 판정 외에 슬롯별 잔여/충족 표시가 필요한 호출부가 사용. 반드시 현장 락 안에서 호출. */
export async function getSiteCapacityState(
  tx: Prisma.TransactionClient,
  siteId: bigint,
  opts?: { excludeAssignmentId?: bigint },
): Promise<{ capBySlot: Record<CapacitySlot, number>; filledBySlot: Record<string, number> }> {
  const site = await tx.site.findFirst({
    where: { id: siteId },
    select: { amCapacity: true, pmCapacity: true, fullDayCapacity: true, customCapacity: true },
  });
  const capBySlot: Record<CapacitySlot, number> = {
    AM: site?.amCapacity ?? 0, PM: site?.pmCapacity ?? 0, FULL_DAY: site?.fullDayCapacity ?? 0, CUSTOM: site?.customCapacity ?? 0,
  };
  const filledGroups = await tx.siteAssignment.groupBy({
    by: ["workType"],
    where: {
      siteId,
      status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
      ...(opts?.excludeAssignmentId ? { id: { not: opts.excludeAssignmentId } } : {}),
    },
    _count: { _all: true },
  });
  const filledBySlot: Record<string, number> = {};
  for (const g of filledGroups) if (g.workType) filledBySlot[g.workType] = g._count._all;
  return { capBySlot, filledBySlot };
}
