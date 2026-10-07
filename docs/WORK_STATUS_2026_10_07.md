# 작업 상태 — 2026-10-07 세션

임시저장한 일지가 "저장 안 된 것처럼" 보이던 버그 수정 + 같은 유형(기존 일지 조용한 덮어쓰기) 점검·차단. **3커밋 전부 push·`vercel --prod` 배포(Production Ready)·운영 200 확인. 마이그레이션 없음.** ★운영 화면 실조작 확인은 미실시(사용자 확인 대기).

## 1) 임시저장 재진입 시 빈 폼 — `d5bf5b3`

- **증상**: 일지 임시저장 후 다시 열면 빈 폼 → 저장이 안 된 것처럼 보임.
- **원인**: 임시저장은 서버에 정상 저장됨. 그러나 진입점들이 **완료된 일지만 `logId`(수정 모드)로 연결**해서 임시저장본은 빈 신규 폼으로 열렸고, localStorage 임시본은 저장 성공 직후 지워져 복구 불가.
- **수정**: `lib/worker/homeSummary.ts`(홈 `logIdByTraineeId`에 임시저장 포함, `loggedTraineeIds`는 완료만) · `lib/worker/missingLogs.ts`(트레이니에 `draftLogId` 추가, 미작성 판정은 완료 기준 그대로) · `app/worker/logs/missing/page.tsx`(draftLogId→logId).

## 2) 캘린더 동일 버그 — `6a4c6e6`

- `app/api/worker/calendar/route.ts`: 배지 `logId`를 임시저장 포함 전체 로그에서 산출(`completed`는 완료 기준 불변).

## 3) 기존 일지 조용한 덮어쓰기 차단 — `3d75d99`

- **단건 저장** `api/worker/logs/save`: `logId` 없이 같은 (훈련생, 출근기록) 일지가 있으면 409 `LOG_EXISTS` → `worklog/page.tsx`가 confirm 후 `overwrite:true` 재전송. 취소 시 입력 유지. 저장 성공 후 이동 대기 중 버튼 재클릭 방지(`disabled={saving||saved}`).
- **일괄 저장** `api/worker/logs/batch-save`: 덮어쓸 일지가 있으면 쓰기(출근기록 생성 포함) **이전에** 409 `OVERWRITE_CONFIRM`+conflicts → `worklog/batch/page.tsx`가 날짜·훈련생·상태 목록(8건+외 N건) confirm 후 `overwrite:true` 재전송. 취소 시 부작용 0. (★`onClick={() => submitAll()}` — 이벤트가 overwrite로 전달되면 안 됨)

## 점검했으나 문제 없던 곳
일지 목록·검토 화면·매니저/운영자 화면·월별 확정(임시저장을 "임시저장"으로 구분), history(별도 `logCompletionStatus`).

## 검증
tsc 0 · vitest 478/478 · 배포 Ready·운영 200. **미검증**: 운영 실조작(임시저장→홈 재진입 이어쓰기, 단건/일괄 덮어쓰기 확인창).

## 잔여 / 참고
- 사용자 실조작 확인 결과 통보 대기.
- 다른 작성자(writer)가 쓴 같은 (훈련생, 출근기록) 일지도 `save`의 findFirst가 writerId 필터 없이 잡음 — 이번 범위 밖(미변경).
