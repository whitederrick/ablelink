# 작업 현황 — 2026-07-14 (17차 전수 감사: 크로스테넌트 PII 클래스 소진 확인 + P2 9건 수정)

## 요약

16차 이후 사용자 요청으로 17차 전수 감사를 8개 도메인 병렬 헌트(크로스테넌트 PII·급여·인증·배정·결제·문서/공단·IDOR·근태/cron)로 수행했다. **핵심 목표였던 크로스테넌트 워커 PII 클래스는 0건으로 코드 레벨 소진을 확증**했다(15차 B enabler 차단 이후 mass-열거·표적형 잔여 모두 재현 불가). 다른 클래스에서 확정된 P2 9건은 대부분 **과거 수정의 형제 경로 누락(자매 갭)**이 반복된 것으로, 사용자 승인(P2 전량 + 주휴 8h 상한 즉시)에 따라 전량 수정했다.

- **수렴**: 13차 7(P0) → 14차 5 → 15차 8(P1×4) → 16차 3(P2) → **17차 P0/P1 없음, P2 9건 + 8h상한**
- **검증**: tsc 0 · vitest 234 → **236**(주휴 8h 상한 그물 +2) · sessionVersion dev e2e 8/8 PASS
- **DB**: 마이그레이션 `20260714000000_add_manager_admin_session_version`(dev 적용 완료, **운영 대기**)

---

## 크로스테넌트 워커 PII 클래스 — 소진 확인 (17차 핵심)

`lib/worker/agencyScope.workerBelongsToAgency` 헬퍼의 두 OR 갈래(계약이력/CONSENTED 배정)를 부트스트랩 홀 관점에서 적대 검증하고, 이 헬퍼를 쓰는 모든 관문(workers/[id]·worker-accounts·verify-*·contracts·payroll/contracts·admin/assignments)이 판정 결과를 실제 403/필터로 강제함을 전수 확인했다. PII echo/PATCH 라우트, 소속행 생성 라우트에서 신규 열거/조작/enabler 경로를 찾지 못했다. **클래스 종결.**

---

## 확정 P2 9건 (전량 수정)

| # | 영역 | 위치 | 수정 |
|---|---|---|---|
| 1 | 급여 | `computeRun.ts:355-375` | MONTHLY 일할 분자를 소정근로일(workingWeekdays∩비공휴일) 출근만 dedup·상한 → 비소정일/공휴일 출근의 결근 상쇄 차단(14차 주휴 형제 갭) |
| 2 | 배정 | `admin/assignments/route.ts` | 직접배정을 site+worker 락으로 감싸고 `findCapacityOverflow` 추가(슬롯 정원 강제) |
| 3 | 배정 | `admin/assignments/[id]/route.ts` | PATCH workType 변경 시 점유 상태면 슬롯 정원 재검사(주석 190의 미가드 경로 종결) |
| 4 | IDOR | `admin/worker-reviews/route.ts` | GET에 `hasEngagement` 게이트 추가(POST와 대칭) → 무관계 매니저의 타 기관 후기 열람 차단 |
| 5 | 인증 | Manager/Admin 전반 | `sessionVersion` 신설(schema·payload·verify·scope·login·reset 2경로). 비번초기화 시 +1 → 탈취 세션 회수(워커 P2-16 자매 갭) |
| 6 | 문서 | `admin/audit-package/route.ts` | 종합평가 조회에 `isConfirmed:true` + null이면 PDF 스킵 → 미확정/빈 평가가 공단 감사 ZIP에 공식서식으로 들어가는 것 차단 |
| 7 | 결제 | `admin/system/agencies/[id]/route.ts` | 유료+ANNUAL+협상가 미설정 조합을 400으로 거부 → 월정액 연1회 청구(≈92% 언더차지) 차단 |
| 8 | 근태 | `krHolidays.ts` | 선거일 2건 추가(2025-06-03 대선·2026-06-03 지방선거) |
| 9 | 근태 | `cron/daily/route.ts` | 처리창을 최근 7일 lookback으로 확장(섹션 1·4)·급여DRAFT를 `payrollAutoDay<=todayDay`로 → 1회 실패 시 영구누락 자가치유(각 섹션 멱등) |

**즉시 수정(급여정책 중 법정 명확)**: 주휴 1일분 8h 상한(`weeklyHoliday.ts:181`) — 주40h 초과 계약에서 (주소정÷40)×8이 8h를 넘던 과지급을 2400분 클램프로 종결. 테스트 그물 +2.

**형제갭 예방(P3, 같은 근본 함께 처리)**: 마켓 제안 수락 자동배정 정원 확인(`worker/recruit/offers`)·`serviceStep.ts` 전환일 전 base step 반영(FIELD 하드코딩 제거).

---

## 노무사 정책 큐 (미결)

- MONTHLY 단시간 209h 통상시급(`computeRun.ts:358`) — 산정기준시간 법 해석
- 주휴 개근 판정 전반 · 같은날 2배정 주휴 평균 · P1-13 MONTHLY 휴일가산 · 프리랜서 3.3% 가산 · 9차 #8 휴일연장 겹침

## 참고(P3, 미수정)

결제 admin/subscription FREE강등 빌링키 잔존 · review 진척도 집계 타기관 혼입(수치만) · 워커 수정요청 HH:MM 미검증 · cron §7 날짜 TZ 프레임 · UTC 기본날짜 잔존 6경로 · homeSummary finalizedAt +9h · 진척독려 dedup 키 · 급여 AM/PM 미포함 휴게30분·운영자 보정 endTime 불변식·늦은퇴근 연장 자동지급·주휴 경계주 lookback·4대보험 반올림.

## 다음 세션 시작점

1. **운영 배포 + 운영 마이그(`20260714000000`) 적용** — sessionVersion 컬럼. 코드가 컬럼을 쿼리하므로 선적용 필수.
2. 운영 스모크: 매니저/운영자 로그인·비번초기화 후 구세션 401 · 직접배정/PATCH 정원 초과 409 · audit-package · ANNUAL 설정 거부.
3. 18차 전수 재감사(P2 잔여 소진 확인) 또는 노무사 결정 반영.
