// lib/docs/resolveDocAssignment.ts
// 문서(출근부·훈련일지·평가 등) 생성/미리보기 시 "어느 배정 기준인가"를 결정하는 단일 출처.
//  그동안 context·preview·generate·submit(buildDocPayload)이 제각기 다른 폴백을 갖고 있어(2곳만 폴백,
//  기준도 상이) 화면/미리보기/생성이 서로 다른 배정을 보는 drift가 있었다. 여기로 통일한다.
//
// 규칙:
//  1) 명시 배정(선택쿠키/딥링크 assignmentId)이 유효하면 그걸로 — 종료(ENDED)여도(과거 문서 재제출).
//  2) 명시가 없/무효면 폴백:
//     · 활성(ASSIGNED/CONFIRMED/ACTIVE) 배정이 정확히 1개 → 그걸로(모호성 0).
//     · 2개 이상 → 'ambiguous' — 조용히 아무거나 고르지 않는다(공식문서 오귀속 방지). 호출부가 현장 선택 유도.
//     · 0개 → 최근 종료(ENDED) 배정으로 폴백 — 계약 종료 직후 마지막 기간 마감서류를 셀프서비스로 만들 수 있게.
//            (없으면 'none'.)

import { prisma } from "@/lib/prisma";

const EXPLICIT_STATUSES = ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] as const;
const ACTIVE_STATUSES = ["ASSIGNED", "CONFIRMED", "ACTIVE"] as const;

export type ResolveDocAssignmentResult =
  | { status: "resolved"; assignment: any }
  | { status: "ambiguous"; activeCount: number }
  | { status: "none" };

/**
 * @param queryArgs prisma findFirst/findMany에 넘길 `select` 또는 `include`(둘 중 하나) — 호출부가 필요한 필드를 준다.
 */
export async function resolveDocAssignment(
  workerId: bigint,
  selAssignmentId: bigint | null,
  queryArgs: { select?: any; include?: any },
): Promise<ResolveDocAssignmentResult> {
  // 1) 명시 배정이 유효(소유+근무발생상태, ENDED 포함)하면 그대로.
  if (selAssignmentId != null) {
    const a = await prisma.siteAssignment.findFirst({
      where: { id: selAssignmentId, workerId, status: { in: [...EXPLICIT_STATUSES] } },
      ...queryArgs,
    });
    if (a) return { status: "resolved", assignment: a };
  }

  // 2) 폴백: 현재 활성 배정.
  const actives = await prisma.siteAssignment.findMany({
    where: { workerId, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { assignedAt: "desc" },
    ...queryArgs,
  });
  if (actives.length === 1) return { status: "resolved", assignment: actives[0] };
  if (actives.length >= 2) return { status: "ambiguous", activeCount: actives.length };

  // 3) 활성 0개 → 최근 종료 배정(마감서류용).
  const ended = await prisma.siteAssignment.findFirst({
    where: { workerId, status: "ENDED" },
    orderBy: [{ endedAt: "desc" }, { assignedAt: "desc" }],
    ...queryArgs,
  });
  if (ended) return { status: "resolved", assignment: ended };

  return { status: "none" };
}
