# 워커 앱 멀티 현장 선택 설계 (로그인 선택 + 오전/오후 전환 스위처)

**작성 2026-07-01.** 직무지도원이 같은 날 여러 현장에서 근무(예: 오전 A현장 / 오후 B현장, 또는 같은 현장 오전+오후)하는 경우를 지원한다. **★핵심 원칙: 멀티(오늘 활성 배정 2개 이상)일 때만 예외적으로 동작. 단일 배정 워커는 현행과 100% 동일 — 어떤 선택 UI도 뜨지 않는다.**

## 배경 (현재 상태 — 조사 결과)

- 현재 워커 앱에는 **현장 선택 UI가 전혀 없다.** 모든 흐름이 `findFirst`로 배정 1개를 암묵 선택한다.
  - `lib/worker/homeSummary.ts:108` — `assignments[0]` (orderBy 없음 → 멀티 시 임의).
  - `app/api/worker/site/current/route.ts:26-38` — `findFirst(status ACTIVE, orderBy startDate desc)` → 일지가 항상 한 배정에만 붙음.
  - `app/api/attendance/clock-in/route.ts:106-113` — `findFirst(orderBy assignedAt desc, id desc)` → 시간대 무관하게 하나만.
- **DB는 이미 멀티 지원.** `DailyAttendance @@unique([assignmentId, workDate])` (schema.prisma:431). 하루에 배정별 여러 출근부 저장 가능 → **마이그레이션 불필요.**
- **유일한 앱 레벨 블로커**: `clock-in/route.ts:76-90` 중복체크가 `workerId + workDate`로만 판정 → 같은 날 두 번째 배정 출근이 `ALREADY_CLOCKED_IN`으로 차단됨. **코드 수정만 필요.**
- **급여·출근부는 이미 배정(현장)별 처리 완료**(2026-07-01 #4). 멀티 출근부 2건이 생기면 급여 1:多·출근부 표기는 자동으로 현장별 정확 계산됨.
- **다른 위탁기관 멀티**는 이미 기관별 급여런으로 분리됨. 본 설계는 주로 **워커 앱의 일상 동작(출근·일지)**을 멀티에서 올바르게 만드는 것.

## 핵심 원칙

1. **멀티일 때만.** 오늘 활성 배정이 1개면 자동 선택(무프롬프트), 0개면 현행, 2개+일 때만 선택/스위처 노출.
2. **선택은 명시적·전환 가능.** 로그인 직후 1회 선택 + 하루 중 헤더 스위처로 오전→오후 전환.
3. **선택은 모든 일상 액션의 컨텍스트.** 출근/퇴근/일지/출근부가 선택된 배정에 귀속.

## 1. 활성 배정 컨텍스트

- **신규 API** `GET /api/worker/assignments/active`
  - 반환: 오늘(KST) 활성(status ACTIVE, startDate≤today≤endDate|null) 배정 목록
  - 각 항목: `{ assignmentId, siteId, siteName, agencyName, workType(AM|PM|FULL_DAY|CUSTOM), traineeCount, workStart, workEnd }`
- **선택 저장 = 쿠키** `wk_active_assignment` (assignmentId)
  - 서버(homeSummary, site/current)와 클라(스위처) 모두 읽음.
  - **서버에서 반드시 검증**: 해당 워커 소유 + 오늘 활성. 무효/없음이면: 단일이면 자동선택, 멀티면 미선택 취급(선택 유도).
  - 쿠키를 쓰는 이유: 서버 렌더(homeSummary)와 여러 API가 공유해야 하므로. (localStorage는 서버가 못 읽음)

## 2. 로그인 → 현장 선택 게이트 (멀티일 때만)

- `app/worker/login/page.tsx:41` `router.replace("/worker/home")` 직전(또는 home 진입 가드)에서 활성 배정 수로 분기:
  - **0개** → home (현행, 변화 없음)
  - **1개** → 쿠키 자동 세팅 → home. **선택 화면 없음**
  - **2개+** → **현장 선택 화면**(`/worker/select-site` 또는 모달): 카드 목록(현장명·위탁기관·**오전/오후 배지**·훈련생 수·시업~종업) → 탭 → 쿠키 세팅 → home

## 3. 헤더 오전/오후 전환 스위처 (멀티일 때만)

- `app/worker/home/HomeClient.tsx:812-818`의 현장 배지를 **전환 칩/드롭다운**으로 승격:
  - 현재 선택 현장명 + 오전/오후 배지 표시, 탭하면 활성 배정 목록에서 전환.
  - 단일 배정이면 기존처럼 **읽기 전용 배지**(전환 UI 없음).
- **스마트 기본값**: 진입 시각으로 제안(대략 12:30 이전 = 오전 배정, 이후 = 오후 배정). 단 항상 수동 override 가능 → "오전→오후 전환"을 한 손동작으로.
- 전환 시: 쿠키 갱신 + home summary 재조회(선택 배정 기준).

## 4. assignmentId 전파 (선택 배정을 모든 흐름에)

- `lib/worker/homeSummary.ts:108` — `assignments[0]` → **쿠키 배정 매칭**(폴백: 단일/첫). summary에 `activeAssignments[]` + `activeAssignmentId` 추가(스위처 렌더용).
- `app/api/worker/site/current/route.ts` — `?assignmentId=`(또는 쿠키) 수용해 그 배정 반환. `worklog/page.tsx`·`worklog/batch/page.tsx`가 선택 assignmentId 전달.
- `clock-in`/`clock-out`/`bulk-generate` — 클라가 선택 assignmentId 전달(서버는 이미 optional 수용). `clock-out/route.ts`도 배정 스코프로 조회.

## 5. clock-in 중복체크 수정 ★핵심 (마이그 불필요)

- `app/api/attendance/clock-in/route.ts:76-90` 중복체크를 `workerId + workDate` → **`assignmentId + workDate`**로 변경(DB 유니크와 일치).
- 이 한 가지만으로도 AM@X, PM@Y를 같은 날 각각 기록 가능해진다(스위처가 assignmentId를 넘겨준다는 전제).

## 엣지 케이스

- **같은 현장 오전+오후**: 배정 1개가 하루를 커버하면 분리 불필요(스위처 미노출). 배정이 2개(오전 배정/오후 배정)면 각각 선택.
- **GPS 기준점**: 배정별 site로 해석되므로 clock-in이 이미 올바른 현장 기준점 사용.
- **쿠키 변조**: 서버에서 워커 소유·활성만 허용, 무효 시 재선택.
- **전일(FULL_DAY)**: 물리적으로 멀티 불가 → 활성 배정이 FULL_DAY 1개면 단일 취급.

## 단계 (phasing)

- **P0** — `clock-in` 중복체크 assignment 스코프화(코드 1곳). 단독으로도 멀티 출근부 기록 가능해짐.
- **P1** — `assignments/active` API + homeSummary(activeAssignments/쿠키 매칭) + 로그인 선택 게이트 + 헤더 스위처(멀티만).
- **P2** — worklog/site-current/bulk-generate 전파 + 스마트 시간대 기본값.

## 연관

- 급여 현장별 계산: `lib/payroll/computeRun.ts`, `lib/docs/attendanceSheetPayload.ts` (2026-07-01 완료).
- 같은 위탁기관 내 **다른 시급/다른 근로계약** 필요 시엔 PayContract per-assignment 모델링 별건(드묾, memory `audit_data_consistency_2026_07_01` 참고).
