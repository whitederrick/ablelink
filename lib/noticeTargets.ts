// lib/noticeTargets.ts
// 알림 수신 대상 검증 공용 헬퍼 — 요청 workerIds 중 '내 기관 활성 배정' 워커만 dedupe해 반환.
// 크로스테넌트 방지 규칙의 단일 소스(/api/admin/notices INDIVIDUAL·notice-groups 저장이 공용).

import { prisma } from "@/lib/prisma";
import { parseBigInt } from "@/lib/adminScope";

export const NOTICE_ACTIVE_STATUSES = ["ASSIGNED", "CONFIRMED", "ACTIVE"] as const;

export async function filterAgencyWorkers(agencyId: bigint, requested: unknown): Promise<bigint[]> {
  const ids = (Array.isArray(requested) ? requested : [])
    .map((id: unknown) => parseBigInt(id)).filter((id): id is bigint => id !== null);
  if (ids.length === 0) return [];
  const valid = await prisma.siteAssignment.findMany({
    where: { agencyId, workerId: { in: ids }, status: { in: [...NOTICE_ACTIVE_STATUSES] } },
    select: { workerId: true },
  });
  return [...new Map(valid.map(a => [a.workerId.toString(), a.workerId])).values()];
}
