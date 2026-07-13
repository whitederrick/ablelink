# 작업 현황 — 2026-07-13 (10차 전체 감사 리메디에이션)

## 요약

9차 감사 배포 후 **10차 전체 코드베이스 감사**(다중에이전트 워크플로우, 33에이전트, 9클래스 병렬 헌트 + 적대적 3렌즈 검증) 실행 → **확정 8건**(정책판단·검토·기각 0). 확정 8건 중 **7건 코드 수정·배포**, **#8은 현행 유지(의도된 설계·실제 영향 0)**.

**주목**: 확정 8건 중 **5건이 2026-07-13 배포 6커밋의 회귀**(hasKnownPassword·customCapacity 2건·resolveActivationPlan·getKstHms). "내 수정이 회귀를 남긴다"는 교훈이 재현됨 → 이번 수정은 각 건 **영향도 분석(경로 전수·상태전이·회귀 시나리오) → 수정 → dev 실측 → 검증** 규율로 진행.

- **배포 커밋 6개**: `eaf738b`(#1) · `ec55c11`(#2) · `2f36d0e`(#3) · `d1c9e22`(#4·#5) · `302d984`(#6) · `112e4bb`(#7) — master push (`d3fbb88..112e4bb`)
- **스키마 변경 없음 → 운영 마이그레이션 불필요** (바로 반영)
- **검증**: tsc0 · vitest 227 → **230**(신규 3) · 각 건 dev e2e 실측

---

## 심각도별 확정 8건

### P1 (4건)

**#1 (보안) — admin/contracts 크로스테넌트 IDOR** `app/api/admin/contracts/route.ts:153` (`eaf738b`)
- workerId(이력검색 선택) 경로가 소속 기관 검증 없이 계약 생성 → 임의 workerId 열거로 타 기관 워커 PII(이름·전화·loginId) 조회 + 무단 알림톡 발송.
- 수정: 본 기관과 기존 관계(`employmentContracts` 또는 `assignments` `{some:{agencyId}}`) 있는 워커만 허용. worker-search UI 스코프와 일치. 신규 워커 최초 계약은 수동입력 경로로, assignmentId 경로는 별도 소속 검증(불변).
- 실측: dev DB 본 기관 워커 허용(non-null)·타 기관 워커 차단(null).

**#2 — 협상가 강등 후 재구독 무결제-FREE** `lib/billing.ts:49` (`ec55c11`)
- 협상가(customAmount) 기관이 해지·카드거절·admin 강등으로 planType=FREE가 되면 customAmount 잔존 → 재구독 시 `resolveActivationPlan('PRO','FREE',30000)`=FREE → 30,000원 청구 + FREE 부여 + cron 재청구 없음(자가회복 불가). 9차 #2(66f8334) 회귀.
- 정책 확정(사용자): **협상가는 1회성 딜**.
- 수정: ①billing 라우트 백스톱(effectivePlanType 유료 아니면 400 — 단일 chokepoint) ②cancel·charge·admin/subscription 3개 강등경로 customAmount=null 클리어. 테스트 그물 +3.

**#3 — hasKnownPassword 전이 부재(초대워커 재설정 후 락아웃)** `app/api/worker/contracts/route.ts:284` (`2f36d0e`)
- hasKnownPassword를 true로 세팅하는 경로 전무 → 초대출신 워커(영구 false)가 비번 재설정 후 로그인 전 계약 서명 시 `isTemporary && !hasKnownPassword`=true → known 비번이 랜덤값으로 폐기, 알림톡 실패 시 락아웃. 9차 #3(52fed8a) 회귀.
- 수정: 비번을 '알게 되는' **5경로**(온보딩 set-password·매니저 재설정·셀프 재설정·profile 비번변경·admin/system 재설정)가 hasKnownPassword=true로 전이. 순수 신규초대는 false 유지(첫 서명 발급 정상 불변).
- 실측: 초대워커 생성→온보딩(true)→재설정(true 유지)→서명 덮어쓰기=false(보존). 대조군 신규초대=발급 정상.

**#4 — assignment-requests GET 정원 재계산 CUSTOM 누락** `route.ts:90` (`d1c9e22`)
- 90행 재계산이 `capAm+capPm+capFull`로 capCustom 누락 → customCapacity 현장이 capacity=0으로 잡혀 UI가 '정원 미설정'으로 finalize 차단. be1c052(#7) 회귀.
- 수정: filledMap·재계산에 CUSTOM 반영 + 프런트 Group 타입·표시. 소비처(manager/workers·SiteDetailModal) 전수 확인(정상).

### P2 (1건)

**#5 — respond 단일후보 자동배정 정원 우회** `app/api/worker/assignment/respond/route.ts:122` (`d1c9e22`)
- competitors===0→ASSIGNED가 정원검사 없이 이미 찬 슬롯에도 승격 → 순차 수락으로 정원 초과.
- 수정: 정원 설정 현장에서 슬롯 초과면 ASSIGNED 대신 ACCEPTED(매니저 finalize로 이관). 정원 미설정=무제한이면 종전대로.
- 실측: 찬슬롯→ACCEPTED·여유슬롯→ASSIGNED·무제한→ASSIGNED·맞춤찬슬롯→ACCEPTED 4케이스 PASS.

### P3 (3건)

**#6 — audit-package 멀티현장 문서 누락** `route.ts:54` (`302d984`)
- findFirst로 최신 배정 1곳만 골라 타 현장 출근부·훈련일지·평가가 공단 감사 ZIP에서 무경고 누락.
- 결정(사용자): **전체 수정**. 기간 내 전 배정을 findMany로 조회→현장별 그룹핑→현장별 서류 생성. 단일현장은 루트(무회귀), 멀티현장은 `현장_{현장명}/` 폴더 분리. 스코프·ENDED·PII 게이트 유지.
- 실측: 멀티현장 워커 2현장 전량 그룹핑(과거 1곳) PASS.

**#7 — 홈 헤더 날짜 라벨 KST 누락** `app/worker/home/HomeClient.tsx:116` (`112e4bb`)
- nowDateStr()가 서버 UTC getDate 사용 → KST 00~09시 SSR에서 날짜만 전날. 26897e1(getKstHms) 누락분.
- 수정: 시계와 동일 currentTime을 +9h KST 오프셋·getUTC*로 렌더. 실증: UTC 22:00(KST 7/14)→"7월 14일 (화)"(구버전 "13일").

**#8 — customCapacity=0 기본값 CUSTOM finalize 오탐 차단** `route.ts:163` (**현행 유지·코드 변경 없음**)
- 마이그 백필 없어 기존 현장 customCapacity=0 → am/pm 설정 현장의 CUSTOM 배정 409.
- 결정(사용자): **현행 유지**. 사용자가 정한 '슬롯별 엄격(슬롯 0=0명)' 의도 동작이고, dev 28현장 중 CUSTOM 배정+정원설정 현장 0곳(운영 빈 DB)이라 실제 영향 없음. UI '맞춤' 칸으로 자가교정 가능.

---

## 신규 파일/헬퍼
- 없음(기존 헬퍼 재사용: `isPaidAgencyPlan`·`findCapacityOverflow`·`getKstHms`).

## 테스트
- `__tests__/lib.billing.test.ts` +3(백스톱 불변식: 협상가+무료등급→유료 아님·정상 재구독 통과·정상 협상가 통과). vitest 227→230.

## 감사 방법론
- 다중에이전트 워크플로우(ww0gz6xyv): 9클래스 병렬 헌트(payroll-chokepoint·billing·auth·assignment-capacity·documents·attendance·idor·concurrency·recent-diff) → 중복병합 → 적대적 3렌즈(code-truth·exploit-repro·intent-design) 과반 검증. 원시 9→고유 8→확정 8.
- placeholder chokepoint 도메인: 신규 후보 0(9차 종결 확증). recent-diff 클래스가 회귀 5건 전량 포착.

## 다음 세션 시작점
1. **11차 = regression watch** — 이번 5건 회귀가 다시 파생되지 않는지, 특히 hasKnownPassword·customAmount 상태전이·capacity 조회/강제 정합.
2. 노무사 대기 급여정책(#8 9차 휴일연장·P1-13 MONTHLY·프리랜서 가산) 그대로 대기.
3. Vercel 빌드 성공 확인 + audit-package 멀티현장 ZIP·현장관리 육안 확인.
