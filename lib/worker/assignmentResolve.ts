// lib/worker/assignmentResolve.ts
// 워커 배정 해석 — 쿠키/딥링크로 넘어온 assignmentId를 "컨텍스트에 맞는 실제 배정"으로 해석하는 순수 로직.
// DB 무관: 라우트가 워커 배정을 KST 문자열로 정규화해 넘기면 결정만 반환한다(단위 테스트 가능).
//
// 왜 필요한가(회귀 방지):
//  - 낡은 wk_active_assignment 쿠키가 ENDED(종료)·미래 배정을 가리켜도 site/current가 그 배정을 그대로
//    돌려주면, 일지 화면이 종료된 현장에 고착돼 오늘 일지를 못 쓰는 데드엔드/오귀속이 발생했다.
//  - 반면 과거문서(docs) 재제출·수정요청 딥링크는 '의도적으로' ENDED 배정을 가리킨다(과거 출근부/일지).
//  → 목적을 분리한다: 일지류는 오늘 활성만(폴백), 과거문서는 명시 id면 ENDED 허용.

export type AssignmentStatus = "ASSIGNED" | "CONFIRMED" | "ACTIVE" | "ENDED" | (string & {});

export interface AssignmentLite {
  id: string; // 문자열로 정규화(bigint 직접 비교 회피)
  status: AssignmentStatus;
  startDate: string; // KST "YYYY-MM-DD"
  endDate: string | null; // KST "YYYY-MM-DD" 또는 null(무기한)
}

/** 오늘(KST) 실제 활성인가: status=ACTIVE + start<=today + (end==null || end>=today) */
export function isTodayActive(a: AssignmentLite, todayStr: string): boolean {
  return (
    a.status === "ACTIVE" &&
    a.startDate <= todayStr &&
    (a.endDate == null || a.endDate >= todayStr)
  );
}

/** 오늘 활성 배정 중 최신(startDate 내림차순 1건). 없으면 null. */
export function latestTodayActive(
  assignments: AssignmentLite[],
  todayStr: string,
): AssignmentLite | null {
  let best: AssignmentLite | null = null;
  for (const a of assignments) {
    if (!isTodayActive(a, todayStr)) continue;
    if (best == null || a.startDate > best.startDate) best = a;
  }
  return best;
}

export interface ResolveResult {
  assignmentId: string | null;
  /** 요청 id가 무시되고 폴백됐는가(관측/쿠키 되쓰기 판단용) */
  usedFallback: boolean;
  reason: "explicit-ended" | "explicit-active" | "fallback-active" | "none";
}

/**
 * 컨텍스트에 맞는 배정 해석.
 * @param requestedId 쿠키/딥링크로 온 assignmentId(문자열) 또는 null
 * @param allowEnded  true=명시 id의 ENDED(및 비활성) 허용(과거문서 딥링크). false=오늘 활성만(일지류)
 * @param assignments 워커 소유 배정 목록(라우트가 소유 검증 후 넘김)
 * @param todayStr    KST 오늘 "YYYY-MM-DD"
 */
export function resolveWorkerAssignment(opts: {
  requestedId: string | null;
  allowEnded: boolean;
  assignments: AssignmentLite[];
  todayStr: string;
}): ResolveResult {
  const { requestedId, allowEnded, assignments, todayStr } = opts;
  const requested =
    requestedId != null ? assignments.find((a) => a.id === requestedId) ?? null : null;

  if (requested) {
    if (allowEnded) {
      // 과거문서 딥링크: 소유만 확인되면 ENDED 포함 그대로(과거 출근부/일지 재제출·수정요청).
      return { assignmentId: requested.id, usedFallback: false, reason: "explicit-ended" };
    }
    if (isTodayActive(requested, todayStr)) {
      return { assignmentId: requested.id, usedFallback: false, reason: "explicit-active" };
    }
    // 일지 컨텍스트인데 요청 배정이 오늘 활성이 아님(ENDED/미래/미소유상태) → 아래 폴백으로.
  }

  const fallback = latestTodayActive(assignments, todayStr);
  if (fallback) {
    // 요청이 있었는데 폴백했으면 usedFallback=true(호출부가 쿠키를 되써 수렴시킬 신호로 사용).
    return { assignmentId: fallback.id, usedFallback: requestedId != null, reason: "fallback-active" };
  }
  return { assignmentId: null, usedFallback: false, reason: "none" };
}
