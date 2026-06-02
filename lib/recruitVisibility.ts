// lib/recruitVisibility.ts
// 마켓플레이스 공급측(워커) 공고 노출 게이트 — 관계기반 + 운영자 전체공개.
// 정책(2026-06-02 확정):
//  - 운영자(admin/공단·플랫폼) 공고(createdByAdminId != null)는 전체 직무지도원에게 노출.
//  - 에이전시 공고(agencyId != null)는 "그 에이전시로 1회 이상 배정 이력이 있는" 직무지도원에게만 노출.

import "server-only";
import { prisma } from "@/lib/prisma";

// worker가 배정 이력이 있는 에이전시 ID 집합(중복 제거)
export async function getWorkerAgencyIds(workerId: bigint): Promise<bigint[]> {
  const rows = await prisma.siteAssignment.findMany({
    where: { workerId, agencyId: { not: null } },
    select: { agencyId: true },
    distinct: ["agencyId"],
  });
  return rows.map((r) => r.agencyId).filter((x): x is bigint => x != null);
}

// 공고 목록 조회용 노출 조건(OR 절). status 등 다른 조건과 AND로 결합해 사용.
export function recruitVisibilityOr(agencyIds: bigint[]) {
  const or: any[] = [{ createdByAdminId: { not: null } }];
  if (agencyIds.length) or.push({ agencyId: { in: agencyIds } });
  return or;
}

// 단일 공고가 해당 worker에게 노출 가능한지(상세/신청 게이트용)
export function isPostVisibleToWorker(
  post: { createdByAdminId: bigint | null; agencyId: bigint | null },
  agencyIds: bigint[],
): boolean {
  if (post.createdByAdminId != null) return true; // 운영자 공고 = 전체 공개
  if (post.agencyId != null) return agencyIds.some((id) => id === post.agencyId);
  return false;
}
