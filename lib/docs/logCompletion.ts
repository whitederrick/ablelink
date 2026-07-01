// lib/docs/logCompletion.ts
// 일지(훈련일지) 완료 판정 단일 출처.
// 매니저 대시보드·근태목록과 워커 홈·캘린더·이력이 "일지 완료"를 동일 기준으로 판정하도록 통일한다.
//
// ★규칙: "그 출근일의 일지 완료" = 그 현장 배정 훈련생 전원이 각각 완료 일지를 작성.
//   (훈련생 수를 무시하고 logs.every(isCompleted)로 판정하면, 2명 담당 중 1명만 완료해도
//    '완료'로 잡혀 매니저는 완료·워커는 미완료로 어긋난다 — 감사 #8 배치 B에서 통일.)

export interface LogCompletionInput {
  isCompleted: boolean;
  traineeId: bigint | number | string | null;
}

/** 완료 일지가 있는 '서로 다른 훈련생' 수. */
export function completedTraineeCount(logs: LogCompletionInput[]): number {
  const set = new Set<string>();
  for (const l of logs) if (l.isCompleted && l.traineeId != null) set.add(String(l.traineeId));
  return set.size;
}

export type LogStatus = "none" | "draft" | "done";

/**
 * 일지 상태: 미작성(none)/임시저장(draft)/완료(done).
 * @param traineeCount 그 날 그 현장 배정 훈련생 수(전원 완료해야 done).
 */
export function logCompletionStatus(logs: LogCompletionInput[], traineeCount: number): LogStatus {
  if (!logs || logs.length === 0) return "none";
  if (traineeCount > 0) return completedTraineeCount(logs) >= traineeCount ? "done" : "draft";
  // 훈련생 수 정보가 없으면(0) 폴백: 작성된 일지가 모두 완료면 done.
  return logs.every((l) => l.isCompleted) ? "done" : "draft";
}

/** 그 출근일 일지가 완료(전원 작성 완료)인가. */
export function isDailyLogComplete(logs: LogCompletionInput[], traineeCount: number): boolean {
  return logCompletionStatus(logs, traineeCount) === "done";
}
