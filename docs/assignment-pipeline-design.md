# 직무지도원 배정 파이프라인 정식 설계서

> 작성: 2026-06-14 · 상태: 구현 진행 중
> 목적: "근로계약서 ↔ 배정 ↔ 출근부"가 끊겨 있고, 초대가 계약을 우회하는 샛길이 된 현 구조를
> **모집/선정 → 계약 → 연결 → 위치확정 → 출근부**로 이어지는 단일 파이프라인으로 정상화한다.

---

## 1. 배경 & 문제 (현 상태)

- `SiteAssignment.status` enum은 `ASSIGNED / CONFIRMED / ACTIVE / REJECTED / DROPPED / ENDED`로 이미 생명주기를 표현할 수 있으나, **모든 생성 경로가 즉시 `ACTIVE`로 박아** 단계가 사문화됨(이유: 급여·근태·구독 집계 누락 방지 주석).
- 배정 생성 4경로: ①운영자 `POST /api/admin/assignments` ②워커 초대 수락 `worker/invite/[id]` ③매칭 지원 수락 `recruit-applications/[id]` ④매칭 오퍼 수락 `worker/recruit/offers`.
- 매니저 화면엔 신규 배정 생성 UI가 없음. 유일 경로 = 워커 초대(현장 선택은 선택사항) → 수락 시 **현장·기관·시작일·ACTIVE만** 생성, 근무정보는 전부 기본값.
- `EmploymentContract`에 `assignmentId`·`workerFilled*` 필드가 있으나 생성 흐름에서 **한 번도 채워지지 않음**. 계약서는 `siteName`(자유 텍스트)만 보관, 배정과 구조적 연결 없음.
- 결과: 근무형태·시간·출퇴근지도·기간을 계약서와 배정 모달에 **이중 입력**, 불일치 위험. "계약 없이 배정" 가능.

---

## 2. 표준 파이프라인 (상태기계)

| 단계 | 행위자 | 시스템 동작 | 배정 상태 |
|---|---|---|---|
| 1. 현장 등록 | 위탁기관 담당자 | `Site` 생성 | — |
| 2. 모집 | 담당자 | `RecruitPost` 생성·공개 | — |
| 3. 지원 | 직무지도원 | `RecruitApplication`(PENDING) | — |
| 4. **선정(컨펌)** | 담당자 | 후보 평가 → 1인 선정, 나머지 REJECTED, **배정 생성** | **`ASSIGNED`** (계약 대기) |
| 5. 계약 작성요청 | 담당자 | `EmploymentContract` 생성(**`assignmentId` 연결**) + 알림톡(UI_6030) | `ASSIGNED` |
| 6. 직무지도원 회신 | 직무지도원 | 계약 정보 입력·서명 → `status=SIGNED` | `ASSIGNED` |
| 7. **계약 완료** | 담당자 | 확인·추가작성·서명 → `status=COMPLETED` + **근무정보 배정 write-back** + **연결 발송** | **`CONFIRMED`** (연결 대기) |
| 8. 연결 | 직무지도원 | 신규=임시비번 로그인 / 기존=인증코드 입력 → `connectedAt` | `CONFIRMED` |
| 9. **최초 위치확정** | 직무지도원 | 현장 첫 방문 GPS → `SiteBasePoint(WORKER_FINAL)` → `baseConfirmedAt` | **`ACTIVE`** |

- 진입 경로 4단계는 3갈래(아래 §5) 모두 **`ASSIGNED` 배정 생성**으로 수렴.
- **출근부 개방 조건 = `status === ACTIVE && baseConfirmedAt != null`.**

---

## 3. 상태 의미 사전 (canonical semantics)

