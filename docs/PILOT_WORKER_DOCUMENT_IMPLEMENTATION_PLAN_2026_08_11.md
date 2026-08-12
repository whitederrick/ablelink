> # ⚠️ 폐기된 문서 — 구현·요구사항 참조 금지
>
> 이 문서는 **직무지도원 자가 프로비저닝 모델**의 과거 v3 구현 계획이며 **현재 운영 모델과 일치하지 않습니다.**
> P0(PDF 스윕 baseline)만 v1.7에서 승인 상태로 계승되었고, **P1~P8은 전부 폐기**되었습니다.
> 특히 이 문서의 "demo 초대 `siteId` 이중 방어"·"파일럿 기관에 Manager 최소 1명" 결정은 **역전**되었습니다.
>
> **최종 기준 문서: `docs/PILOT_DESIGN_2026_08_12_v1_7.md`** (구현 순서는 §16, 구현 항목은 §17)
>
> 본 문서는 **의사결정 이력 보존 목적으로만** 유지합니다.

---

# 직무지도원 문서 파일럿 구현 계획 v3 — Claude 2차 검토 반영안 (폐기)

작성일: 2026-08-11  
상태: **계획 검토 전용 · 구현 미착수**  
상세 설계: `docs/PILOT_WORKER_DOCUMENT_SERVICE_DESIGN_2026_08_11.md`

---

## 0. 구현 목표

기존 운영 앱 안에 `/pilot` 전용 경로를 추가한다. 소수의 직무지도원이 사업체·근무기간·훈련생을 직접 입력하고,
출퇴근 버튼 기록 없이 확인한 근무일로 출근부와 훈련생별 일지를 작성한 뒤 사업체 담당자·본인 서명을 넣어
PDF를 내려받을 수 있게 한다. 위탁기관 담당자 이름은 화면에서 입력하거나 PDF 출력 후 수기로 작성할 수 있어야 한다.

핵심 원칙:

- 별도 파일럿 테이블·별도 DB를 만들지 않는다.
- 기존 운영 테이블을 `Agency.isDemo`로 격리해 재사용한다.
- 기존 worker 로그인·초대, 일지, 서명, PDF 엔진을 재사용한다.
- D-1과 `TraineeSupervision`은 도입하지 않는다.
- 운영 `DocumentRun` 제출·공단발송·급여에는 연결하지 않는다.
- v1은 PDF 전용이며 Word/HWP 생성은 하지 않는다.

---

## 1. 확정 결정

1. 파일럿 데이터 격리: 기존 테이블 + `Agency.isDemo` 방식
2. 담당 관계: **파일럿 Site 데이터 행 1개당 worker 1명**, worker 1명당 훈련생 여러 명
3. 근무일: 기본 근무시간 자동 제안 후 worker가 체크·수정·확정하며, 확정 후에도 수정 가능
4. 문서: PDF 미리보기·다운로드 전용, 운영 `DocumentRun` 미사용
5. 위탁기관 담당자: 선택 입력 이름 + 미입력 시 최소 40mm 필기 공간, 전자서명 없음
6. 파일럿 참여: demo Agency의 `WorkerInvite.existingWorkerId` 또는 `usedByWorkerId`, 또는 demo assignment로 판정
7. 파일럿 기관: `planType=PRO`, `maxWorkers=0`, `maxSites=0`으로 설정
8. 쿼터: `/api/pilot/**`은 일반 기관 생성 API와 분리하고 `checkQuota`를 호출하지 않되, 공통 `checkQuota`에는 demo 우회 분기를 추가하지 않음
9. 파일럿 기관에는 초대 발급을 담당할 Manager 계정이 최소 1개 있어야 함

**v3 추가 확정**

10. 근무일 수정 API는 **delta(`add`/`update`/`remove`)** 방식이며 `PATCH /api/pilot/workdays`다.
    서로 다른 날짜의 동시 수정이 서로를 덮어쓰지 않게 한다.
11. 같은 날짜 동시 수정은 **`expectedUpdatedAt` 불일치 시 409**로 거부한다.
12. 파일럿 훈련생은 **직무지도원 1명당 5명** 상한(`lib/rules.ts:7`과 값 일치). PDF 검증 범위도 **1~5명** 고정.
13. `SiteAssignment.attendanceMode = NONE`으로 확정.
14. 회귀 기준선은 **Vitest 416건**과 **PDF 기간 스윕 519케이스**를 **별개 기준**으로 관리한다.
    후자의 스윕 스크립트는 리포에 없으므로 **P0에서 신규 작성**한다.

