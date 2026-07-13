# 작업 현황 — 2026-07-13 (9차 감사 리메디에이션 완결 + 홈시계 KST + customCapacity)

## 요약

9차 전체 감사(2026-07-12, 39에이전트)에서 확정된 8건 중 **처리 가능한 7건을 전량 수정·배포**하고, #8만 노무사 확인 대기로 보류했다. 추가로 사용자 신고 2건(관리자 생성 워커 온보딩 미유도 · 홈 시계 시각 어긋남)을 처리했다. 사용자 결정에 따라 #7은 단순 수정이 아니라 `customCapacity`(맞춤 정원)를 정식 기능으로 도입해 슬롯별 정원 강제로 재설계했다.

- **배포 커밋 6개**: `52fed8a` · `26897e1` · `66f8334` · `ba56d19` · `be1c052` (master, 전부 push·Vercel 배포)
- **운영 마이그 2건 적용**: `20260713000000_add_worker_has_known_password`, `20260713010000_add_site_custom_capacity`
- **검증**: tsc0 · vitest 213 → **227**(신규 그물 14) · 각 건 dev e2e 실측
- **배포 순서 준수**: 컬럼 쿼리 코드가 있으므로 운영 마이그 선적용 → push

---

## 1. 9차 감사 #1·#3·#6 — 관리자생성 워커 온보딩 + 비번폐기 회귀 근본차단 (`52fed8a`)

### 배경 (사용자 신고, 2026-07-12)
"관리자가 직무지도원 생성 + 임시비번 부여 → 로그인해도 비번변경 유도 없음". 진단 결과 `admin/system/workers` POST만 `isTemporary:false` 하드코딩(계약경로는 true)이라 온보딩(강제 비번변경)이 트리거되지 않았다. `isTemporary:false→true`로 수정했으나, 9차 감사가 이 단독 변경이 회귀 2건을 유발함을 발견 → #3·#6 동반 수정 후 커밋.

### #1 (P1) — audit-package traineeLog siteId 누락
- `admin/audit-package/route.ts:133,140` traineeLog 2쿼리의 `attendance` where에 `siteId: site.id` 추가.
- 멀티현장에서 타현장 지도일지가 공단 감사 ZIP에 혼입되던 것 차단(6차 siteId 클래스 잔여 종결). 단일현장 무영향.

### #3 (P2, 회귀 근본차단) — isTemporary 오버로드
- 문제: `isTemporary`가 "랜덤비번 초대워커"(admin/contracts, 아무도 모르는 UUID 해시)와 "known비번 관리자생성"(admin/system/workers, 관리자가 알려준 실비번)을 오버로드. 관리자생성 워커가 온보딩 前 계약 서명 시 `worker/contracts:284`가 신규가입 분기로 태워 `sendSignedNotificationNew:344`가 **관리자 지정 비번을 랜덤값으로 조용히 폐기** → 알림톡 미설정 시 완전 락아웃.
- 해법: **`Worker.hasKnownPassword` 플래그 신설** (`@default(true)`, 마이그 `20260713000000`).
  - 기본값 true = 안전(비번 덮어쓰기는 명시적 false일 때만) → 경로 누락 시에도 "덮어쓰기 안 함"으로 수렴.
  - `admin/contracts` 초대 경로(랜덤 비번) 2곳만 `false` 설정.
  - `worker/contracts` 서명 분기를 `isTemporary && !hasKnownPassword`로 좁힘 → 랜덤비번 초대만 비번 발급, 관리자생성(known비번)은 기존회원 분기로 라우팅·비번 보존.

### #6 (P3) — profile PATCH 온보딩 우회
- `worker/profile/route.ts:106` 재발급 토큰 `isTemporary:false` 하드코딩 → isTemporary 워커가 비번 아닌 필드(이름·전화·계좌)만 PATCH하면 온보딩 영구 우회.
- 해법: `isTemporary: newPassword ? false : user.isTemporary` (select에 isTemporary 추가). DB의 `updates.isTemporary`는 비번변경 시에만 false라 이미 정상, 토큰만 잘못됐던 것.

### 검증
dev e2e: 두 생성 경로의 hasKnownPassword 값(관리자생성 true·초대 false)·서명 분기 판정(관리자생성=비번보존·초대=발급)·비번 불변·profile 토큰 3케이스 전부 기대 일치. dev DB isTemporary=true 워커 0건 → 기본값 true backfill 안전 확인.

---

## 2. 홈 시계 KST 고정 (`26897e1`)

### 배경 (사용자 신고)
운영 `/worker/home` 직접 접속(세션 유지) 시 시각이 02:xx(UTC)로 표시, 로그아웃→재로그인하면 정상.

