# 작업 현황 — 2026-07-10 전(全) 코드베이스 감사 5라운드

멀티에이전트 **전 코드베이스 신규 감사 5라운드** + remediation. 이전(같은 날) "회귀 diff 감사 4라운드"(→`WORK_STATUS_2026_07_10.md`, master@7b2a994)와 별개로, 여기서는 **처음으로 전 코드베이스를 diff에 무관하게 감사**했다.

- **시작**: master `0930f97` (vitest 171)
- **최종 배포**: master `23188c9` (vitest 213)
- **커밋 5개**: `99ff2d3` → `bffdd33` → `d2e0300` → `4228baa` → `23188c9`
- **누적 확정 수정**: 고유 30여 건 (P1 다수·P2·P3·데이터·payroll)
- **운영 마이그레이션 2건 적용**: `20260710192658_edit_request_pending_unique`, `20260710212135_agency_billing_epoch`

---

## 1. 왜 매 감사마다 나왔나 (근본 원인)

이전 4라운드는 전부 **diff 감사**(어제 배포분만)였다. 이번이 **첫 전 코드베이스 감사**라, 리뷰 사이클에 한 번도 안 들어간 오래된 표면(krHolidays 정적표, invite GET, billing orderId, planGuard 트라이얼 등)이 처음 조명됐다. 즉 "코드가 계속 썩은 것"이 아니라 "검증 안 된 레거시가 처음 보인 것".

구조적 요인: ①diff-scoped 감사 ②손입력 데이터 무테스트 ③클래스 수정을 수동 열거로 해 누락 ④모듈 간 계약 무테스트 ⑤감사 강도가 매 라운드 세짐.

---

## 2. 라운드별 요약

| 라운드 | 커밋 | 확정(고유) | P1 | 회귀 | 핵심 |
|---|---|---|---|---|---|
| 1차 | `99ff2d3` | 14 | 3 | — | 설날 공휴일 하루밀림·월중 무료 플랜상향·invite PII |
| 2차 | `bffdd33` | 9 | 2 | 3 | 매니저 무결제 승격·orderId 월충돌 / (회귀)cron dedup·면제 반쪽수정·advanceBilling 드리프트 |
| 3차 | `d2e0300` | 2 | 0 | 1 | (회귀)orderId 일→이중청구 → granularity 분리 / 트라이얼 무한재발급 |
| 4차 | `4228baa` | 3 | 0 | 1 | (회귀)orderId 월→무료사이클 → **billingEpoch 이벤트키** / admin 근태 필터 |
| 5차 | `23188c9` | 3 | 1 | 0 | billingEpoch 미봉 → **활성화마다 epoch 소비**(무료사이클 근본차단) / gov-send 누락노출·rate2 경계 |

**수렴**: 확정 고유 18 → 9 → 2 → 3 → 3. 심각도·회귀 감소.

---

## 3. ★ billing orderId 사가 (4라운드·최대 교훈)

결제 orderId를 **4라운드 연속** 고쳤고, 매번 한 경로를 막으면 다른 경로가 드러났다.

| 단계 | 방식 | 막은 것 | 새로 드러난 것 |
|---|---|---|---|
| B (1차) | 월→**일** | cron 월충돌(무료월) | 수동 자정 재시도 **이중청구** |
| 이슈① (3차) | 일→**월** | 이중청구 | 같은 달 취소→재구독 **무료사이클** |
| X (4차) | **billingEpoch**(이벤트키) | 취소→재구독 | plan왕복·다른강등후 재구독 재사용 |
| **X' (5차)** | **성공 활성화마다 epoch +1** | **모든 재사용 경로** | (구조적 완결) |

**근본 원인**: orderId를 "시간(now)"으로 키잉 → 재시도와 새 이벤트(취소·plan변경·강등후재구독)를 시간으로 구분 불가. **교훈**: 표면(월↔일)만 뒤집으면 반대 회귀. 재사용 클래스 전체를 봐야 했다.

**최종 구조**(5차):
- 수동 구독 orderId = `ablelink_{id}_e{billingEpoch}_{plan}` (`buildSubscribeOrderId`, 시간 미포함).
- 성공한 활성화마다 `billingEpoch +1`(활성화 update와 원자적).
- 재사용은 오직 "활성화 미커밋 재시도"에서만 → 같은 epoch → 같은 orderId → Toss 멱등 복구(의도된 동작, 이중청구 없음).
- 재구독·plan복귀·강등후재구독 = 항상 더 큰 epoch → 새 orderId → 실결제.
- cron 반복결제는 `buildBillingOrderId`(결제일 yyyymmdd, 안정된 nextBillingAt 기준) 유지.

