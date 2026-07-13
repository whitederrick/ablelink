// lib/worker/agencyScope.ts
// 워커↔위탁기관 '소속' 판정 단일 소스. 크로스테넌트 조작(계정탈취·PII/계좌열람·직접배정·계약)을 막는 관문들이
// 전부 이 한 정의를 쓰도록 중앙화한다. (과거: 계약 경로에만 CONSENTED 규칙을 넣고 형제 라우트(workers/[id]·
// worker-accounts·verify-*)엔 status 필터 없는 assignments.some({site:{agencyId}})를 남겨 P0가 났음.)
import { prisma } from "@/lib/prisma";

// 워커가 이 기관과 '실제 관계'를 맺은 배정 상태 — 동의(수락)/근무/과거근무만 인정.
//  REQUESTED(매니저 일방 요청·워커 미수락)·REJECTED(거절)·EXPIRED(무응답)·DROPPED(탈락)은 관계로 치지 않는다.
//  이들을 인정하면 매니저가 타 기관 워커에게 일방 REQUESTED만 생성해 '내 소속'으로 위장할 수 있다.
export const CONSENTED_ASSIGN_STATUSES = ["ACCEPTED", "ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] as const;

// 워커가 이 기관 소속인가 — 계약 이력이 있거나, 이 기관 현장에 '수락/근무한' 배정이 있으면 소속.
//  민감작업(비번초기화·PII/계좌 열람·본인/계좌인증·수정·직접배정·계약 발행)의 공용 스코프 게이트.
export async function workerBelongsToAgency(workerId: bigint, agencyId: bigint): Promise<boolean> {
  const hit = await prisma.worker.findFirst({
    where: {
      id: workerId,
      OR: [
        { employmentContracts: { some: { agencyId } } },
        { assignments: { some: { site: { is: { agencyId } }, status: { in: [...CONSENTED_ASSIGN_STATUSES] } } } },
      ],
    },
    select: { id: true },
  });
  return !!hit;
}