### 원인
`HomeClient.tsx:260` `useState(new Date())`가 **SSR에서 서버 타임존(UTC)으로 초기화**되고 `getHours()`가 런타임 로컬 TZ를 사용. 직접 URL 접속=풀 SSR → UTC(02:xx), 인터벌 첫 갱신(1초)까지 노출. 로그인 후=클라 네비게이션 마운트 → 즉시 KST 정상. **세션 자동종료 아님(쿠키 7일 유지)=정상 동작.**

### 수정
- `lib/time.getKstHms(date)` 추가(+9h 고정 오프셋, 한국 서머타임 없음 → 렌더 위치 무관 동일 KST). 서버/클라 동일 instant면 동일 출력 → 하이드레이션 9시간 점프도 소멸.
- HomeClient 라이브 시계(timeStr/secStr)·저장시각 표시(formatHHMM)·select-site 스마트 추천(nowMin) 전부 KST 고정.
- calendar/history는 `"use client"` + useEffect fetch라 시각 표시가 클라에서만 렌더(SSR 시점 데이터 없음) → UTC 플래시 없음(무변경).

### 검증
dev 실측: getKstHms(UTC 02:30) → KST 11:30. 자정 경계 UTC 15:10 → KST 00:10.

---

## 3. 9차 감사 #2 — 협상가 등급 권한상승 차단 (`66f8334`)

### 문제
`payments/billing` 수동 결제가 **금액은 운영자 협상가(customAmount)**에서, **등급은 매니저 요청 body.planType**에서 가져오는 비대칭. 운영자가 A기관과 "월 3만원" 협상(customAmount=30000, 의도 등급 STARTER)해도, A기관 매니저가 `planType:PRO`로 요청하면 **3만원만 내고 PRO 한도·기능 사용**(언더차지+권한상승). cron 자동결제는 `agency.planType`을 써서 이 수동 경로만 비대칭.

### 사용자 정책 확정
"협상가는 운영자가 합의한 등급에서만 유효" (매니저가 임의 상위등급 선택 불가).

### 수정
- `lib/billing.resolveActivationPlan(요청등급, 운영자저장등급, customAmount)` 추가: 협상가(>0) 설정 시 `agencyRow.planType`으로 고정, 없으면(표준가 결제) 요청 등급 그대로.
- billing 라우트의 등급 사용처(금액·orderId·orderName·한도·저장·응답·로그) 전부 `effectivePlanType`으로 통일 → cron과 등급 결정 일원화.

### 영향도
- 영향받음: 협상가 설정 기관의 수동 결제 → 등급 운영자 저장값 고정.
- 영향 없음: 표준가 결제 기관은 요청 등급 그대로 · cron · admin 구독관리(별도).
- 엣지: 운영자가 customAmount만 넣고 planType=FREE로 두면 FREE 한도 부여(설정 오류일 뿐 보안홀 아님).

### 검증
테스트 그물 5(협상가 상위요청 고정·동일·null·0·음수).

---

## 4. 9차 감사 #4·#5 — finalize 정원 TOCTOU + 근태 교정 KST (`ba56d19`)

### #4 (P2) — finalize 정원 TOCTOU
- `admin/assignment-requests` finalize의 정원 카운트(filledCnt)가 워커락 밖 → 같은 현장에 다른 워커들로 동시 finalize 시 각자 정원검사 통과 → 정원 초과.
- 해법: **`withSiteAndWorkersAssignmentLock(siteId, workerIds, fn)` 신설** (`lib/assignmentLock.ts`). 현장 두-키 advisory 락 + 워커 단일키 락은 PostgreSQL이 별개 lock space로 관리 → 무충돌. 획득 순서 '현장→워커(오름차순)' 고정 → finalize만 두 락을 잡고 다른 경로는 워커 락만 잡으므로 교착 불가. filledCnt 재조회→가드→겹침검사→승격 전부 락 안에서 원자 수행.
- dev 실측: 같은 현장 직렬화(A EXIT 후 B ENTER)·다른 현장 병렬(두 ENTER 먼저) PASS.

### #5 (P2) — 근태 교정도구 KST 보정
- `admin/system/attendances/[id]:33`이 HH:MM을 `new Date(workDate+"T00:00:00")+setHours`로 서버 로컬(UTC) 기준 저장 → 운영에서 9시간 어긋남.
- 해법: 정상 출퇴근 저장 경로가 쓰는 `lib/workSchedule.kstWallTimeToInstant(KST 벽시계 → -9h instant)`로 통일 + HH:MM 형식 방어.
- dev 실측: 09:00 입력 → KST 09:00 왕복.

---

## 5. 9차 감사 #7 — customCapacity(맞춤 정원) 정식 추가·슬롯별 강제 (`be1c052`)

### 배경 & 결정
기존 finalize는 `amCapacity+pmCapacity+fullDayCapacity` **총합**으로만 정원을 검사 → 오전정원 2·오후정원 0인 현장에 오후 2명이 통과하는 등 슬롯 분포 무시. 근본 원인은 CUSTOM 근무형에 대응하는 정원 버킷 부재. "발생하면 만든다"는 트리거가 없다는 사용자 지적에 따라 **customCapacity를 정식 기능으로 도입**(슬롯별 엄격 제한)으로 결정.

