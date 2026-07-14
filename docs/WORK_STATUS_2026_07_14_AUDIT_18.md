# 작업 현황 — 2026-07-14 (18차 재감사: 17차 회귀검증 + 형제갭 전수 종결)

## 요약

17차 배포 후 18차 재감사(regression-watch 중심 6개 도메인 병렬 헌트 + 신규 스윕)를 수행했다. **17차 수정 자체에서 형제갭 2건이 재발**했고(recruit-applications 정원·ANNUAL 언더차지 반쪽수정), 별도로 **기존 P1 1건(근태 쓰기 소유권)**을 포함한 결함을 확정했다. 사용자 지적("매번 말해도 매번 놓친다")에 따라, 이번에는 지목된 지점이 아니라 **클래스를 전수 열거한 뒤 한꺼번에** 닫는 방법으로 처리했다.

- **배포 범위**: master 한 커밋(스키마 변경 없음 → 운영 마이그레이션 불필요)
- **검증**: tsc 0 · vitest 236 · sessionVersion(17차) 유지 · P1 근태 소유권 dev 실측(82행 전부 assignment 보유 → 무회귀)

---

## 방법 교정 (반복된 형제갭의 근본 원인)

지금까지 반복된 실패 = **발견이 지목한 인스턴스만 고치고, 충분한지를 열거로 증명하는 대신 판단으로 넘긴 것.** 17차의 두 구멍이 그 증거:
- recruit-applications: 17차 감사가 "offers와 같은 클래스"라 짚었는데 "신규 현장이라 무제한"이라는 **미검증 가정**으로 넘기고 offers만 고침(재사용 현장 경로를 놓침).
- ANNUAL: "이 라우트가 유일한 설정 경로라 여기서 게이트하면 충분"이라 **단정**(소비 chokepoint 미방어 → 강등→재구독으로 재현).

**교정된 순서**: (1) 형제 전수를 grep으로 나열 → (2) 바뀌는 상태의 소비처 추적 → (3) 한꺼번에 수정 → (4) 열거를 증거로 남긴 뒤 종결 선언.

---

## 회귀 검증 결과 (17차 24파일)

| 도메인 | 결과 |
|---|---|
| sessionVersion | 회귀 없음(토큰 발급 3경로·자매갭·하위호환·admin 승격 2경로 전수 확인) |
| 배정 정원·락 | 교착·정상흐름·TOCTOU 회귀 없음. **단 recruit-applications 형제갭 발견** |
| 급여(MONTHLY 일할·8h 상한) | 지급액 회귀 없음. 무계약 MONTHLY 결합·8h 표시 P3 |
| cron lookback | 멱등성·날짜정합·격리 견고. stale-draft 교차갭 P3 |
| 소규모(worker-reviews·audit-package·serviceStep·krHolidays) | 회귀 없음. **단 ANNUAL 게이트 반쪽수정 발견** |

---

## 확정·수정 (전수 클래스 종결)

### ASSIGNED 배정 생성 클래스 (7경로 전수)
respond·offers·finalize·직접배정·PATCH ✓(정원검사 有) → **recruit-applications(P2)** 정원검사 추가(offers 쌍둥이, 재사용 현장 노출). **invite(P3)** null-workType 유령배정 → 기본 FULL_DAY. **respond(P2)** 정원검사를 site+worker 락으로 승격(TOCTOU 완전 원자화).

### billing ANNUAL 언더차지 (소비 chokepoint 종결)
`effectiveBilling`에서 협상가 없는 ANNUAL을 MONTHLY로 강제(수동구독·cron이 모두 거치는 유일 결정점 → 어떤 상태에서도 미과금 불가) + 강등 시 billingCycle도 리셋 + 17차 PATCH 게이트 유지 = 3층 방어.

### 근태 쓰기 소유권 P1 (8라우트 전수)
`Site.agencyId`(참고용·nullable·공유현장)가 아니라 `assignment.agencyId`(실귀속·non-null)로 통일 — 읽기 라우트와 동일. 공유 현장에서 타 기관 근태·급여 확정/수정 차단. 대상: attendance-inbox의 resolve·memo·request-supplement·request-correction·request-reason·confirm-missed-clockout, attendance-edit-requests/[id], attendance-inbox/events/[eventId]. + 운영자 agencies/detail 집계도 assignment 귀속으로 정정.

### 기타
- **worker-search(P2)**: 중첩 include에 매니저 스코프 추가(타 기관 최신 계약 노출 차단).
- **deductions PATCH(P3)**: PERCENTAGE 범위검증 추가(음수 순급여 차단).
- **assignmentLock(P3)**: site 2키 락 `::int`→`hashtext`(2^31 초과 siteId 오버플로 방지).
- **17차 회귀 자체수정**: 무계약 MONTHLY 일할 폴백(과소지급 방지)·주휴 8h 상한 표시 문자열.

---

## 유보 (사유 명시)

- **cron lookback → 기존 급여 DRAFT stale화(P3)**: 매우 좁은 케이스(설정일 당일 run에서 섹션4만 실패). 자동 재계산은 매니저의 수동 초안 편집을 덮어쓸 위험이 더 커서 auto-fix 안 함. DRAFT는 확정 전 매니저 검토 단계에서 근태가 UI에 보이므로 실질 포착됨.
- **노무사 큐**: 209h 통상시급·주휴 개근정의·같은날2배정 평균·P1-13·프리랜서·9차#8 휴일연장.

## 수렴

13차 P0 → 14차 P0없음 → 15차 P1×4 → 16차 P2 → 17차 → **18차 P1×1·P2×2·P3 다수.** P1 재출현은 전부 "읽기는 고치고 형제 쓰기를 놓친" 동일 패턴. 크로스테넌트 워커 PII 클래스는 소진 재확인.

## 다음 세션 시작점

1. 배포 스모크: 공유현장 없더라도 근태 인박스 액션·급여계약 검색·respond 정상.
2. 19차 재감사(이번 형제갭 수정의 재-재검증) 또는 노무사 결정 반영.
