# 작업 현황 — 2026-07-14 (20차 원점 심층 전수 감사)

## 요약

사용자 요청("원점에서 다시, 더 디테일하게")으로 도메인을 16개로 세분화하고 각 에이전트에 "기존 수정도 직접 재검증·모든 심각도·형제갭 집중"을 지시해 15개 병렬 심층 감사를 수행했다. **더 잘게 쪼갠 결과, 이전 8개 라운드(13~20차 얕은 스윕)가 모두 놓친 P1을 발견**했다.

- **검증**: tsc 0 · vitest 241 · P1 dev e2e 5/5 · 스키마 변경 없음(마이그레이션 불필요)

## 확정·수정

### P1 (동의우회, 8라운드 미검출)
`admin/assignments/[id]` DELETE가 미동의 REQUESTED를 무조건 ENDED로 전환 → ENDED ∈ CONSENTED_ASSIGN_STATUSES라 `workerBelongsToAgency` 위조 → 타 기관 워커 계좌·생년월일·본인인증 열람 + 계약/급여 조작. **수정**: 동의 상태(ACCEPTED+)만 ENDED, 미동의 REQUESTED 취소는 EXPIRED(비-CONSENTED·비-finalize대상). dev e2e로 세탁 차단·무회귀 확증.

### P2 (3건)
- **평가 기간 혼입**(문서 12개 조회 지점): 평가를 period 스코프 없이 findFirst → 공단 문서에 다른 기간 점수. **수정**: 문서 기간과 겹치는 평가만(`periodStart<=end && periodEnd>=start`) — 비겹침만 배제, 단일평가 무회귀.
- **audit-package 크로스테넌트 훈련생**: placements를 siteId로만 조회 → 공유현장 타 기관 훈련생 성명 노출. **수정**: 주체 워커가 실제 로그를 쓴 훈련생만(writerId 필터) — 크로스테넌트 자동 배제 + 빈 PDF 해소.

### P3 (저위험, 수정)
- cancel·cron 강등 `billingCycle` 리셋(18차 admin PATCH만 고친 형제갭) · charge anchorDay KST(−1일 드리프트) · 4대보험 `Math.round`→`Math.floor`(법정 원단위 절사) · CRON_SECRET 상수시간 비교 · cron §1 자동확정 DONE만(ABSENT 방어) · worker/evaluation GET BigInt 가드 + POST 입력검증(enum·기간형식·크기) · onboarding request-email 레이트리밋(형제갭) · pdfkit 근무확인 날짜 KST · clock-in 좌표 NaN/범위 검증.

## 유보 (사유 명시)
- **§6 cron 급여 캐치업**(말일 autoDay+당일실패 시 그 달 누락): 제안된 min-clamp가 현재 코드와 동치(실효 없음), 진짜 자가치유(교차월 캐치업)는 급여 cron 민감 경로 medium-risk → 전용 패스로. 정상 autoDay는 월내 캐치업 정상.
- contract-sign 슬롯정원(E1-C 의도 인접·락 refactor 위험) · cron 상태전이-알림 원자성(refactor) · finalize 집계 통일(현재 무영향·이관 기능 대비) · supportStorage path·survey/sign-self rate-limit·edit-request 잠금기록·잔여 BigInt 가드(저위험 nit).

## 노무사/스키마 큐 (추가)
- **비연속 근무요일(MWF/TTh) → 주휴 부인·MONTHLY ~33% 과소지급**: EmploymentContract에 실제 근무요일 집합 필드 없음(데이터모델 갭) + 개근정의 정책
- 건강보험 8일 기준(법정 60h만 vs 8일-OR, 의도 설계) · 급여 tier 판정 소정 vs 실출근 기준 · (기존) 209h·같은날2배정·P1-13·프리랜서·휴일+연장

## 결론
크로스테넌트/인증/결제/SSRF/업로드/근태원자성/JWT 등 대부분 도메인은 소진 재확인. **P1 하나가 8라운드 만에 나온 것은 얕은 스윕의 한계 → 세분 심층 재감사의 가치를 실증.** 향후 정기 심층 재감사 권장.