### 구현 (9개 파일)
- **스키마**: `Site.customCapacity Int @default(0)` (마이그 `20260713010000`, dev+운영).
- **API**: `admin/sites` GET/POST/PATCH · `[id]` 전부 customCapacity 왕복.
- **UI**: 현장관리 모달(`SiteDetailModal`) 정원 입력에 "맞춤" 칸 추가 · 총 정원 합계 반영, `manager/workers` 목록 합계 반영.
- **finalize**: `lib/assignmentCapacity.findCapacityOverflow(순수·테스트그물)`로 슬롯별 검사. #4 현장락 안에서 원자 수행. 초과 시 슬롯 라벨 포함 409(예: "오후 정원을 초과하였습니다").

### 정원 의미 (중요)
- **totalCap=0** (현장이 정원을 하나도 설정 안 함) → **무제한**(하위호환·M7).
- **totalCap>0** (정원 설정함) → **슬롯별 엄격**. 슬롯 정원 0 = 그 형태 0명 허용(UI "0=해당 형태 불필요"와 일치). CUSTOM은 customCapacity 설정해야 확정 가능.

### 영향도
- **영향 없음**: 기존 모든 현장 customCapacity=0 backfill(dev 전수 확인). 정원 미설정 현장(운영/dev 대부분)은 무제한 유지 → finalize 완전 불변.
- **동작 변경(의도)**: 정원 설정 현장에서만. 슬롯 분포가 안 맞으면 409, 맞춤 후보는 customCapacity 필요.

### 검증
테스트 그물 9(#7 버그·슬롯내통과·미설정무제한·CUSTOM거부/허용·기존인원·다슬롯). dev 실측: backfill=0·groupBy 형태·#7 차단.

---

## 6. 운영 데이터 조치 (사용자 승인)

- 어제 admin/system/workers로 생성된 워커 2명(#1 곽은하·#2 안남규)이 구코드로 `isTemporary=false` 저장 → 온보딩 미유도.
- 운영 DB에서 `id[1,2]` `isTemporary=true` + `sessionVersion+1` → 기존 토큰 무효화·재로그인 시 온보딩(비번변경) 강제. `hasKnownPassword=true`라 관리자 지정 비번 안전.
- 앞으로 신규 생성분은 코드로 자동 `isTemporary=true`.

---

## 남은 것 — #8 (P3, 노무사 확인 후 처리로 보류)

`computeRun.ts:404` 휴일근로가 8시간 초과 수동연장(**면제 배정 한정**)과 겹칠 때 휴일가산이 200%가 아닌 150%로 과소지급.

- **정상 케이스는 이미 200%로 지급됨**(computeRun 410-425가 휴일 8h 경계 처리: 8h이내 0.5배 + 초과 1.0배).
- **문제**: 휴일근로 시간 기준(404줄)이 `e=스케줄 종료시각`인데 야간수당(398줄)은 `eNight=실효 종료시각`(수동연장 포함)을 씀. 이 비대칭으로 면제 배정 워커의 휴일 수동연장분이 휴일버킷에 안 잡혀 연장수당(1.5배)만 받고 휴일가산(추가 0.5) 누락.
- **보류 사유**: 코드 주석(373-374)이 "휴일·야간 검출 규칙은 사용자 검토 대상"으로 명시. 수당 중첩 규칙은 법 해석 영역. P1-13(MONTHLY 휴일가산)·프리랜서 가산과 같은 급여정책 축 → **노무사 일괄 확정 대기**.

---

## 신규 파일/헬퍼

- `lib/time.getKstHms` — KST 시:분:초(렌더 위치 무관).
- `lib/billing.resolveActivationPlan` — 협상가 등급 결정.
- `lib/assignmentLock.withSiteAndWorkersAssignmentLock` — 현장+워커 결합 락.
- `lib/assignmentCapacity.ts` (신규) — `findCapacityOverflow` 슬롯별 정원 판정.
- 테스트: `__tests__/lib.assignmentCapacity.test.ts`(9), `lib.billing.test.ts`(+5).

## 마이그레이션 (운영 적용 완료)

- `20260713000000_add_worker_has_known_password` — `workers.has_known_password BOOLEAN DEFAULT true`.
- `20260713010000_add_site_custom_capacity` — `sites.custom_capacity INTEGER DEFAULT 0`.

## 9차 감사 최종 집계

확정 8건 중 **#1·#2·#3·#4·#5·#6·#7 전량 배포**, **#8만 노무사 대기**.

## 다음 세션 시작점

1. #8 — 노무사 확인되면 처리(P1-13·프리랜서 가산과 일괄).
2. 10차 감사 — placeholder regression watch로 전환.
3. Vercel 빌드 확인 + 현장관리 모달 "맞춤" 정원 칸 육안 확인.