| status | 의미 | 매니저 목록 노출 | 구독 인원/급여 | 워커 홈 |
|---|---|---|---|---|
| `ASSIGNED` | 선정됨, 계약 진행 중 | ✅ (계약 진행 뱃지) | ❌ 미집계 | 배정 표시(계약 진행 안내) |
| `CONFIRMED` | 계약 완료, 연결/위치확정 대기 | ✅ (연결 대기 뱃지) | ❌ 미집계 | 배정 표시(위치확정 안내) |
| `ACTIVE` | 정상 근무(출근부 가능) | ✅ | ✅ 집계 | 정상 |
| `REJECTED` | 선정 탈락/계약 거절 | ❌ | ❌ | ❌ |
| `DROPPED` | 중도 이탈 | 필터 시에만 | ❌ | ❌ |
| `ENDED` | 계약 종료 | 필터 시에만 | ❌(종료월까지 급여는 별도) | ❌ |

**원칙**
- "배정 보유(engaged)" = `{ASSIGNED, CONFIRMED, ACTIVE}` → 매니저 목록·워커 홈·planGuard engagement.
- "과금/급여(billable)" = `{ACTIVE}`만 → 구독 인원·급여 run·대시보드 활성 카운트.
- 이 분리는 **현재 코드와 이미 일치**(planGuard/homeSummary/workers목록=3종, subscription/payroll/dashboard=ACTIVE). 따라서 "즉시 ACTIVE"만 제거하면 집계는 의도대로 동작. §9에서 전수 검증.

---

## 4. 데이터 모델 변경 (마이그레이션)

`SiteAssignment` 신규 컬럼:
```prisma
connectedAt     DateTime? @map("connected_at")      // 워커가 임시비번 로그인/인증코드로 배정 연결한 시각
baseConfirmedAt DateTime? @map("base_confirmed_at")  // 최초 현장 위치확정(WORKER_FINAL) 시각 — 출근부 게이트
```
- `EmploymentContract.assignmentId` — 스키마 그대로, 실제로 채워 사용.
- 연결 토큰: `WorkerInvite` 확장. 신규 컬럼 `existingWorkerId BigInt?`(기존 유저 연결용·계정 미생성), `assignmentId BigInt?`(연결 대상 배정), `purpose`(`NEW_ACCOUNT`|`CONNECT_EXISTING`). 코드(인증번호)는 기존 invite code 재사용.
- 마이그레이션 파일: `prisma/migrations/2026061500xxxx_assignment_pipeline/`.

---

## 5. 진입 경로 3갈래 (모두 §2-4단계로 합류)

1. **모집→지원→선정**: `RecruitApplication` 수락 시 배정을 `ACTIVE`가 아니라 **`ASSIGNED`**로 생성. workType 기본값 강제(FULL_DAY) 제거 — 근무정보는 7단계 write-back까지 비움.
2. **멀티 초대(모집 없이)**: 담당자가 후보 다수 선택 → 각자에게 초대 발송. 단 "빈 배정 즉시 ACTIVE" 폐기 → 수락 시 **`ASSIGNED`** 배정 + 계약 단계로.
3. **지정 초대(특정 1인)**: 후보 1인 지정 초대. 동일하게 `ASSIGNED`로 수렴.

→ 기존 `worker/invite/[id]` 수락 로직의 "siteId 있으면 ACTIVE 배정 생성"을 `ASSIGNED` + 계약 트리거로 교체.

---

## 6. 계약 ↔ 배정 연결

- `POST /api/admin/contracts`: 입력에 `assignmentId`(또는 `siteId`+`workerId`) 추가. 계약 생성 시 `assignmentId` 채움.
- **계약 완료(`COMPLETED`) 시 write-back** (`PATCH /api/admin/contracts/[id]` 또는 서명 완료 훅):
  - `assignment.workType / commuteGuidanceIncluded / customWorkStart / customWorkEnd` ← 계약값
  - `assignment.startDate ← contractStart`, `assignment.endDate ← contractEnd`
  - `assignment.status ASSIGNED → CONFIRMED`, `confirmedAt = now`
  - 연결 발송(§7) 트리거.
- 배정 설정 상세 모달의 근무정보 입력은 **계약이 진실원본일 때 읽기 표시**(B안 보조) — 단 운영자/예외 수정은 허용.

---

## 7. 연결 단계 (신규/기존 분기)

