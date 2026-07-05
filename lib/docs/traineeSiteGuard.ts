// lib/docs/traineeSiteGuard.ts
// 문서(일지/평가/출근부) 생성 시 traineeId 소속 검증(IDOR 방지).
//
// 기존 검증은 "기관(agencyId) 소속"까지만 확인했다. 같은 기관의 다른 현장 훈련생 ID를
// 주입하면 이름/평가/일지가 다른 현장 문서에 섞일 여지가 있었다.
// → assignment.siteId + 문서 기간에 겹치는 TraineePlacement 기준으로 강화한다.
//   (TraineePlacement 는 출근부 1:多 집계에서도 현장+기간 재적 판정에 쓰는 단일 사실 출처)

import { prisma } from "@/lib/prisma";

/**
 * traineeId 가 해당 현장(siteId)에 문서 기간([start, end])과 겹치는
 * 재적 이력(TraineePlacement)을 가진 훈련생인지 검증한다.
 *
 * 기간 겹침: placement.startDate ≤ end AND (placement.endDate = null OR endDate ≥ start)
 * 이탈 훈련생은 endDate 로 표현되므로 과거 기간 문서 재생성 시에도 그때 재적이던 인원이 잡힌다.
 *
 * @returns 검증 통과 시 { id, name }, 미재적/타현장/조작이면 null
 */
export async function findTraineeAtSiteInPeriod(
  traineeId: bigint,
  siteId: bigint,
  start: string, // yyyy-mm-dd (KST)
  end: string,   // yyyy-mm-dd (KST)
): Promise<{ id: bigint; name: string } | null> {
  const placement = await prisma.traineePlacement.findFirst({
    where: {
      traineeId,
      siteId,
      startDate: { lte: new Date(end + "T23:59:59+09:00") },
      OR: [{ endDate: null }, { endDate: { gte: new Date(start + "T00:00:00+09:00") } }],
    },
    select: { trainee: { select: { id: true, name: true } } },
  });
  return placement?.trainee ?? null;
}
