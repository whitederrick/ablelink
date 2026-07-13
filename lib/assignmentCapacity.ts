// lib/assignmentCapacity.ts
// #7: finalize 슬롯별 정원 검사(순수 로직). 근무형태(AM/PM/FULL_DAY/CUSTOM)별로 독립 버킷을 강제한다.
//
//  · totalCap=0(현장이 정원을 하나도 설정하지 않음) → 무제한(하위호환·M7). 검사 없음(null).
//  · totalCap>0(정원 설정함) → 슬롯별 엄격. 슬롯 정원 0 = 그 형태 0명 허용(UI "0=해당 형태 불필요")이라
//    초과 선정을 막는다. 과거 총합 검사가 amCap만 있어도 PM/맞춤 인원을 통과시키던 #7을 종결.

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
