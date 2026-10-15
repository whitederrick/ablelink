# 작업 기록 2026-10-15 — 면제 배정 '퇴근 미실행' 원인 조사와 출근 API 면제 가드

## 1. 증상
파일럿 대상자(곽은하 님, worker#1 · 배정#2)는 출퇴근 기록 면제인데 10월 6일 "퇴근 미실행 1건"이 표시됨.

## 2. 조사 결과
| 항목 | 내용 |
|---|---|
| 판정 조건 | 과거 날짜 + WORKING + 미확정 + `actualStartTime`(실제 출근 버튼 시각) 있음 (`lib/worker/homeSummary.ts`) |
| 값의 출처 | `actualStartTime`을 쓰는 곳은 출근 API(`app/api/attendance/clock-in/route.ts`) 하나뿐 |
| 갭 | 출근 API가 면제 배정의 출근을 막지 않았음. 화면(`HomeClient.tsx`)만 버튼을 숨김 |
| 10/6 기록 | 16:52(KST) 버튼 출근 1회, 퇴근 없음 → 그날 밤 cron(`cron/daily`)이 `clockOutMissedAt` 플래그 |
| 타임라인 | 13:18 배정 등록(면제 true) → 14:30·16:45 파일럿 배정 수정(날짜만 변경) → 16:52 버튼 출근 |
| 다른 날 | 10/1·2·7·8·12~14 전부 cron 자동 생성(12:30~18:00). 10/5는 대체공휴일이라 기록 없음(정상) |

**미확정**: 16:52에 버튼이 화면에 보였던 이유. 직접 테스트 또는 오래된 화면(캐시)으로 추정되나 데이터로는 가려지지 않음.

## 3. 조치
1. **출근 API 면제 가드** — 면제 배정의 출근 요청은 `409 ATTENDANCE_EXEMPT`. 기존 검증 순서·문구는 유지하고 조건만 추가. 커밋 `8a3eb31`, push, `vercel --prod`(CLI 56.4.1) Ready.
2. **운영 DB 1행 정리**(사용자 허용 후 실행) — 10/6 근태: DONE · 12:30~18:00 · 확정, `actualStartTime`·`clockOutMissedAt` 비움. 조건은 `assignmentId=2 · workDate=2026-10-06 · WORKING · 미확정`으로 제한, 1건 갱신 확인.
3. **홈 화면 확인** — 곽은하 님 앱에서 출근 버튼 미노출을 사용자가 확인.

## 4. 점검
- `tsc --noEmit` 오류 0, `vitest` 57파일 601/601 통과
- 운영 데이터: 면제 배정의 미확정·버튼 기록·퇴근 미실행 행 0건, 과거 WORKING 미확정(면제 무관) 0건

## 5. 잔여·참고
- 잔여 작업 없음. 위 미확정 사항만 남음(재발은 서버 가드로 차단됨).
- 면제 관련 새 경로를 만들 때는 화면 숨김과 별개로 서버에서도 `attendanceButtonExempt`를 확인할 것.
- 운영 DB 작업 요령: `.env.prod.bak`은 70행 문법 오류로 `source` 불가 → `DATABASE_URL`만 추출해 `node --import tsx --input-type=module -e`로 실행. 프로젝트에 임시 파일을 만들지 않는다.
