# 운영 리스크 전수 검사 (2026-07-09)

다중 에이전트 워크플로우(8 클래스 병렬 헌트 + 적대적 검증). **26건 발견 → 21건 확정**(false positive 5건 제거).
기준: master `8136475`. 이미 방어된 패턴(resolveDocAssignment·advisory lock·멱등 claim·isFinalClosed)은 제외.

## 🔴 관통 테마 — 멀티 현장 선택 배정 미반영 (오늘 고친 stale-cookie와 동일 클래스, 6곳)
`wk_active_assignment`(선택 배정)를 무시하고 "최신 ACTIVE 배정 1개" 또는 "workerId 전체"로 조회 → 멀티 현장 워커에게 엉뚱한 현장 기준 데이터/쓰기.
- holidays(POST/DELETE) · calendar · attendance/monthly · logs/save(findOrCreateAttendance) — 아래 개별 항목.

---

## P1 (1)
1. **reset-password 발송 전 계정 변경 → 미설정 환경 계정 잠김(거짓 성공)** `app/api/worker/auth/reset-password/route.ts:69`
   - KAKAO_RESET_PW_TEMPLATE_CODE(운영 미등록 명시) 또는 RESEND 미설정 시: 새 임시비번 저장+isTemporary+sessionVersion+1(전세션 로그아웃)을 **먼저** 하고 발송은 안 됨 → 옛비번 무효+새비번 미전달+세션종료 = 완전 로그인 불가. 그런데 success:true '발송했습니다' 반환.
   - **수정**: P2-11 register 패턴 — 발송 채널 가용/성공 확인 후에만 계정 변경. 폰=알림톡 미설정이면 계정 안 건드리고 안내응답, 이메일=발송성공 후 저장.

## P2 (11)
2. **⭐worklog 수정로드 res.ok 미확인 → 빈 폼으로 기존 일지 덮어씀(데이터 손실)** `app/worker/worklog/page.tsx:196` (high)
   - 수정 진입 시 로드 실패(500/502)해도 오류 없이 빈 폼 표시 → traineeId는 URL로 세팅돼 검증 통과 → 저장하면 제출된 공문서(일지) 원본이 빈값으로 소실.
   - **수정**: 로드에서 res.ok·success 확인, 실패 시 error 상태+저장 차단(빈 폼 렌더 금지).
3. **⭐출근부(traineeId=null) 동시제출 → 중복 DocumentRun → 공단 이중 이메일 발송** `app/api/worker/docs/submit/route.ts:84` (high)
   - @@unique가 NULL을 distinct 취급(Postgres NULLS DISTINCT) → traineeId=null 문서는 findFirst→create 레이스 안 막힘. P2002 catch가 이 문서엔 발동 안 함(허수 방어).
   - **수정**: unique를 NULLS NOT DISTINCT 마이그(PG15+) or siteId문서 sentinel(traineeId=0) or (assignmentId,docType,periodStart,traineeId??0) advisory lock.
4. **⭐신규워커 서명 시 임시비번 저장 전 알림톡 → 카카오 다운 시 잠김(거짓 성공)** `app/api/worker/contracts/route.ts:348` (high)
   - sendSignedNotificationNew가 알림톡을 비번 저장 전에 호출 → 실패 시 저장 안 되고 catch가 삼켜 success 반환 → 신규워커 로그인 크리덴셜 영구 미수령(재서명 불가).
   - **수정**: 임시비번 저장 먼저, 그 후 알림톡(실패해도 매니저 알림/재발송).
5. **outboundGuard NODE_ENV만 판정 → Vercel Preview에서 실발송/실결제** `lib/outboundGuard.ts:16`
   - Preview도 NODE_ENV=production → 알림톡·이메일 실발송, 토스 실카드 청구 가능. **수정**: VERCEL_ENV==='production' 기준 + 시크릿 Production 스코프.
6. **결제 크론 토스 타임아웃 없음 → 한 기관 멈춤이 이후 전 기관 청구 막음** `app/api/payments/charge/route.ts:73` (high)
   - 직렬 루프에서 undici 기본 헤더 타임아웃 ~300s. **수정**: `AbortSignal.timeout(10000)`.
