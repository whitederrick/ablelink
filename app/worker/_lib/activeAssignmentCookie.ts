// app/worker/_lib/activeAssignmentCookie.ts
// 클라이언트에서 "오늘 근무 중인 현장(배정)" 선택 쿠키를 세팅하는 유틸(서버 의존 없음).
// 쿠키 이름은 서버 session.ts의 WK_ACTIVE_ASSIGNMENT_COOKIE와 일치해야 함.

export const WK_ACTIVE_ASSIGNMENT_COOKIE = "wk_active_assignment";

/** 선택 배정 쿠키 세팅(90일, 세션 쿠키와 동일 수명). 서버가 소유·활성 검증 후 적용. */
export function setActiveAssignmentCookie(assignmentId: string) {
  const maxAge = 60 * 60 * 24 * 90;
  document.cookie = `${WK_ACTIVE_ASSIGNMENT_COOKIE}=${assignmentId}; path=/; max-age=${maxAge}; samesite=lax`;
}