하나라도 바뀌면 상세 설계의 데이터·권한·테스트 범위를 함께 갱신한다.

---

## 2. 단계별 구현 계획

### Phase P0 — 기준선과 안전장치

**상태: ✅착수 승인됨 (2026-08-11). 범위는 아래로 제한한다.**

승인 범위:

1. Vitest **416건 기준선 재확인**
2. `scripts/verify-pdf-sweep.mts` **신규 작성**
3. **28~200일 × 시작요일 3종 = 519케이스 실행**
4. **확인문구·작성일·서명 3행이 동일 페이지**에 있는지 검증
5. 개편 전 **baseline 확보 — 관측값을 그대로 기록한다**

★**baseline은 목표치가 아니라 관측 사실이다(2026-08-11 확정).**
이번 실행에서 분리가 0건이 아니어도 그것이 현재 코드의 사실이므로,
**0건을 만들려고 코드를 고치지 않는다.** 관측된 수치를 그대로 baseline으로 기록한다.
따라서 P6·P8의 판정 기준은 "분리 0건"이 아니라 **"baseline 대비 악화 없음"** 이다.
(0건을 통과 조건으로 두면, baseline이 0이 아닐 때 P0에서 무단으로 코드를 고치게 된다.)

★**애플리케이션 코드·스키마·마이그레이션 변경 금지.**
신규 스크립트 1개와 그 산출물 외에는 어떤 파일도 수정하지 않는다.
P1 이후 단계는 각각 별도 승인 대상이다.

목적: 구현 전 현재 동작을 고정하고 파일럿 범위가 운영 경로로 번지지 않게 한다.

작업:

- 현재 `prisma/schema.prisma`, worker session, WorkerInvite, Site/Assignment 생성 규칙 확인
- **PDF 출근부 기간 전수 스윕 스크립트 신규 작성**(28~200일 × 시작요일 3종 = 519케이스)
- 개편 전 스윕을 1회 실행해 **기준 출력 확보** — 서명 블록 분리 건수를 **관측값 그대로** 기록
- PDF 5종의 기존 렌더 스냅샷 확보(`scripts/verify-pdf.mts` 기반, 훈련생 1~5명 변형 포함)
- 파일럿 비범위 테스트 작성: 공단발송·급여·운영 DocumentRun 호출 금지
- `/pilot` metadata에 `noindex, nofollow`

★**스윕 스크립트는 신규 작성이다.** v2까지 "기존 519개 테스트"로 적혀 있었으나 실측 결과
Vitest는 **416건**이고 519는 `docs/WORK_STATUS_2026_07_20_PDF_SIGNATURE.md:10`의 PDF 스윕 **케이스 수**다.
그 스윕은 2026-07-20 당시 커밋되지 않았다. 현재 리포의 PDF 스크립트는 `scripts/verify-pdf.mts` 하나뿐이고
**문서당 1건씩 고정 5케이스**만 렌더하며, 그 출근부는 10일치라 **페이지 분할이 일어나지 않아**
P6의 `signatures()` 개편 회귀를 잡지 못한다. 이 스크립트 없이 P6에 착수하지 않는다.

완료 기준:

- **Vitest 416건 통과**(`npx vitest run` → `Tests 416 passed`)
- TypeScript 0 · production build 0
- **스윕 스크립트 동작 확인 + 519케이스 개편 전 baseline 확보(관측값 그대로 기록·문서화)**
- PDF 5종 기준 출력 보관
- 구현 대상/비대상 목록이 상세 설계와 일치

변경 예상:

- `scripts/verify-pdf-sweep.mts` 신규(519케이스 스윕)
- `__tests__/pilot-boundary.test.ts` 신규
- PDF 기준 fixture 또는 시각검증 체크리스트

### Phase P1 — 파일럿 기관 플래그·접근 가드·필수 운영 격리

**착수 전 확정 필요 1건 — demo 초대에 `siteId`가 들어온 경우의 동작**

권고는 **이중 방어**다. 단 두 계층의 처리를 **다르게** 해야 한다.