계약 완료 시 대상 직무지도원 **계정 존재 여부**로 자동 분기:
- **신규(계정 없음)**: 임시 Worker 계정 생성 + **아이디·임시비밀번호 알림톡**(기존 신규가입 템플릿 UI_6009 계열) → 로그인 시 `connectedAt`.
- **기존(이미 가입)**: 계정 미생성. **인증코드 발급**(`WorkerInvite.purpose=CONNECT_EXISTING`) → **알림톡(신규 템플릿 필요)** 발송 → 앱에서 코드 입력 → 본인 계정에 배정 연결, `connectedAt`.
- **백업 채널**: 앱 푸시(웹푸시) — 후속(보류). 1차는 알림톡.

신규 알림톡 템플릿: `KAKAO_ASSIGN_CONNECT_TEMPLATE_CODE`(가칭) — "[현장명] 배정 연결 인증코드 {코드}".

---

## 8. 위치확정 게이트

**근거**: 기준점이 없거나 워커가 확정하지 않으면 출근 거리·반경·범위밖 사유·GPS 보정 감지가 전부 허수.

- 게이트 = 해당 현장에 **`SiteBasePoint(stage=WORKER_FINAL, confirmedByWorkerId=본인)`** 존재 (= `assignment.baseConfirmedAt` 세팅).
- **서버**: `clock-in`/`clock-out`이 위치 미확정이면 거부 `LOCATION_NOT_CONFIRMED`(409). 현행 "현장 기준점 유무" 검사보다 강함(매니저가 찍은 좌표만으로는 불충분).
- **앱 UI**: 위치 미확정 시 출근/퇴근 버튼 비활성 + **"현장 위치 확정하기"** CTA → 첫 방문 GPS로 `WORKER_FINAL` propose/confirm → 확정 후 출근 버튼 활성, `assignment.status CONFIRMED → ACTIVE`.

---

## 9. 집계 정합성 — 소비처별 필터 규칙 (Phase 1 점검 대상)

| 파일 | 현재 필터 | 규칙 | 조치 |
|---|---|---|---|
| `lib/planGuard.ts:83,179` | `[ASSIGNED,CONFIRMED,ACTIVE]` engagement | 유지(배정 보유) | 변경 없음 |
| `lib/planGuard.ts:336` | `ACTIVE` 구독 인원 | billable=ACTIVE | 유지 |
| `lib/worker/homeSummary.ts:98` | `[ASSIGNED,CONFIRMED,ACTIVE]` | engaged | 유지 + 위치확정 전 안내 분기 추가 |
| `app/api/admin/subscription/route.ts:18` | `ACTIVE` | billable | 유지 |
| `app/api/admin/payroll/runs/route.ts:97` | `ACTIVE` | billable | 유지 |
| `app/api/admin/dashboard/route.ts:71,84` | `ACTIVE` | billable | 유지 |
| `app/api/admin/workers/route.ts:75,107` | `[ASSIGNED,CONFIRMED,ACTIVE]` | engaged 노출 | 유지 + 상태 뱃지 추가 |
| 배정 생성 4경로 | `ACTIVE` 박음 | → `ASSIGNED` | **변경(핵심)** |
| `recruit-applications/[id]:중복가드` | `[ASSIGNED,CONFIRMED,ACTIVE]` | 유지 | 유지 |

→ 핵심 리스크: ACTIVE 즉시생성 제거 시 **구독 인원·급여가 "계약 전 인원"을 더 이상 세지 않음**(= 의도된 정상화). 단, **기존 운영 데이터의 ACTIVE 배정은 그대로 유지**(마이그레이션은 신규 컬럼만 추가, 상태 강등 없음).

---

## 10. Phase 분해 & 작업 목록

### Phase 1 — 배정 상태기계 정상화 + 집계 정합성
- [x] 마이그레이션: `connectedAt`, `baseConfirmedAt` 추가 (20260615100000)
- [x] 배정 생성 4경로 `ACTIVE → ASSIGNED` (매뉴얼 POST·초대수락·매칭수락·오퍼수락)
- [x] 매니저 배정 목록 상태 뱃지(계약 대기/연결·위치 대기/근무중)
- [x] §9 표 검증: billable=ACTIVE / engaged=[ASSIGNED,CONFIRMED,ACTIVE] 분리 확인(기존 코드와 일치)