---

## 4. 주요 수정 목록 (도메인별)

**결제/구독**: orderId 이벤트키(위 사가) · 매니저 무결제 플랜승격 차단(유료=결제경로만) · 트라이얼 1회 소진가드(trialStartedAt) · advanceBilling 말일 오버플로우+anchor 드리프트.

**공휴일 데이터(krHolidays)**: 2026 설날 하루밀림(2/16·17·18) · 2027 6곳(추석 월오입력·대체공휴일) · 2024-02-12 설날대체 · 2025-01-27 임시공휴일 · 2025-10-08 라벨. (2026·2027 신규작성분은 2차 감사 검증 통과.)

**근태 표시**: countAsWorkday 결근합성 3개 호출부(캘린더·월별·admin) · 면제배정 오늘 결근 공유엔진(computeAbsentDates)+2호출부 · placeholder RED→ORANGE.

**급여**: 주휴 lookback 오염 · 휴일 8h 일별집계 · rate2 HOURLY 경계.

**동시성/문서/보안**: assignment PATCH advisory lock · edit-request 부분 unique index · cron 계약만료 dedup(계약별) · 미서명 공식문서 발송 게이트 · audit-package 기간내 placement · invite PII 마스킹+레이트리밋 · reset-pw XFF+식별자 스로틀 · gov-send 미제출 노출.

---

## 5. 테스트 그물 (순수함수 추출)

| 파일 | 대상 |
|---|---|
| `lib.krHolidays.test.ts` | 음력 명절 당일라벨(하루밀림)·2024/2025 대체·임시공휴일 |
| `lib.billing.test.ts` | advanceBilling 말일·anchor · buildBillingOrderId(cron date) · buildSubscribeOrderId(epoch 멱등·왕복·재구독) |
| `lib.absentDays.test.ts` | 면제배정 오늘 제외(#14) |
| `payroll.weeklyHoliday.test.ts` | 주휴 lookback 오염(+1) |

vitest **171 → 213** (+42). tsc0 유지.

---

## 6. 방법론·교훈

- **반쪽수정 방지**: 2차 회귀(D=면제 캘린더만 수정) 이후, 매 수정을 **닿는 경로 grep 전수**로 확인(예: countAsWorkday 3호출부, absentDays 2호출부).
- **가드 덧대기보다 단순화·근본수정**: billing은 표면 뒤집기(월↔일)로 반복 회귀 → 이벤트키+활성화소비로 클래스 종결. 매니저 승격은 죽은코드 제거.
- **순수로직 테스트 그물**: 손입력 데이터·계산 로직을 함수로 뽑아 회귀 고정.
- **적대적 재감사 루프**: 매 배포 후 전체 재감사로 회귀 즉시 포착(3·4·5차가 직전 수정 회귀를 잡음).

---

## 7. 남은 것 (의도적 미수정)

| 항목 | 사유 |
|---|---|
| #2 일용근로자 소득세(월 간이세액표) | 노무사 판단 |
| P1-13 MONTHLY 개근월 휴일가산·209h | 노무사 판단 |
| #16 krHolidays 2028+ | 경고로 완화·데이터 백로그 |
| #6 카드거절 즉시강등 / #19 customAmount plan무관 | 의도된 설계(테스트/스키마로 확정) |
| Z: audit-package 멀티현장 단일커버 | P3·ZIP 재구조화 회귀위험→명시 보류 |
| rate2 read-side guard(computeRun) | 선택적 방어(write 경계로 이미 차단) |

**→ correctness/보안/표시 축 코드 작업 ≈ 0. 남은 건 노무사 정책 + 저가치 백로그.**

---

## 8. 검증·배포 노트

- 전 커밋 tsc0 · vitest 213 · 프로덕션 빌드 성공 · diff-aware ESLint 훅 통과.
- 순수함수는 테스트 그물, 라우트 게이트/동시성/결제는 코드추론+빌드(dev e2e는 Toss/outbound guard로 제약).
- 운영 DB는 빈 상태 → 검증은 dev e2e·빌드 성공으로 갈음. 운영 마이그 2건은 가드 절차(.env 스왑→migrate deploy→trap 복원)로 적용·검증.
- 감사 리포트 원본: `tasks/{wg3nd19dg,wp3n995e6,wf9k2xdqh,w2p7le84v,wygq7m3au}.output`.