| 계층 | 처리 | 이유 |
|---|---|---|
| 초대 **생성** (매니저) | demo agency면 `siteId` 지정을 **거부(400/403)** | 잘못된 초대가 애초에 발급되지 않게 원천 차단 |
| 초대 **수락** (`worker/invite/[id]:134`) | `siteId`가 있어도 **배정 분기만 건너뛴다**. 가입은 성공 + 감사로그 경고 | ★수락 단계에서 403하면 **계정 생성까지 막힌다** |

★**수락 API를 통째로 403으로 막으면 안 되는 이유**: 이 라우트는 `worker.create`(`:115`)와
assignment 생성(`:135`)을 **한 트랜잭션**에서 처리한다. 403으로 전체를 거부하면 이미 발급된 잘못된 초대를 받은
파일럿 참여자가 **계정 자체를 만들지 못하고 잠긴다**. 매니저가 초대를 재발급해야만 풀린다.
배정 분기만 건너뛰면 참여자는 정상 가입 후 `/pilot/setup`으로 진행하며, 이는 설계가 의도한 흐름과 정확히 같다.

즉 "위반 입력 차단"의 지점은 **생성 시점**이고, 수락 시점은 **무해화(skip)** 다.
이 구분을 확정한 뒤 P1을 착수한다. P0 진행은 막지 않는다.

목적: 파일럿 데이터를 같은 DB에서 운영 데이터와 구분한다.

작업:

- `Agency.isDemo Boolean @default(false) @map("is_demo")` 추가
- `[isDemo, isActive]` index migration
- `PILOT_AGENCY_ID` 환경변수 문서화
- pilot Agency를 `planType=PRO`, `maxWorkers=0`, `maxSites=0`으로 생성하고 Manager 1명 이상 준비
- `requirePilotWorker(req)` 공통 가드 구현
- `WorkerInvite.existingWorkerId`/`usedByWorkerId` 또는 demo assignment 관계 검증
- `/api/pilot/**`이 일반 생성 API의 `checkQuota`를 호출하지 않음을 코드와 테스트로 고정
- `/pilot` 및 `/api/pilot/**` 외에서 파일럿 셀프 등록 불가
- 데이터 생성 전에 다음 3곳에서 `isDemo=true` 기관 하드 제외 (위험도 순)
  - `lib/leave/runAccrual.ts:80` — **연차 자동 적립. `{isActive:true}`만 보고 전 기관을 순회하므로 실제 위험이 가장 크다**
  - `app/api/cron/daily/route.ts:437` — 급여 DRAFT 자동 생성(`payrollAutoDay` 미설정으로 자연 회피되나 값에 의존하지 않음)
  - `app/api/payments/charge/route.ts:59` — 결제 대상 조회. **심층방어**: 조회 조건이 `tossBillingKey != null` AND
    `tossCustomerKey != null` AND `nextBillingAt < tomorrow`라 빌링키 없는 파일럿 기관은 구조적으로 청구 대상이 될 수 없다
- **8곳**의 assignment 생성 경로에서 demo Site/Agency 배정 하드블록.
  전수조사는 **두 축을 병행**한다 — ① `lib/assignmentLock.ts` 호출부(**주요 앵커이지 단일 관문이 아니다**)
  ② `siteAssignment.create` / `upsert` / `updateMany` 직접 검색
  - **락 경유 7곳**: `admin/assignments/route.ts:316` · `admin/assignments/[id]/route.ts:126` ·
    `admin/assignment-requests/route.ts:184` · `admin/recruit-applications/[id]/route.ts:166,167,168` ·
    `worker/assignment/respond/route.ts:106` · `worker/recruit/offers/route.ts:135,136` · `worker/contracts/route.ts:219`
  - ★**락 밖 1곳**: `app/api/worker/invite/[id]/route.ts:135` — **초대 수락**.
    `invite.siteId`가 있으면 `agencyId: invite.agencyId`로 `ASSIGNED` 배정을 직접 생성한다.
    `:131-133` 주석대로 **의도적으로 락·정원검사에서 제외**된 경로라 락 호출부만 훑으면 발견되지 않는다
- 초대 수락 경로 조치는 **정책 + 코드 양쪽**이다
  - 파일럿 초대는 **`siteId = null`로만 발급**(Site/Assignment는 `/api/pilot/setup`에서만 생성)
  - `invite.agencyId`가 demo면 `:134` 분기를 건너뛰거나 403 (매니저의 `siteId` 오입력 방어)