### Phase 2 — 계약 ↔ 배정 연결
- [x] `contracts` POST에 `assignmentId` 입력·검증·저장
- [x] 계약 서명(SIGNED) 시 배정 write-back(근무정보·기간) + `ASSIGNED→CONFIRMED`
- [ ] **초대 3갈래 UI(멀티/지정)** — ⛔ 미구현 (배포 게이트, 아래 참조)
- [x] 배정 모달: 계약 연결 시(`hasContract`) 계약파생 필드 변경 경고

### Phase 3 — 연결 단계
- [x] `WorkerInvite` 확장(existingWorkerId/assignmentId/purpose) (20260615120000)
- [x] 신규=임시비번+connectedAt자동 / 기존=인증코드 분기 발송(sendConnectCodeExisting)
- [x] 앱 코드 입력 화면 `/worker/connect` + `POST /api/worker/assignment/connect` → `connectedAt`
- [x] clock-in 연결 게이트 `ASSIGNMENT_NOT_CONNECTED` + 앱 라우팅
- [ ] **알림톡 신규 템플릿 등록(KAKAO_ASSIGN_CONNECT_TEMPLATE_CODE)** — 외부 작업(미등록 시 앱 내 알림 폴백 동작)

### Phase 4 — 위치확정 게이트
- [x] `clock-in` `LOCATION_NOT_CONFIRMED` 거부 (clock-out은 clock-in 통과 후라 불필요)
- [x] `propose` 위치확정 시 `baseConfirmedAt` + `CONFIRMED→ACTIVE` (이미 확정 현장 승인 분기 포함)
- [x] 앱 출근 시 "현장 위치 확정" 다이얼로그 → propose → 출근 재시도
- [ ] (선택) 홈 프로액티브 배너(현재는 출근 클릭 시 안내)

---

## 배포 게이트 (deploy 전 점검)

1. **[해결] 매니저 → ASSIGNED 워커 계약서 작성/발송 UI**: 배정 설정 상세 모달 푸터 **"계약서 작성·발송"**
   → `/manager/contracts?assignmentId=&workerId=`로 진입, 배정 정보 프리필 + `assignmentId` 연결되어
   계약 생성. 서명 시 write-back으로 `ASSIGNED→CONFIRMED`. (결정#2 배정+계약 합치기)
   → 이로써 신규 워커가 ASSIGNED에서 막히지 않고 파이프라인을 끝까지 탈 수 있음. **배포 차단 해소.**
2. 알림톡 `KAKAO_ASSIGN_CONNECT_TEMPLATE_CODE` 등록(외부, `docs/alimtalk-assign-connect-template.md`).
   미등록 시 앱 내 알림으로 코드 전달되는 폴백 동작 → **비차단**.
3. 배포 시 마이그레이션 3건 적용: 20260615100000 / 110000 / 120000 (로컬·운영 DB 적용 완료).

### 남은 enhancement (배포 비차단)
- [x] **초대 멀티/지정 UI** (2f661a7): InviteModal 다수 수신자(현장 공통 + 후보 행 추가/삭제 +
  일괄 발송 + 결과 목록). 1명=지정, 여러 명=멀티. 수락 시 ASSIGNED 수렴.
- [ ] 모집→지원→선정 마켓플레이스 오픈(차후 product 결정 — 결정#1로 이번 제외).
- [ ] (선택) 워커 홈 프로액티브 배너(연결/위치 필요 사전 표시).

---

## 11. 알림톡 템플릿
- 기존: UI_6030(계약서)·UI_6009(신규가입)·UI_6011(평가) — 승인완료.
- 신규: 연결 인증코드 1종 — 등록 필요(`KAKAO_ASSIGN_CONNECT_TEMPLATE_CODE`).
