// lib/payments/paidUsage.ts
// 환불정책 제3조 "유료 기능을 실질적으로 이용하지 않은 경우" 판정 — 결제주기 시작 이후
// 핵심 유료 산출물(공식문서 PDF 생성·전자 근로계약서·급여 실행) 생성 여부를 본다.
// 판정이 느슨한 쪽(미이용=전액 환불)은 소비자 유리 방향이라 안전.

import { prisma } from "@/lib/prisma";

export async function hasPaidUsageSince(agencyId: bigint, since: Date): Promise<boolean> {
  const [docVersions, contracts, payrollRuns] = await Promise.all([
    prisma.documentVersion.count({ where: { createdAt: { gte: since }, run: { agencyId } } }),
    prisma.employmentContract.count({ where: { agencyId, createdAt: { gte: since } } }),
    prisma.payrollRun.count({ where: { agencyId, createdAt: { gte: since } } }),
  ]);
  return docVersions + contracts + payrollRuns > 0;
}