7. **결근 합성 월말 `-31` 하드코딩 → 유령 결근(ABSENT) 행** `app/api/admin/attendances/route.ts:230` (high)
   - 2/4/6/9/11월 지난달 조회 시 `2026-02-31`→3월로 롤오버돼 없는 결근 표시(공단 제출 전 근태 오염). **수정**: 실제 말일 계산.
8. **감사 패키지 게이트가 ENDED 배정 제외 → 근무 종료 워커 감사서류 생성 불가** `app/api/admin/audit-package/route.ts:55`
   - 감사는 보통 근무 종료 후 발생인데 정작 그때 막힘. **수정**: status에 ENDED 포함(agencyId 스코프 유지).
9. **checkPlanAccess 계약 기관 먼저 매칭 → 다른 유료 기관 활성인데 차단** `lib/planGuard.ts:154`
   - A기관 계약(이후 FREE 다운그레이드)이 B기관(PRO) 활성 engagement보다 먼저 매칭돼 denied 반환 → 유료기능 오차단. **수정**: 계약 기관 denied면 engagement 브랜치로 폴백(어느 하나라도 허용이면 allow).
10. **holidays 선택 배정 무시 → 엉뚱한 현장에 휴무 기록(멀티현장)** `app/api/worker/holidays/route.ts:18`
    - getAssignment가 최신 ACTIVE만 반환 → 선택한 A현장 아닌 B현장에 휴무 upsert(급여 소정근로일 왜곡). **수정**: 선택 배정 resolve(bulk-generate 패턴).
11. **calendar 배정 스코프 없이 workerId 조회 → 멀티현장 같은날 출근 소실** `app/api/worker/calendar/route.ts:65` (high)
    - dayMap[workDate]에 두번째 현장만 남아 한 현장 근무 사라짐 + 임의 배정 기준 휴무/결근. **수정**: 선택 배정으로 스코프.
12. **logs/save findOrCreateAttendance가 assignmentId 무시 → 다른 현장 출근기록에 일지 귀속** `app/api/worker/logs/save/route.ts:44`
    - findFirst({workerId,workDate})로 아무 현장 기록 집음 → 훈련생 가드 403 오차단 or 잘못 귀속. **수정**: assignmentId로 스코프.

## P3 (9)
13. attendance/monthly 결근합성 선택배정 무시(멀티현장 잘못된 결근) `worker/attendance/monthly/route.ts:62`
14. calendar 선택배정 쿠키 미반영(현장명/훈련생/휴무 다른 현장) `worker/calendar/route.ts:58`
15. admin/settings 간이세액표 res.ok 미확인 → 거짓 '세액표 없음(소득세 0원)' 경고 `app/admin/settings/_sections.tsx:44`
16. AddressMapPicker 카카오 도메인 잠금 키 → 미등록 도메인 지도 실패 `components/AddressMapPicker.tsx:31`
17. ai/voice-to-log Groq/Gemini 타임아웃 없음 → AI일지 멈춤 `worker/ai/voice-to-log/route.ts:96` + batch도 동일 (high)
18. calendar RED 범위 UTC 변환 하루 어긋남(monthly는 KST) `worker/calendar/route.ts:175`
19. payroll 확정 비원자 → 명세서 알림/감사 중복(더블탭) `admin/payroll/runs/[runId]/route.ts:155` (high, C6 패턴 누락)
20. clock-in 더블탭 P2002 → 500 대신 ALREADY_CLOCKED_IN 매핑 필요 `attendance/clock-in/route.ts:280` (high)
21. attendance/monthly 결근합성 임의배정 기준 `worker/attendance/monthly/route.ts:62`

---

## 착수 권고
1. **높은 확신·큰 피해 먼저**: #2(일지 데이터손실) · #3(공단 이중발송) · #4·#1(계정 잠김) · #6(결제크론 타임아웃) · #7(유령결근).
2. **멀티현장 선택배정 클러스터 일괄**: #10·#11·#12·#13·#14·#21 — resolveDocAssignment류 공통 헬퍼로 통일.
3. 나머지 P3.