- 같은 락을 쓰지만 배정을 만들지 않는 `admin/leave/**`·`admin/payroll/runs/[runId]`는 대상이 아니다.
  `siteAssignment.update/updateMany` 22곳은 기존 배정의 **상태 전이**라 새 worker 부착이 아니지만,
  `assignment-requests/route.ts:228`의 `ACCEPTED → ASSIGNED` 승격처럼 demo Site 대상 승격이 있는지
  P1에서 함께 점검하고 결과를 설계 문서에 확정 기록한다

완료 기준:

- 초대/배정 관계 없는 worker는 403
- 유효 파일럿 worker만 context 조회 가능
- 참여자 N명이 각자 Site N개를 생성할 수 있음
- manager가 일반 배정 API로 demo Site에 worker를 배정하면 403
- **demo 기관 초대에 `siteId`가 있어도 수락 시 배정이 생성되지 않음**
- **파일럿 Site에 두 번째 배정이 어떤 경로로도 생기지 않음**(8경로 전부 검증)
- demo worker에 연차·급여 draft·결제 대상이 자동 생성되지 않음
- 클라이언트가 다른 agencyId를 보내도 무시·차단
- 운영 agency는 기존 동작 불변

변경 예상:

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_add_agency_is_demo/migration.sql`
- `lib/pilot/access.ts` 신규
- `app/api/pilot/context/route.ts` 신규
- `docs/env-vars.md`

### Phase P2 — `/pilot` 설정 마법사

목적: 직무지도원이 사업체·기간·근무형태·복수 훈련생을 직접 등록한다.

작업:

- `/pilot` 시작/이어하기 화면
- `/pilot/setup` 단계형 모바일 폼
- 사업체명, 담당자, 기간, 근무형태, **훈련생 1명 이상 5명 이하** 검증
- Site + SiteAssignment + Trainee[] + TraineePlacement[] 단일 transaction
- Site는 `WORKER_ENTRY`, `isVerified=false`, demo Agency 귀속
- assignment는 본인, `ACTIVE`, `connectedAt=now`, `attendanceButtonExempt=true`, `attendanceMode=NONE`
- ★훈련생 상한 5는 `lib/rules.ts:7`과 값만 일치시킨 것이고, 기존 검사(`admin/trainees/route.ts:82-90`)는
  `/api/pilot/setup`을 거치지 않으므로 **파일럿이 자체 검사해야 한다**
- 파일럿 Site 데이터 행 하나에 worker 한 명만 허용
- 중간 실패 전체 롤백 및 AuditEvent

완료 기준:

- 훈련생 1명/여러 명 등록 성공
- 잘못된 기간·CUSTOM 시간·빈 배열 거부
- 동일 요청 재시도 시 중복 프로젝트 방지
- 다른 worker가 생성 프로젝트를 조회할 수 없음

변경 예상:

- `app/pilot/page.tsx` 신규
- `app/pilot/setup/page.tsx` 신규
- `app/api/pilot/setup/route.ts` 신규
- `lib/pilot/setup.ts` 신규
- `__tests__/pilot-setup.test.ts` 신규

### Phase P3 — 근무일 미리보기·확정·수정

목적: 실제 출퇴근 버튼 없이도 정확한 출근부 원천 데이터를 만든다.

작업:

- 기존 `bulk-generate`의 날짜 열거·공휴일·근무시간 계산을 공통 helper로 추출
- preview API는 DB를 쓰지 않고 후보 날짜와 기본시간 반환
- UI에서 실제 근무일 체크/해제, 날짜별 시간 수정
- confirm API가 선택 날짜만 DailyAttendance로 저장
- 확정 후 동일 화면에서 날짜 추가·제외·시간 변경 가능
- 수정 API는 **전체 선택 집합이 아니라 delta**(`add`/`update`/`remove`)를 받는다 — `PATCH /api/pilot/workdays`
- `add`는 `daily_attendances(assignment_id, work_date)` unique를 키로 생성, 이미 있으면 409
- `update`는 시간만 갱신하며 일지가 있는 날짜도 허용
- `remove`는 종속 `TraineeLog`가 없을 때만 삭제, 있으면 409와 정리 안내
- `update`·`remove`는 `expectedUpdatedAt`을 함께 받아 불일치 시 409.
  ★**조회 후 비교가 아니라 `WHERE id AND updatedAt` 조건을 쓰기 구문에 실은 원자적 CAS**로 구현한다
  (`updateMany`/`deleteMany`의 `count === 0` → 409). 읽고 비교한 뒤 쓰면 검사 자체가 TOCTOU가 된다.
  기존 규율과 동일한 패턴이다 — `admin/document-runs/[id]/action/route.ts:69`
- 세 배열은 한 트랜잭션에서 처리하고 하나라도 409면 전체 롤백
- ★**`remove` 전 일지 존재 검사는 필수다.** `TraineeLog.attendanceId`가 `onDelete: Cascade`이므로
  (`prisma/schema.prisma:469`) `DailyAttendance`를 지우면 **DB가 일지를 조용히 함께 지운다.**
  `AttendanceIssue.dailyAttendanceId`도 동일하다(`:1328`). FK가 막아 줄 것으로 기대하지 않는다
- 미래일·주말·공휴일·기간 밖 날짜·중복 날짜 차단
- `actualStartTime/actualEndTime=null`, `status=DONE`
- demo assignment와 AuditEvent로 파일럿 자동작성 출처 기록

완료 기준:

- 확인하지 않은 날짜는 저장되지 않음
- 재확인/재시도에도 중복 attendance 없음
- 확정 후 잘못 입력한 날짜·시간을 새 프로젝트 생성 없이 수정 가능
- 일지가 있는 근무일의 무의식적 삭제 없음(409 후 `TraineeLog` 실제 잔존 확인)
- 서로 다른 날짜 동시 수정 시 둘 다 반영(lost update 없음)
- 같은 날짜에 낡은 `expectedUpdatedAt`이면 409
- 출퇴근 버튼 기록 없이 PDF 출근부에 확인 날짜·시간·합계 표시
- 기존 `/api/worker/attendance/bulk-generate` 동작 불변

변경 예상:

- `lib/attendance/workdayCandidates.ts` 신규
- 기존 bulk-generate route는 helper 사용으로 내부 정리
- `app/pilot/workdays/page.tsx` 신규
- `app/api/pilot/workdays/preview/route.ts` 신규
- `app/api/pilot/workdays/confirm/route.ts` 신규
- `app/api/pilot/workdays/route.ts` 신규(`PATCH`: delta 수정)
- `__tests__/pilot-workdays.test.ts` 신규

### Phase P4 — 파일럿 일지

목적: 확인된 근무일마다 훈련생 1명 또는 여러 명의 일지를 작성한다.

작업:

- `/pilot/logs` 모바일 화면
- 본인 demo assignment의 확인 근무일·훈련생만 조회
- 기존 일지 입력 필드와 AI 기능 중 파일럿에 필요한 최소만 재사용
- 기존 `TraineeLog`·`TraineeLogTask` 저장
- `(attendanceId, traineeId)` 기존 unique 활용
- 다른 worker/site/trainee 직접 ID 요청 fail-closed

완료 기준:

- 1명·다수 훈련생 일지 저장/수정
- 중복 일지 없음
- 타 프로젝트 PII 조회·저장 차단
- 기존 `/worker/worklog` 흐름 불변

변경 예상:

- `app/pilot/logs/page.tsx` 신규
- `app/api/pilot/logs/route.ts` 신규
- `lib/pilot/logs.ts` 신규 또는 기존 저장 서비스 추출
- `__tests__/pilot-logs.test.ts` 신규

### Phase P5 — 사업체 서명·직무지도원 서명

목적: 사업체 담당자와 직무지도원 서명을 문서 payload에 안전하게 넣는다.

작업:

- `/pilot/sign` 사업체 담당자 이름 prefill·수정·터치 서명
- 기존 SiteSignToken 저장 규칙 재사용
- pilot API는 `signRole=company_manager`만 허용하고 `gov_agent` 토큰 발급 요청은 403
- 서명은 정확한 assignmentId + periodStart + periodEnd에 귀속
- 다른 프로젝트/기간 서명 폴백 금지
- Worker.signatureUrl 누락 시 기존 서명 등록 화면으로 안내 후 복귀

완료 기준:

- 사업체 담당자 이름·서명 표시
- worker 이름·서명 자동 표시
- 타 기간 토큰 재사용 차단
- `gov_agent` 토큰 발급 차단
- 모바일 터치와 페이지 스크롤 충돌 없음

변경 예상:

- `app/pilot/sign/page.tsx` 신규
- `app/api/pilot/sign/company/route.ts` 신규
- 기존 `lib/signatureImage.ts`, SiteSignToken 로직 공통화
- `__tests__/pilot-sign.test.ts` 신규

### Phase P6 — PDF 문서 화면과 서명란

목적: 5종 PDF에 세 역할의 이름·서명 또는 필기 공간을 안정적으로 출력한다.

작업:

- `/pilot/documents` 기간·훈련생·문서 선택
- 위탁기관 담당자 이름 선택 입력
- `govAgent.name`과 `agencyAgent.name`에 같은 입력값 전달
- 운영 buildDocPayload에서 필요한 순수 payload 조립 로직 재사용하되 assignment·PII 가드는 pilot API에서 수행
- 기존 `signatures()`가 공식 문서 5종에서만 사용되므로 이 함수를 직접 고정 폭 구조로 개선
- 이름 영역 최소 40mm, 빈 값 밑줄, 긴 이름 축소/말줄임
- 기존 서명 블록 페이지 가드와 출근부 호출부 상위 블록 가드를 유지하고, 행 높이 변경 시 계산 상수도 함께 갱신
- PDF inline preview와 attachment download
- 운영 DocumentRun/ManagerNotice/email/gov send 미호출

완료 기준:

- 출근부·훈련일지·훈련평가·적응일지·적응평가 5종 생성
- 위탁기관 이름 입력/공란 양쪽 출력 검증
- 회사 담당자·worker 이름이 길어도 위탁기관 필기 공간 유지
- 페이지 하단 겹침 없음
- 훈련생 1~5명 전 구간에서 5종 생성
- Word/HWP API·버튼 없음
- **Vitest 416건 무회귀**
- **PDF 기간 스윕 519케이스 재실행 — P0 baseline 대비 악화 없음**(분리 건수가 baseline 이하)
- PDF 5종 시각 회귀검증 통과

변경 예상:

- `app/pilot/documents/page.tsx` 신규
- `app/api/pilot/documents/preview/route.ts` 신규
- `app/api/pilot/documents/download/route.ts` 신규
- `lib/pilot/documentPayload.ts` 신규
- `lib/pdf/pdfkitRenderer.ts` 또는 5종 전용 signature helper
- `__tests__/pilot-documents.test.ts` 신규
- PDF 렌더 시각검증 결과물

### Phase P7 — 나머지 운영 조회 격리와 정리

목적: 파일럿 데이터가 운영 통계·비용·공식 제출에 섞이지 않게 한다.

작업:

- P1의 급여·연차·결제·배정 차단을 전제로 다음 7곳에서 demo 제외 (실측 파일·줄)
  - `app/api/admin/system/stats/route.ts:20` — 전체 기관 수
  - `app/api/admin/system/stats/route.ts:24` — ★**유료 기관 수**. `planType: { in: PAID_AGENCY_PLANS }` **조건부 count**라
    파일럿 기관을 `planType=PRO`로 두는 순간 유료 1건으로 잡힌다. "기관 목록 제외"만 훑으면 놓치는 지점이므로
    이 줄에 `isDemo: false`를 명시적으로 추가한다
  - `app/api/admin/system/usage/route.ts:31` · `app/api/admin/system/billing/route.ts:12`
  - `app/api/admin/system/agencies/route.ts:14` · `app/api/admin/subscription/route.ts:16`
  - `app/api/admin/sites/options/route.ts:17`
- `Agency.findMany/count`뿐 아니라 `{isActive:true}` 기관 순회와 agencyId 없는 전역 count를 전수 조사
- 공단발송·gov-status는 demo agency 하드블록
- 시스템 운영자 화면은 demo 배지 또는 명시 필터로만 조회
- `cleanup-pilot.mts` dry-run 기본 정리 스크립트
- 대상 agency `isDemo=true` 재검증, 운영 agency 실행 금지
- Trainee는 `agencyId`가 없으므로 Site→Trainee 간접 관계로만 대상 수집
- 삭제 순서: `TraineeLogTask → TraineeLog → AttendanceIssueEvent → AttendanceIssue → DailyAttendance → SiteSignToken → DocumentRun/Version → TraineePlacement → Trainee → SiteAssignment → Site → WorkerInvite → Agency`
  (`AttendanceIssueEvent`는 v2에서 누락됐던 항목 — `prisma/schema.prisma:1335`)
- `Worker`, `AuditEvent`, `AccessLog`는 삭제하지 않음
- dry-run에 훈련생 개인정보 건수를 별도 항목으로 출력

완료 기준:

- 파일럿 데이터가 운영 합계·청구·검색·급여에 미반영
- demo 문서 공단발송 API가 403
- cleanup dry-run 건수와 실제 FK 삭제 순서 검증
- 운영 데이터 삭제 가능성 없음
- 기존 worker 계정과 감사·접근 기록 보존

변경 예상:

- 관련 query chokepoint 파일(Claude 전수조사 후 목록 확정)
- `scripts/cleanup-pilot.mts` 신규
- `__tests__/pilot-isolation.test.ts` 신규

### Phase P8 — 통합 검증과 Preview

목적: 실제 모바일 파일럿 흐름을 처음부터 끝까지 검증한다.

검증:

- TypeScript
- **전체 Vitest — 기존 416건 + 파일럿 신규 테스트 전량**
- **PDF 기간 스윕 519케이스 — P0 baseline 대비 악화 없음**
- production build
- 360px 모바일: 초대→설정→근무일→복수 훈련생 일지→서명→PDF
- PDF 5종 공란/입력/긴 이름/다페이지 시각검증
- 일반 worker·manager 기존 핵심 흐름 회귀검증
- Preview DB migration 및 격리 실측

완료 기준:

- 실패 테스트 0
- PDF 레이아웃 승인
- 사용자 Preview 확인
- production migration·배포는 별도 승인 전 금지

---

## 3. 변경 범위 요약

### 신규 경로

```text
app/pilot/**
app/api/pilot/**
lib/pilot/**
```

### 최소 기존 파일 변경

```text
prisma/schema.prisma
lib/pdf/pdfkitRenderer.ts          # 기존 signatures() 직접 개선, 페이지 가드 유지
기존 bulk-generate route           # 후보 계산 helper 추출만
운영 격리 query chokepoint          # isDemo=false
docs/env-vars.md
```

### 변경하지 않을 핵심

```text
TraineeSupervision / D-1
기존 worker/site/register 403
운영 DocumentRun 식별키
급여 1:1/1:多 계산
운영 manager 서명 워크플로
Word/HWP 생성
```

---

## 4. 위험과 대응

| 위험 | 대응 |
|---|---|
| 같은 실제 사업체 Site 중복 | demo Agency 내부에서만 worker별 분리, 운영 병합 금지 |
| 자동 평일을 실제 출근으로 오인 | preview 후 명시 체크·확정한 날만 저장 |
| 파일럿 데이터 운영 합계·자동화 혼입 | 데이터 생성 전 급여·연차·결제 하드블록 + 조회 필터 테스트 |
| 다른 경로에서 demo Site에 worker 추가 배정 | **8경로** 하드블록 + 403 테스트. ★락 밖 `worker/invite/[id]:135` 포함 — 락 호출부만 훑으면 놓친다 |
| 관문 함수 호출부만 훑어 예외 경로를 놓침 | 전수조사는 **락 호출부 + 모델 쓰기 구문(`create`/`upsert`/`updateMany`) 검색 병행** |
| 낙관적 잠금이 TOCTOU가 됨 | `expectedUpdatedAt`을 **조건에 실은 원자적 CAS**로 구현, 조회 후 비교 금지 |
| 사업체 서명 오귀속 | assignment+기간 완전일치, 최근 토큰 폴백 금지 |
| 위탁기관 이름을 전자서명으로 오인 | 이름 전용, 서명 이미지·signStage와 연결 금지 |
| 공란 이름 공간 부족 | 최소 40mm 고정 이름 영역과 밑줄 |
| 공용 PDF helper 회귀 | 기존 페이지 가드 유지 + **P0에서 만든 519케이스 스윕으로 개편 전후 대조**(5케이스 렌더로는 페이지 분할이 안 일어나 회귀를 못 잡음) |
| 근무일 동시 수정으로 앞선 저장 유실 | 전체 집합 대신 delta + 같은 날짜는 `expectedUpdatedAt` 409 |
| 근무일 삭제가 일지를 조용히 cascade 삭제 | `remove` 전 `TraineeLog` 존재 검사 필수(`schema.prisma:469`) |
| 유료 기관 통계 오염 | `system/stats/route.ts:24` 조건부 count에 `isDemo:false` 명시 |
| cleanup 운영 오삭제 | isDemo 재검증, Site 경유 대상 수집, dry-run 기본, explicit id, FK 역순 |

---

## 5. 구현 중단 기준

다음 상황이 나오면 임의 확장하지 않고 설계를 다시 승인받는다.

- 같은 파일럿 Site를 여러 worker가 공유해야 함
- 위탁기관 담당자 전자서명이나 인앱 승인 필요
- 파일럿 PDF를 공단에 앱에서 직접 발송해야 함
- 급여 계산까지 파일럿 범위에 포함
- Word/HWP 편집 파일이 필수
- 운영 Site/훈련생과 파일럿 데이터를 병합해야 함
- 기존 테이블 재사용으로 권한 격리를 증명할 수 없음

---

## 6. v2 → v3 변경 요약

Claude 2차 검토(코드 실측 기반) 지적 9건을 반영했다. 상세 근거는 설계 v3 §13.

| # | 지적 | 반영 위치 |
|---|---|---|
| 1 | **"519개 테스트"는 존재하지 않음**(실측 Vitest 416건). 519는 PDF 스윕 케이스 수이고 **스크립트가 리포에 없음** | §1-14 · P0 · P6 · P8 |
| 2 | 전체 집합 수정은 lost update 발생 | §1-10·11 · P3 |
| 3 | `TraineeLog.attendanceId`가 `onDelete: Cascade` | P3 · §4 위험표 |
| 4 | 훈련생 상한 미정 | §1-12 · P2 |
| 5 | `attendanceMode` 미정 | §1-13 · P2 |
| 6 | 유료 기관 통계는 조건부 count라 목록 제외로 안 잡힘 | P7 |
| 7 | 결제 경로는 이미 구조적으로 안전 | P1 위험도 차등 |
| 8 | cleanup에 `AttendanceIssueEvent` 누락 | P7 |
| 9 | 배정 chokepoint는 `assignmentLock.ts` 호출부가 앵커 | P1(7곳 실측) |

### v3 보정 — 배정 경로 누락 1건

v3 최초본의 *"락 호출부를 앵커로 전수 열거"* 는 **틀렸다.**
`app/api/worker/invite/[id]/route.ts:135`가 락 밖에서 `siteAssignment.create()`를 직접 호출한다.

| # | 보정 | 위치 |
|---|---|---|
| 1 | 초대 수락을 **8번째 하드블록 대상**으로 추가 | P1 |
| 2 | "단일 관문" → **"주요 앵커"** | P1 · 설계 §4-5 |
| 3 | 전수조사는 **락 호출부 + `create`/`upsert`/`updateMany` 검색 병행** | P1 · §4 위험표 |
| 4 | `expectedUpdatedAt`은 **원자적 CAS**(조회 후 비교 금지) | P3 · §4 위험표 |

★**교훈**: 이 리포는 chokepoint 단일화를 여러 차례 했지만(`checkSiteCapacity`·`ownedAttendanceWhere`·`assignmentLock`),
**의도적 예외가 주석으로만 남은 경우**가 있다. 관문 호출부 훑기는 그런 예외를 구조적으로 놓친다.
모델 단위 쓰기 구문 검색을 항상 병행할 것.

---

## 7. 승인 게이트

**문서 확정과 구현 승인은 별개다.**

- 이 문서(v3)가 확정되어도 코드·schema·migration·seed·test 작업은 시작하지 않는다.
- **P0(기준선 확인 + 519케이스 스윕 스크립트 신규 작성)부터 별도 승인**을 받는다.
  P0은 문서 작업이 아니라 코드 작업이다.
- 각 Phase 완료 시 다음 Phase 착수 전에 결과를 보고한다.
- production migration·배포·`/pilot` 공개는 P8 이후 **또 한 번의 별도 승인** 대상이다.
