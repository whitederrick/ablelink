# 작업 현황 — 2026-07-13 (13~16차 전수 감사: 크로스테넌트 워커 PII 클래스 근본 종결)

## 요약

10차 감사 이후 사용자 요청으로 전수(全 코드베이스) 감사를 13→16차 연속 수행했다. **13차에서 크로스테넌트 워커 조작 P0(계정 탈취)를 발견**하고 근본 수정한 뒤, 같은 클래스(공유 워커풀에서 매니저↔타 기관 워커 접점의 스코프/응답 위생)가 라운드마다 다른 라우트에서 반복 노출됐다. **15차에서 사용자 결정에 따라 증상(응답 마스킹)이 아닌 enabler(임의 workerId로 소속행 주입)를 막는 방향(B)으로 전환**했고, **16차에서 mass 열거가 닫힌 것을 확증**(P0/P1 없음, P2 잔여만)했다.

- **배포 범위**: master `d3fbb88 → bc9ce04` (13~16차, 다수 커밋, 스키마 변경 없음 → 운영 마이그레이션 불필요)
- **검증**: tsc 0 · vitest 227 → **234**(신규 그물 7: 주휴 개근 4, billing 백스톱 3) · 각 건 dev DB 실측
- **운영 상태**: 빈 DB(계정·데이터 없음) → 현재 실익스플로잇 제한적이나 실 멀티테넌트 트래픽 전 필수 수정

---

## 수렴 실증

| 라운드 | 확정 | 최고 심각도 | 핵심 |
|---|---|---|---|
| 13차 | 7 | **P0** | 크로스테넌트 계정 탈취 발견·근본수정(agencyScope 단일헬퍼) |
| 14차 | 5 | P1 | 응답 PII echo 잔여(assignments POST 마스킹) |
| 15차 | 8 | P1×4 | **B 결정**: enabler(mode=request) 차단 |
| 16차 | 3 | **P2만(P0/P1 없음)** | B 종결 확증, 형제 라우트 잔여 2건 정리 |

심각도 P0→P1→P2 하강. 16차에 P0/P1 부재 → 클래스 종결 근접.

---

## 13차 — 크로스테넌트 워커 조작 P0 종결 (`5b2a0d2..780ed55`)

**P0**: 매니저가 타 기관 워커에게 미동의 REQUESTED 배정을 심으면, 워커 소속 판정이 `assignments.some({site:{agencyId}})`(status 필터 없음)라 그 워커를 '내 소속'으로 위장 → 비번 초기화(임시비번 응답 획득)·PII/계좌 덮어쓰기 = **계정 탈취**.

**근본원인**: 12차에서 계약 경로에만 `CONSENTED` 규칙을 넣고 형제 라우트(workers/[id]·worker-accounts·verify-*)에 전파 안 함.

**근본수정**: `lib/worker/agencyScope.workerBelongsToAgency` **단일 소스** 신설(계약 이력 OR CONSENTED 배정=ACCEPTED/ASSIGNED/CONFIRMED/ACTIVE/ENDED). 6개 관문 + 직접배정이 전부 import → "한 곳만 조이고 형제 누락"을 구조적으로 차단.

**정책 확정(사용자)**: 타 기관 워커 상호작용은 ①이 기관 히스토리 OR ②전화 소개(→배정요청, 워커 수락 필수)만.

동시 확정: #4 audit-package 동명이인 훈련생 폴더 충돌·#5·#6 근태 KST 시각.

---

## 14차 — 응답 PII echo·급여·동시성 (`780ed55..ada5953`)

- **#1(P1)** admin/assignments `mode=request` 응답이 loginId(전화)·phoneNumber echo → id 열거로 전 워커 전화 수집. → 미관계 워커 응답 마스킹 + logAccess (★반쪽수정: POST만 막음)
- **#2(P2)** 주휴수당 개근을 소정근로일 아닌 아무 출근일 카운트 → 비소정일/공휴일 출근이 소정일 결근 상쇄. 소정요일(계약 파생)·비공휴일 출근만 카운트. **dev 데이터 영향 0건(무해) → 유지**, 개근 정의 전반은 노무사 큐.
- **#3(P2)** 홈 알람 시각을 computeWorkTimes 단일소스로 통일. **#4(P3)** finalize selDetails 락 안 재조회. **#5(P3)** 운영자 재설정 isTemporary.

---

## 15차 — B: enabler 근본 차단 (`ada5953..41b39c5`)

14차 마스킹이 반쪽(POST만)임이 드러남 — 형제 GET/목록/export가 같은 PII echo. **사용자 지시 = B(증상 아닌 원인)**.

**B**: PII 누출의 공통 전제는 `mode=request`가 임의 workerId로 REQUESTED 소속행을 무제한 주입하는 것. **미소속 워커 요청은 그 워커의 전화번호 제시(by-phone 정규경로)를 요구** → id 순차 열거 불가 → 주입행 자체가 안 생겨 **하류 목록/상세/export 누출이 전부 동시에 소멸**. UI(manager/workers)는 recipient의 phone 전송. 소속 워커·운영자는 예외. 매니저가 임의 워커로 배정행 만드는 경로는 admin/assignments 유일함 전수 확인.

동시: #4 admin/logs 훈련일지 `attendance.site.agencyId` 스코프(멀티기관 타현장 일지 유출)·#6·#7 export 기본 날짜 KST. #5(같은날 2배정 주휴 평균) → 노무사 큐.

---

## 16차 — B 종결 확증·형제 잔여 정리 (`41b39c5..bc9ce04`)

확정 3건 전부 P2(P0/P1 없음) = **B가 mass 열거를 닫음**. 남은 표적형 잔여 2건:
- **worker-accounts 목록**: baseAssign에 status 필터 없어 미소속(REQUESTED/거절/만료) 노출. some에 CONSENTED 적용(상세 [id]는 13차에 이미 403·목록 놓친 형제 갭).
- **payroll/contracts POST**: 임의 workerId 급여계약 주입 belongs 검사 없음 → workerBelongsToAgency 추가.

**전수 grep 스윕**: 워커-소속행 생성 라우트(assignments·contracts·payroll·recruit) 전부 게이트 확인, 워커 PII echo 라우트 ~30개 중 대부분은 소속 함의 아티팩트(출근·계약·지원·현장)로 스코프됨 확인 → 실누출은 위 2건뿐.

---

## 신규 파일/헬퍼

- `lib/worker/agencyScope.ts` — `workerBelongsToAgency`·`CONSENTED_ASSIGN_STATUSES` 단일 소스. 크로스테넌트 워커 판정을 쓰는 모든 관문이 공유.

## 노무사 대기 큐 (미결·정책)

- 주휴수당 개근 판정 전반(count-프록시·지각/조퇴 처리)
- 같은날 2배정 워커 주휴 '1일 소정근로시간' 평균(computeRun:463)
- P1-13 MONTHLY 개근월 휴일가산
- 프리랜서(3.3% BUSINESS) 근로기준법 가산 자동적용
- 9차 #8 휴일근로+연장 겹침 과소지급

## 다음 세션 시작점

1. **17차 전수 재감사** — 크로스테넌트 PII 클래스 소진 확인(P2 잔여도 안 나오면 종결 선언).
2. 노무사 결정이 오면 급여정책 큐 일괄 처리.
3. 운영 스모크: Vercel 빌드 · 배정요청(by-phone 전화 확인) · worker-accounts 목록 · 급여계약 흐름.
