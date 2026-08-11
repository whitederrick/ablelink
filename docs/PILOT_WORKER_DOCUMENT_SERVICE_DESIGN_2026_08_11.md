# 직무지도원 문서 파일럿 서비스 설계 v3 — Claude 2차 검토 반영안

작성일: 2026-08-11  
상태: **설계 검토 전용 · 구현 미착수 · 승인 전 코드/스키마/migration/seed 변경 금지**  
검토 대상: VS Code Claude 및 사용자 최종 확인

선행 문서: `docs/PILOT_WORKER_DOCUMENT_IMPLEMENTATION_PLAN_2026_08_11.md`

---

## 0. 목적과 범위

소수의 직무지도원이 `https://able-link.co.kr/pilot`에서 다음 흐름을 직접 시험할 수 있게 한다.

1. 사업체명과 근무기간·기본 근무시간 입력
2. 훈련생 1명 또는 여러 명 등록
3. 출퇴근 버튼 기록 없이 근무 예정일 자동 생성
4. 직무지도원이 실제 근무일·시간을 확인·수정
5. 훈련생별 일지 작성
6. 사업체 담당자가 이름을 입력하고 직접 서명
7. 직무지도원 본인의 이름과 등록 서명 자동 삽입
8. 위탁기관 담당자 이름을 입력하거나, 비워 두고 출력 후 수기 작성
9. PDF 미리보기·다운로드

이 파일럿의 목적은 **직무지도원의 문서 작성 경험 검증**이다. 정식 기관 운영, 급여 계산, 공단 발송,
다중 직무지도원 공동 현장 관리, 훈련생 전역 식별체계 개편은 범위에 포함하지 않는다.

---

## 1. 확정 요구사항

### 1-0 v2에서 확정한 선택

- 확정한 근무일은 새 프로젝트를 만들지 않고 수정할 수 있다.
- 파일럿 Agency는 `planType=PRO`, `maxWorkers=0`, `maxSites=0`으로 둔다.
- `/api/pilot/**`은 독립된 파일럿 생성 경로이므로 일반 기관 생성 API의 `checkQuota`를 호출하지 않는다.
- 공통 `checkQuota` 함수에는 `isDemo` 예외나 우회 코드를 추가하지 않는다.

### 1-0-1 v3에서 확정한 선택

- 근무일 수정 API는 **전체 선택 집합이 아니라 delta(`add`/`remove`/`update`)** 를 받는다.
  서로 다른 날짜의 동시 수정이 서로를 덮어쓰지 않게 하기 위함이다(lost update 차단).
- 같은 날짜를 동시에 수정하는 경우는 **`expectedUpdatedAt` 불일치 시 409**로 거부한다.
- 파일럿 훈련생은 **직무지도원 1명당 5명**까지만 등록한다.
  기존 `lib/rules.ts:7 MAX_TRAINEES_PER_WORKER = 5`와 값을 일치시키고, PDF 검증 범위도 **1~5명**으로 고정한다.
- `SiteAssignment.attendanceMode = NONE`으로 확정한다(§4-4).
- 회귀 기준선은 **Vitest 416건**과 **PDF 기간 스윕 519케이스**를 **서로 다른 두 기준**으로 분리해 관리한다(§11-5).

### 1-1 URL과 화면 분리

- 공개 진입 경로: `/pilot`
- UI 코드: `app/pilot/**`
- API 코드: `app/api/pilot/**`
- 기존 `/worker`, `/manager`, `/admin` 화면에 파일럿 메뉴를 섞지 않는다.
- 같은 Next.js/Vercel 배포 안의 경로 분리이며 별도 서버나 별도 데이터베이스는 만들지 않는다.

### 1-2 데이터 저장

- 파일럿 전용 테이블을 새로 만들지 않는다.
- 기존 `Agency`, `Worker`, `WorkerInvite`, `Site`, `SiteAssignment`, `Trainee`,
  `TraineePlacement`, `DailyAttendance`, `TraineeLog`, `TraineeLogTask`, `SiteSignToken`을 재사용한다.
- 스키마 신규 필드는 `Agency.isDemo Boolean @default(false) @map("is_demo")` 한 개를 기본안으로 한다.
- 파일럿 데이터는 `Agency.isDemo=true`인 전용 기관 한 곳 아래에만 생성한다.
- Trainee에는 `agencyId`를 추가하지 않고 Site 관계를 통해 파일럿 소속을 판정한다.

### 1-3 문서 형식

- v1 출력은 **PDF만 지원**한다.
- Word(`.docx`) 생성·저장·다운로드는 v1에서 제외한다.
- 현재 저장소의 `.docx` 지원은 고객지원 첨부파일 허용 형식일 뿐 문서 생성 기능이 아니다.
- Word는 글꼴·표·서명 이미지 위치가 실행 환경에 따라 재배치될 수 있어, 고정 양식 검증이 목적인 파일럿에는
  PDF가 우선이다. 필요성이 확인되면 별도 후속 설계로 추가한다.

---

## 2. 비범위

다음은 파일럿 v1에서 구현하지 않는다.

- `TraineeSupervision` 및 D-1 도메인 개편
- 별도 Pilot 전용 테이블 또는 별도 DB
- 운영자 대행 훈련생 등록 화면
- 훈련생 공단 고유번호·주민등록번호·전역 중복 병합
- 사업체당 복수 직무지도원의 훈련생 분담
- 급여 계산·급여 확정·명세서
- 위탁기관 담당자의 앱 로그인·전자서명
- `DocumentRun` 제출/확정/공단발송 워크플로
- 공단 이메일 발송
- Word/HWP 파일 생성
- 정식 운영 데이터로의 자동 승격·병합

---

## 3. 기존 기능 재사용 근거

| 요구 | 기존 자산 | 파일럿 적용 |
|---|---|---|
| 직무지도원 계정 | `Worker`, 기존 worker JWT/session | 그대로 사용 |
| 소수 참여자 통제 | `WorkerInvite.existingWorkerId/usedByWorkerId` | 파일럿 기관 초대 또는 demo assignment로 참여자 판정 |
| 직무지도원 입력 사업체 | `SiteSourceType.WORKER_ENTRY`, `Site.isVerified` | `WORKER_ENTRY`, `isVerified=false` |
| 근무기간·근무형태 | `SiteAssignment.startDate/endDate/workType/customWork*` | 설정 화면 입력값 저장 |
| 버튼 없는 출근부 | `attendanceButtonExempt`, `bulk-generate` 로직 | 후보 미리보기+확인 후 생성하도록 래핑 |
| 다수 훈련생 | `Trainee`, `TraineePlacement`, 문서 UI의 traineeIds 펼침 | 한 Site에 1명 이상 등록 |
| 훈련생별 일지 | `TraineeLog`, `TraineeLogTask` | 기존 저장 규칙 사용 |
| 직무지도원 서명 | `Worker.signatureUrl` | 이름·서명 자동 삽입 |
| 사업체 담당자 서명 | `SiteSignToken`, in-person sign | 파일럿 전용 얇은 API/UI로 재사용 |
| PDF | `lib/pdf/pdfkitRenderer.ts` | payload 입력·서명란만 확장 |

현재 `app/api/worker/site/register`는 의도적으로 403이다. 이 라우트를 다시 열지 않는다.
파일럿 등록은 `/api/pilot/**`에서만 허용하고 반드시 `isDemo=true` 기관에 귀속시킨다.

---

## 4. 데이터 모델과 불변식

### 4-1 `Agency`

추가 필드:

```prisma
isDemo Boolean @default(false) @map("is_demo")
```

권장 index:

```prisma
@@index([isDemo, isActive])
```

파일럿 기관은 한 곳만 운영한다. 단, DB unique로 “isDemo=true 한 곳”을 강제하지 않고 환경변수
`PILOT_AGENCY_ID`로 정확한 기관을 지정한다. 서버는 해당 기관을 다시 조회해 `isDemo=true && isActive=true`를 검증한다.

파일럿 기관은 `planType=PRO`, `maxWorkers=0`, `maxSites=0`으로 설정한다. 0은 현재 `checkQuota`에서 무제한을
뜻하며 PDF 등 기존 플랜 게이트도 통과해야 한다. `WorkerInvite.createdByManagerId`가 필수 FK이므로 초대 발급용
Manager 계정도 최소 1개 준비한다. 참여자 N명이 worker별 Site N개를 만들 수 있어야 한다.

### 4-2 참여 직무지도원 판정

다음 중 하나를 만족해야 `/pilot` 쓰기 작업을 할 수 있다.

1. 파일럿 기관이 발급한 `WorkerInvite`의 `existingWorkerId` 또는 `usedByWorkerId`가 로그인 workerId와 일치
2. 로그인 worker에게 파일럿 기관 소속 `SiteAssignment`가 이미 존재함

클라이언트가 전달하는 agencyId를 신뢰하지 않는다. 서버가 `PILOT_AGENCY_ID`와 관계를 직접 확인한다.
`CONNECT_EXISTING` 초대는 `existingWorkerId`만 채워질 수 있으므로 두 필드를 모두 확인한다. 초대가 일치하지 않아도
유효한 demo assignment가 있으면 두 번째 조건으로 계속 이용할 수 있다.

### 4-3 `Site`

설정 화면이 생성하는 Site:

- `agencyId = PILOT_AGENCY_ID`
- `companyName = 직무지도원 입력`
- `siteSourceType = WORKER_ENTRY`
- `isVerified = false`
- 사업체 담당자 이름·연락처는 기존 `businessContact*` 필드 사용
- 주소가 입력되지 않으면 파일럿 전용 미입력 표기를 저장하고 GPS는 문서 흐름에서 사용하지 않는다.
- 파일럿 Site는 운영 지도·구인·공유현장 후보에 노출하지 않는다.

### 4-4 `SiteAssignment`

Site 생성과 같은 트랜잭션에서 본인 배정을 생성한다.

- `workerId = 로그인 workerId`
- `agencyId = PILOT_AGENCY_ID`
- `siteId = 방금 생성한 Site.id`
- `status = ACTIVE`
- `connectedAt = now`
- `startDate/endDate = 입력 근무기간`
- `workType`, `commuteGuidanceIncluded`, `customWorkStart/customWorkEnd = 입력값`
- `attendanceButtonExempt = true`
- `attendanceMode = NONE`

★`AttendanceMode` enum 실제 값은 `APP_GPS | EXTERNAL | NONE`이고 기본값은 `APP_GPS`다(`prisma/schema.prisma:265,1514-1518`).
파일럿은 앱 GPS 출퇴근을 요구하지 않으므로 `NONE`으로 확정한다.
단 **이 필드는 현재 어떤 애플리케이션 코드도 읽지 않는다** — 리포 전체에서 쓰기만 3곳
(`prisma/seed.ts:103`, `scripts/seed-all.mts:190,230`)이고 읽는 곳이 없다.
따라서 값 선택은 의도 표기이며, **실질 통제는 `attendanceButtonExempt = true`** 다
(`app/api/worker/attendance/bulk-generate/route.ts:113`이 이 플래그만 검사한다).
`attendanceMode`에 기능을 기대하지 않는다.

### 4-5 파일럿 Site 데이터 행 1개당 담당 직무지도원 1명

D-1 없이 훈련생 담당 관계를 명확하게 유지하기 위한 **파일럿 DB 내부 제약**이다.
실제 사업체에 직무지도원이 한 명만 있어야 한다는 운영 정책이 아니다.

- 파일럿 Site 데이터 행 하나에는 파일럿 직무지도원 한 명의 assignment만 허용한다.
- 직무지도원 한 명은 해당 Site에서 훈련생 여러 명을 관리할 수 있다.
- 같은 실제 사업체에서 직무지도원 여러 명이 파일럿에 참여하면 Site 데이터 행을 직무지도원별로 분리 생성한다.
- 예: 실제 `A회사`에 김지도원·이지도원이 있으면 DB에는 `A회사(김지도원 프로젝트)`와
  `A회사(이지도원 프로젝트)` Site 행을 만들되, PDF의 사업체명은 둘 다 `A회사`로 출력한다.
- 이 중복은 `isDemo` 기관 안에서만 존재하며 운영 Site와 병합하지 않는다.

이 제약을 두는 이유는 현재 `Trainee`가 Site에는 연결되지만 담당 worker에는 직접 연결되지 않기 때문이다.
Site 하나를 여러 worker가 공유하면 파일럿 문서 화면에서 서로의 훈련생 목록이 섞일 수 있다.
정식으로 Site를 공유하려면 `TraineeSupervision` 같은 담당 관계가 필요하므로 D-1 범위가 다시 들어온다.

이 규칙은 setup 화면에만 의존하지 않는다. manager 직접 배정, marketplace 수락, recruit 자동배정 등 기존의 모든
`SiteAssignment` 생성 chokepoint는 demo Site/Agency 대상 배정을 403으로 차단한다. 파일럿 assignment는
`/api/pilot/setup` transaction에서만 만든다.

**chokepoint 전수 조사는 두 축을 병행한다. 어느 한쪽만으로는 완전하지 않다.**

`lib/assignmentLock.ts` 호출부는 **주요 앵커이지 단일 관문이 아니다.** 2026-07-08에 "배정 생성·승격 6경로"를
일괄 방어하려고 도입됐지만, 이후 **의도적으로 락에서 제외된 경로가 존재**한다(아래 ⑧).
따라서 최종 전수조사는 **① 락 호출부 + ② `siteAssignment.create` / `upsert` / `updateMany` 직접 검색**을 함께 수행한다.

**축 ①·② 교집합 — 락을 거치는 배정 생성·승격 7곳**

| 경로 | 호출부 |
|---|---|
| 매니저 직접 배정 | `app/api/admin/assignments/route.ts:316` |
| 배정 수정·승격 | `app/api/admin/assignments/[id]/route.ts:126` |
| 배정 요청 finalize | `app/api/admin/assignment-requests/route.ts:184` |
| 마켓 신청 수락 | `app/api/admin/recruit-applications/[id]/route.ts:166,167,168` |
| 워커 배정 응답 | `app/api/worker/assignment/respond/route.ts:106` |
| 마켓 오퍼 수락 | `app/api/worker/recruit/offers/route.ts:135,136` |
| 계약 서명 write-back | `app/api/worker/contracts/route.ts:219` |

**⑧ 락 밖 경로 — 초대 수락 (★차단급 누락이었다)**

`app/api/worker/invite/[id]/route.ts:135`가 **`assignmentLock`을 거치지 않고 `tx.siteAssignment.create()`를
직접 호출한다.** `invite.siteId`가 있으면 `agencyId: invite.agencyId`(`:139`)로 `status: ASSIGNED` 배정을 만든다.

이것은 누락이 아니라 **의도적 제외**다. `:131-133` 주석에 근거가 남아 있다 —
*"invite는 매니저가 자기 현장에 직접 온보딩하는 행위라 정원으로 막지 않는다… 19차에 chokepoint 편입한 게 과했음"*.
`checkSiteCapacity`와 함께 락에서도 빠져 있어 **락 호출부만 훑는 방식으로는 영원히 발견되지 않는다.**

파일럿에 미치는 영향이 셋이다.
1. 이 경로를 막지 않으면 **P1 demo 배정 하드블록에 구멍이 남는다.**
2. 이미 존재하는 파일럿 Site의 `siteId`로 초대를 발급하면 **그 Site에 두 번째 배정이 생겨
   §4-5의 "Site 1개당 worker 1명"이 깨지고, 훈련생 목록이 섞여 1:多 판정이 붕괴한다.**
   D-1을 도입하지 않는 근거 자체가 무너지는 지점이다.
3. §4-2 판정 2(demo assignment 존재)를 이 경로가 자동 충족시켜 **참여 자격이 부여된다.**

**조치는 이중 방어이며, 두 계층의 처리가 서로 다르다.**

| 계층 | 처리 |
|---|---|
| 초대 **생성**(매니저) | demo agency면 `siteId` 지정 자체를 **거부(400/403)** — 원천 차단 |
| 초대 **수락**(`worker/invite/[id]:134`) | `siteId`가 있어도 **배정 분기만 건너뛴다**. 가입은 성공 + 감사로그 경고 |

★**수락 API를 통째로 403으로 막지 않는다.** 이 라우트는 `worker.create`(`:115`)와 배정 생성(`:135`)을
한 트랜잭션에서 처리하므로, 403으로 전체를 거부하면 잘못 발급된 초대를 받은 파일럿 참여자가
**계정 자체를 만들지 못하고 잠긴다**(매니저 재발급 전까지). 배정 분기만 건너뛰면 참여자는 정상 가입 후
`/pilot/setup`으로 진행하며 이는 설계가 의도한 흐름과 같다.
즉 **차단 지점은 생성 시점, 수락 시점은 무해화**다. 이 구분을 P1 착수 전에 확정한다.
- 완화 요인: 이 라우트는 `worker.create`(`:115`)로 **신규 계정을 만드는 경로**라 이미 가입된 번호는
  409로 막힌다(`:107-108`). 참여자가 전원 기존 직무지도원이면 타지 않는다. **신규 참여자 1명만 생겨도 열린다.**

**대상이 아닌 것**

- 같은 락을 쓰지만 **배정을 만들지 않는** 연차·급여 경로:
  `app/api/admin/leave/[workerId]/route.ts:128,188,240` · `app/api/admin/leave/requests/[id]/route.ts:48,80` ·
  `app/api/admin/payroll/runs/[runId]/route.ts:158`
- `siteAssignment.update/updateMany` 22곳은 **기존 배정의 상태 전이**이며 새 worker가 demo Site에
  붙는 사건이 아니다. 다만 `assignment-requests/route.ts:228`처럼 `ACCEPTED → ASSIGNED` 승격이 있으므로,
  P1 구현 시 **demo Site를 대상으로 하는 승격도 함께 점검**하고 결과를 이 문서에 확정 기록한다.
- `prisma/seed.ts` · `scripts/*.mts`는 런타임 경로가 아니다.

대안 비교:

| 안 | 장점 | 단점 | v1 판단 |
|---|---|---|---|
| worker별 파일럿 Site 행 분리 | 기존 테이블만 사용, 구현 작음, PII 격리 단순 | 같은 사업체명 Site 중복 | **권장** |
| Site 공유 + `TraineeSupervision` 도입 | 정식 관계 모델 | D-1 전체 영향면 재발생 | 제외 |
| Site 공유 + writerId만으로 필터 | 코드 변경 작음 | 목록·직접 ID 권한이 불완전 | 금지 |

### 4-6 `Trainee`와 `TraineePlacement`

- 파일럿 화면에서 훈련생 **1명 이상 5명 이하** 입력
- 상한 5는 기존 `lib/rules.ts:7 MAX_TRAINEES_PER_WORKER = 5`와 값을 일치시킨 것이다.
  ★단 기존 상한은 `app/api/admin/trainees/route.ts:82-90`에서 **`Trainee.currentSiteId` 기준(현장당)** 으로 세고
  `/api/pilot/setup`은 그 코드를 거치지 않으므로, **파일럿은 자체적으로 상한을 검사해야 한다.**
  파일럿은 Site당 worker 1명이므로 현장 기준과 담당 기준이 일치해 값이 같아도 의미 충돌이 없다.
- 기존 필수값인 이름·성별·장애유형·정도를 받는다.
- `currentSiteId = 파일럿 Site.id`, `status = TRAINING`
- `TraineePlacement.startDate = assignment.startDate`
- `TraineePlacement.endDate = assignment.endDate`
- Trainee와 Placement는 Site/Assignment와 같은 설정 트랜잭션에서 생성해 고아 상태를 막는다.
- 파일럿에서는 전역 중복 식별이나 자동 병합을 하지 않는다.

---

## 5. 사용자 흐름

### 5-1 `/pilot`

- 파일럿 소개
- 기존 직무지도원 로그인 연결
- 초대 미사용자는 기존 초대 등록 흐름 안내
- 참여 자격 확인 후 기존 프로젝트가 있으면 이어하기, 없으면 설정 시작

### 5-2 `/pilot/setup`

한 화면 또는 단계형 폼:

1. 사업체명
2. 사업체 담당자 이름·연락처
3. 근무 시작일·종료일
4. 근무형태: 오전/오후/전일/직접입력
5. 출퇴근 지도 포함 여부
6. 직접입력 시 시작·종료 시각
7. 훈련생 1명 이상

제출 시 Site → SiteAssignment → Trainee[] → TraineePlacement[]을 한 트랜잭션으로 생성한다.
동일 worker의 열린 파일럿 assignment가 이미 있으면 새로 만들지 않고 이어가기 또는 명시적 새 프로젝트 생성만 허용한다.

### 5-3 `/pilot/workdays`

출퇴근 버튼 기록 없이 출근부를 만들기 위한 확인 화면이다.

1. assignment 기간 중 오늘까지의 날짜 열거
2. 주말·한국 공휴일·파일럿 휴무일 제외
3. 기존 근무일이 있으면 중복 제외
4. 기본 근무시간 자동 표시
5. 직무지도원이 실제 근무일 체크/해제
6. 날짜별 시작·종료 시각 수정 가능
7. 최종 확인한 날짜만 `DailyAttendance` 생성

생성 행:

- `assignmentId`, `workerId`, `siteId`는 서버가 파일럿 관계에서 결정
- `startTime/endTime`은 확인된 표준 또는 수정 시각
- `actualStartTime/actualEndTime = null`
- `status = DONE`
- 파일럿 출처는 `assignment.agency.isDemo=true`와 AuditEvent로 식별

기존 `bulk-generate`는 확인 없이 전체 평일을 즉시 생성하므로 직접 호출하지 않는다.
날짜 계산·공휴일·표준시간 계산 로직만 공통 helper로 추출해 `/api/pilot/workdays/preview`와
`/api/pilot/workdays/confirm`이 사용한다.

확정 후 수정도 허용한다. `PATCH /api/pilot/workdays`는 **화면의 전체 선택 집합이 아니라 delta**를 받는다.

```jsonc
{
  "assignmentId": "123",
  "add":    [{ "date": "2026-08-04", "start": "09:00", "end": "18:00" }],
  "update": [{ "date": "2026-08-05", "start": "10:00", "end": "17:00", "expectedUpdatedAt": "..." }],
  "remove": [{ "date": "2026-08-06", "expectedUpdatedAt": "..." }]
}
```

- `add`: `daily_attendances(assignment_id, work_date)` unique를 키로 생성. 이미 있으면 409(`update`로 유도)
- `update`: 시작·종료 시간 갱신. 일지가 있는 날짜도 **허용**하며 다음 PDF부터 변경값을 반영한다
- `remove`: 연결된 `TraineeLog`가 **없을 때만** 삭제. 있으면 409와 해당 날짜 안내
- 세 배열은 한 트랜잭션에서 처리하고, 하나라도 409면 전체를 롤백한다

★**전체 집합 방식을 쓰지 않는 이유**: 사용자가 모바일과 PC를 동시에 열면 나중 저장이 앞선 저장을 통째로
되돌린다(lost update). delta는 서로 다른 날짜의 동시 수정을 서로 간섭 없이 반영한다.

★**같은 날짜 동시 수정 보호 — 반드시 원자적 CAS로 구현한다.**
`update`·`remove` 항목은 클라이언트가 읽은 시점의 `DailyAttendance.updatedAt`을 `expectedUpdatedAt`으로 실어 보낸다.

**조회 후 비교(read-then-compare)는 금지한다.** `findUnique`로 읽어 `updatedAt`을 비교한 뒤 `update`하면
비교와 쓰기 사이에 다른 요청이 끼어들 수 있어 **검사 자체가 TOCTOU가 된다.**

`WHERE id AND updatedAt` 조건을 **쓰기 구문에 직접 실어** 영향 행 수로 판정한다.

```ts
const r = await tx.dailyAttendance.updateMany({
  where: { id, assignmentId, updatedAt: expectedUpdatedAt },   // 조건을 쓰기에 포함
  data:  { startTime, endTime },
});
if (r.count === 0) throw new Conflict(...);                     // 0건 = 경합 → 409
```

`remove`도 동일하게 `deleteMany({ where: { id, assignmentId, updatedAt: expectedUpdatedAt } })`로 하고
`count === 0`이면 409다. 이 패턴은 이 프로젝트의 기존 규율과 동일하다 —
`app/api/admin/document-runs/[id]/action/route.ts:69`가 `updateMany({ where: { id, signStage: "SUBMITTED" } })`의
영향 행 수로 상태 경합을 판정하고, E-4·E-5에서 P2002·삭제 경합을 409로 정규화했다.
409 응답에는 현재 값을 담아 화면이 갱신하도록 한다.

★**`remove` 전 일지 존재 검사는 선택이 아니라 필수다.**
`TraineeLog.attendanceId`는 `onDelete: Cascade`이므로(`prisma/schema.prisma:469`)
`DailyAttendance` 행을 지우면 **DB가 연결된 일지를 조용히 함께 지운다.** FK가 막아 줄 것이라고 기대하면 안 된다.
같은 이유로 `AttendanceIssue.dailyAttendanceId`도 `onDelete: Cascade`다(`:1328`).
삭제 전 `trainee_logs(attendance_id, trainee_id)` 존재 여부를 반드시 조회하고, 있으면 삭제하지 않는다.

v1은 `DocumentRun`이나 문서 스냅샷을 남기지 않으므로 PDF 생성 후 데이터 동결 상태도 없다. 이미 내려받은 PDF는
바뀌지 않지만 다시 생성한 PDF는 최신 근무일·시간을 반영한다.

미래 날짜는 출근으로 확정하지 않는다. PDF 달력 틀에는 기간 끝까지 날짜가 보여도,
확정하지 않은 날짜의 출퇴근 시간·지도시간·합계는 비워 둔다.

### 5-4 `/pilot/logs`

- 확인된 근무일 선택
- 훈련생 1명 또는 여러 명 선택
- 훈련생별 수행과제·수행정도·평가 및 지도사항 입력
- 저장은 기존 `TraineeLog`/`TraineeLogTask` 구조 사용
- 접근 가드: 로그인 worker의 파일럿 assignment + 같은 Site의 TraineePlacement + 선택 workDate
- 다른 worker의 파일럿 Site/훈련생 ID 직접 요청은 동일한 404 응답으로 차단

### 5-5 `/pilot/sign`

- 사업체 담당자 이름을 기존 Site 값으로 미리 채우고 수정 허용
- 담당자가 화면에 직접 서명
- 서명은 assignmentId + 기간에 귀속
- 다른 assignment/기간의 최근 서명으로 자동 폴백하지 않는다.
- pilot API는 `signRole=company_manager`만 발급·저장한다.
- `signRole=gov_agent` 요청은 403으로 차단한다. 위탁기관 담당자는 이름과 수기 공간만 제공한다.

### 5-6 `/pilot/documents`

- 기간은 기본적으로 assignment 기간, 필요 시 그 안에서 축소 가능
- 훈련생 종속 문서는 선택 훈련생별 PDF 생성
- 출근부는 assignment 단위 1건
- 위탁기관 담당자 이름 입력란은 선택값
- 직무지도원 서명이 없으면 프로필 서명 등록으로 안내
- 사업체 담당자 서명이 필요한 문서는 서명 완료 후 생성
- PDF 미리보기·다운로드만 제공
- 운영 `DocumentRun` 제출, 매니저 알림, 공단 발송은 호출하지 않는다.

PDF 원본과 입력 payload를 서버에 보존하지 않으므로 나중에 당시 내려받은 동일 PDF를 재현하거나 제출 이력을
입증할 수 없다. 이는 문서 작성 경험 검증용 v1의 의도된 제한이며 공식 제출·감사 용도로 사용하지 않는다.

---

## 6. PDF 요구사항

### 6-1 대상 문서 5종

1. `ATTENDANCE_SHEET`
2. `TRAINING_DAILY_LOG`
3. `TRAINEE_FINAL_EVAL`
4. `ADAPTATION_DAILY_LOG`
5. `ADAPTATION_FINAL_EVAL`

### 6-2 이름과 서명

| 역할 | 이름 | 서명 이미지 |
|---|---|---|
| 사업체 담당자 | 서명 화면 입력값 | 직접 서명 |
| 직무지도원 | `Worker.workerName` | `Worker.signatureUrl` |
| 위탁기관 담당자 | 문서 화면 선택 입력 | v1에서는 없음 |

위탁기관 담당자 입력값은 PDF payload의 기존 `govAgent.name`과 `agencyAgent.name` 양쪽에 동일하게 매핑한다.
문서 종류별로 다른 기존 vocabulary를 UI에 노출하지 않는다.

### 6-3 고정 필기 공간

현재 `pdfkitRenderer.signatures()`는 공식 문서 5종에서만 사용된다. 별도 pilot helper를 만들지 않고 이 함수를
직접 개선한다. 현재 함수는 `라벨 : 이름 (서명 또는 인)` 문자열 전체를 우측 정렬하므로,
이름이 비어 있을 때 수기 공간을 명시적으로 보장하지 않는다. 다음 구조로 변경한다.

- 역할별 서명행은 서로 독립된 고정 높이 행
- `labelWidth`, `nameWidth`, `signatureWidth`를 분리
- 이름 영역 최소 40mm
- 위탁기관 담당자 이름이 비면 40mm 밑줄 표시
- 이름이 입력되면 영역 안에 인쇄하되 서명 영역을 침범하지 않음
- 긴 이름은 1차 글자 크기 축소, 하한 초과 시 말줄임표
- 사업체 담당자·직무지도원 이름 길이가 위탁기관 담당자 행의 공간에 영향을 주지 않음
- 서명 이미지는 각자 서명 영역 중앙에만 겹침
- 서명 블록 전체가 페이지 하단을 넘으면 블록 단위로 다음 페이지 이동
- 기존 서명 블록 페이지 가드와 출근부 호출부 상위 블록 가드를 유지
- 행 높이가 바뀌면 두 가드의 높이 계산 상수도 함께 변경

출력 예시:

```text
(공단/위탁기관) 담당자 : ______________________________   (서명 또는 인)
사업체 담당자          : 김사업체                       (서명 이미지)
직무지도원             : 이지도                         (서명 이미지)
```

문서 원본의 역할 명칭이 `(위탁기관) 담당자`인 경우 원본 라벨은 유지하고 동일 공간 규칙만 적용한다.

### 6-4 출근부

- 근무기간 전체의 달력 주차 구조 표시
- 확인된 근무일만 시작·종료·지도시간 표시
- 미확인일과 미래일은 빈칸
- 총 지도일수·총 지도시간은 확인된 근무일만 합산
- 훈련생 1명은 1:1, 2명 이상은 1:多로 표시하는 기존 파일럿 규칙 유지
- 이 규칙은 파일럿 Site당 worker 1명 제약 안에서만 유효하다.

---

## 7. API 초안

| Method | Path | 책임 |
|---|---|---|
| GET | `/api/pilot/context` | 참여 자격, 기존 파일럿 프로젝트, 진행 단계 조회 |
| POST | `/api/pilot/setup` | Site+Assignment+Trainees+Placements 원자 생성 |
| GET | `/api/pilot/workdays/preview` | 기간의 근무일 후보·기본시간 계산 |
| POST | `/api/pilot/workdays/confirm` | 사용자가 선택·수정한 근무일만 원자 저장 |
| PATCH | `/api/pilot/workdays` | 확정 근무일 delta 수정(`add`/`update`/`remove` + `expectedUpdatedAt`) |
| GET | `/api/pilot/logs` | 본인 프로젝트의 근무일·훈련생·일지 조회 |
| POST | `/api/pilot/logs` | 훈련생별 일지 저장 |
| POST | `/api/pilot/sign/company` | 사업체 담당자 이름·서명 저장 |
| POST | `/api/pilot/documents/preview` | PDF inline 미리보기 |
| POST | `/api/pilot/documents/download` | PDF attachment 다운로드 |

모든 API 공통:

- worker session 필수
- pilot invite 또는 demo assignment 관계 필수
- `PILOT_AGENCY_ID` 서버 결정
- 입력 id의 worker/site/assignment/trainee 관계 재검증
- JSON 크기·문자열 길이·날짜 왕복검증
- 직접 ID 요청의 존재/권한 오류는 동일 응답
- 생성·수정·서명·PDF 출력은 AuditEvent/AccessLog 기록

---

## 8. 운영 데이터 격리

격리는 setup보다 먼저 구현한다. 다음 세 경로는 P1에서 하드블록한 뒤에만 pilot 데이터를 생성한다.

| 경로 | 조치 | 실제 위험도 |
|---|---|---|
| `lib/leave/runAccrual.ts:80` | 연차 자동 적립 대상에서 demo 제외 | ★**높음** — `{ isActive: true }`만 보고 전 기관을 순회하므로 demo worker에게 연차가 실제로 적립된다 |
| `app/api/cron/daily/route.ts:437` | 급여 DRAFT 자동 생성 대상에서 demo 제외 | 중 — `payrollAutoDay`가 설정된 기관만 대상이므로 파일럿 기관에 이 값을 넣지 않으면 자연 회피되나, 값에 의존하지 않도록 명시 제외한다 |
| `app/api/payments/charge/route.ts:59` | 결제 대상 조회에서 demo 제외 | 낮음(심층방어) — 조회 조건이 `tossBillingKey != null` **AND** `tossCustomerKey != null` **AND** `nextBillingAt < tomorrow`라, 빌링키를 등록하지 않는 파일럿 기관은 **구조적으로 청구 대상이 될 수 없다**. 그럼에도 명시 제외한다 |

★`planType=PRO` 선택의 부작용이 하나 있다. `app/api/admin/system/stats/route.ts:24`가
`agency.count({ where: { planType: { in: PAID_AGENCY_PLANS } } })`로 **유료 기관 수**를 세므로 파일럿 기관이
유료 1건으로 잡힌다. 이건 `findMany`가 아니라 **조건부 `count`** 라 "기관 목록 제외"만 훑으면 놓친다.
해당 줄에 `isDemo: false`를 **명시적으로 추가**한다.

manager 직접 배정·marketplace 수락·recruit 자동배정 **그리고 초대 수락**까지 **8곳**의 assignment 생성 경로에서
demo Site/Agency를 하드블록한다(§4-5). ★8번째인 `worker/invite/[id]/route.ts:135`는 **락을 거치지 않으므로**
락 호출부 점검만으로는 잡히지 않는다. 그 다음 `Agency.isDemo=true` 데이터는 다음 조회 경로에서 기본 제외한다.

- 시스템 전체 통계
- 일반 기관 목록 및 과금 집계
- 마켓플레이스·구인·인재 검색
- 일반 운영 대시보드의 전체 합계
- 급여 run 생성 대상
- 공단 발송 및 제출완료 처리
- 운영 백업 패키지의 기본 대상

시스템 운영자는 필요 시 `includeDemo=true` 같은 명시적 내부 필터로만 볼 수 있다.
일반 manager API는 원래 agency scope를 유지하되, 파일럿 기관에 manager 계정을 일상 운영용으로 제공하지 않는다.

공단 발송·급여 경로에는 `agency.isDemo` 하드블록을 둔다. UI 숨김만으로 대체하지 않는다.

전수조사는 `prisma.agency.findMany/count`뿐 아니라 `{ isActive: true }` 기관 순회와 agencyId 없이 실행되는
`site.count`, `worker.count` 같은 전역 집계도 포함한다. 2026-08-11 실측한 `agency.findMany/count` 소비처는 다음 9곳이며,
발견된 경로를 테스트 목록에 고정한다.

| 파일·줄 | 성격 | 단계 |
|---|---|---|
| `lib/leave/runAccrual.ts:80` | 연차 자동 적립 | **P1** |
| `app/api/cron/daily/route.ts:437` | 급여 DRAFT 자동 생성 | **P1** |
| `app/api/payments/charge/route.ts:59` | 결제 대상 조회 | **P1** |
| `app/api/admin/system/stats/route.ts:20` | 전체 기관 수 | P7 |
| `app/api/admin/system/stats/route.ts:24` | **유료 기관 수**(조건부 count) | P7 |
| `app/api/admin/system/usage/route.ts:31` | 운영자 사용량 | P7 |
| `app/api/admin/system/billing/route.ts:12` | 과금 집계 | P7 |
| `app/api/admin/system/agencies/route.ts:14` | 기관 목록 | P7 |
| `app/api/admin/subscription/route.ts:16` | 구독 조회 | P7 |
| `app/api/admin/sites/options/route.ts:17` | 현장 옵션 | P7 |

---

## 9. 정리와 보존

- `scripts/cleanup-pilot.mts`는 `PILOT_AGENCY_ID`를 받고 대상 Agency의 `isDemo=true`를 재검증한다.
- 기본은 dry-run이며 테이블별 삭제 예정 건수만 출력한다.
- 실제 삭제는 별도 명시 옵션과 확인문구가 있어야 한다.
- Trainee에는 agencyId가 없으므로 `Site.id → Trainee.currentSiteId/Placement` 관계로 대상을 수집한다.
- 삭제 순서는 `TraineeLogTask → TraineeLog → AttendanceIssueEvent → AttendanceIssue → DailyAttendance → SiteSignToken → DocumentRun/Version → TraineePlacement → Trainee → SiteAssignment → Site → WorkerInvite → Agency`로 고정한다.
- ★`AttendanceIssueEvent`(`prisma/schema.prisma:1335`)는 v2 순서에서 누락됐던 항목이다. 파일럿에서 근태 이의가
  생길 일은 드물지만 순서 목록은 완전해야 한다.
- `Worker`, `AuditEvent`, `AccessLog`는 삭제하지 않는다. worker는 다른 기관에 연결될 수 있고 감사·접근 기록은 보존 대상이다.
- dry-run은 훈련생 개인정보 건수를 별도 항목으로 표시한다.
- 운영 기관 id에는 실행할 수 없게 한다.
- 삭제 전에 필요하면 PDF를 참여자가 직접 내려받는다. 서버에 PDF 바이너리를 영구 저장하지 않는다.

---

## 10. 마이그레이션과 배포

설계 승인 후 구현 시:

1. `Agency.isDemo` 추가 migration
2. 기존 기관은 default false
3. 파일럿 기관 1개와 초대 발급용 최소 manager 준비
4. Preview DB에만 먼저 적용
5. 파일럿 격리·공단발송 차단·급여 제외 테스트
6. production migration과 `/pilot` 공개는 별도 승인

URL은 같은 배포의 `/pilot`이므로 DNS 변경은 없다. 검색 노출을 막기 위해 `/pilot`에는 `noindex, nofollow`를 설정한다.

---

## 11. 테스트 명세

### 11-1 접근·격리

- 일반 worker는 pilot 초대/배정 없이 `/pilot` 쓰기 불가
- pilot worker A가 B의 assignment/site/trainee id로 직접 요청 불가
- pilot 데이터가 운영 통계·과금·마켓·급여 대상에 미포함
- demo agency 문서의 공단 발송 API 하드블록
- demo Site에 manager 일반 배정 API로 worker 배정 시 403
- **demo 기관 초대에 `siteId`가 있어도 수락 시 배정이 생성되지 않음**(`worker/invite/[id]` 경로)
- **파일럿 Site에 두 번째 배정이 어떤 경로로도 생기지 않음**
- demo worker의 연차 자동적립·급여 draft·결제 대상 생성 없음

### 11-2 설정

- Site+Assignment+복수 Trainee+Placement 전체 성공
- 중간 실패 시 전부 롤백
- 같은 파일럿 Site에 두 worker 배정 거부
- 잘못된 기간·CUSTOM 시간·빈 훈련생 배열 거부

### 11-3 근무일

- 평일 자동 후보 생성, 주말·공휴일 제외
- 미래 날짜 저장 불가
- 사용자가 제외한 날짜 미생성
- 날짜별 수정시간 반영
- 재요청 시 중복 DailyAttendance 없음
- 확정 후 날짜 추가·시간 수정 성공
- 일지 없는 날짜 해제 성공, 일지 있는 날짜 해제는 409
- **일지 있는 날짜 해제 409 후 해당 `TraineeLog`가 실제로 남아 있음**(cascade 미발동 확인)
- **서로 다른 날짜 두 건을 동시에 delta 수정해도 둘 다 반영**(lost update 없음)
- **같은 날짜에 낡은 `expectedUpdatedAt`으로 update/remove 요청 시 409**
- **delta 세 배열 중 하나가 409면 전체 롤백**(부분 반영 없음)
- 실제 버튼 기록 없이도 확인된 근무일로 출근부 생성

### 11-4 일지·다수 훈련생

- 훈련생 1명과 여러 명(최대 5명) 모두 저장
- **훈련생 6명 등록 시도는 거부**
- 같은 근무일·훈련생 중복 일지 없음
- 다른 worker의 훈련생 일지 조회·저장 차단
- 선택한 훈련생별 PDF 각각 생성

### 11-5 서명·PDF

- 사업체 담당자 입력 이름·서명 표시
- 직무지도원 이름·서명 자동 표시
- 위탁기관 담당자 이름 입력 시 인쇄
- 미입력 시 최소 40mm 밑줄
- 긴 이름에도 행 간 침범·겹침 없음
- 5종 PDF 모두 동일 정책 · 훈련생 1~5명 전 구간 검증
- 서명 블록 페이지 분리 시 내용과 겹치지 않음
- Word 다운로드 버튼·API가 노출되지 않음

★**회귀 기준선은 두 개이며 서로 다른 것이다. 하나로 합쳐 적지 않는다.**

| 기준선 | 값 | 실행 | 현재 상태 |
|---|---|---|---|
| **Vitest 단위·통합 테스트** | **416건 / 29파일** | `npx vitest run` | ✅ 존재. 2026-08-11 실측 `Tests 416 passed (416)` |
| **PDF 출근부 기간 전수 스윕** | **519케이스**(28~200일 × 시작요일 3종) | 신규 스크립트 | ❌ **리포에 없음. P0에서 신규 작성** |

★v2까지 "기존 전체 519개 테스트"로 적혀 있던 것은 **두 수치를 섞은 오류**였다.
519는 테스트 수가 아니라 `docs/WORK_STATUS_2026_07_20_PDF_SIGNATURE.md:10`에 기록된 **PDF 스윕 케이스 수**이고,
그 스윕은 2026-07-20 당시 커밋되지 않은 일회성 작업이었다.
현재 리포의 PDF 스크립트는 `scripts/verify-pdf.mts` 하나뿐이며 **문서당 1건씩 고정 5케이스**만 렌더한다.
게다가 그 5케이스의 출근부는 10일치라 **페이지 분할 자체가 일어나지 않아** `signatures()` 회귀를 잡지 못한다.

`signatures()` 고정 폭 개편의 회귀를 실제로 잡아 주는 유일한 도구가 이 스윕이므로,
**P0에서 스윕 스크립트를 먼저 만들고 개편 전 기준 출력을 확보한 뒤에** P6을 착수한다.
스윕 통과 기준은 2026-07-20과 동일하게 **전 케이스에서 확인문구·작성일·서명이 같은 페이지에 있고 분리 0건**이다.

### 11-6 모바일

- 360px 폭에서 설정·근무일 체크·일지·서명 가능
- 터치 서명 영역 스크롤 충돌 없음
- PDF 미리보기 실패 시 다운로드 대체 제공

---

## 12. 구현 순서 제안

1. Vitest 416 기준선 확인 + **PDF 기간 스윕 스크립트(519케이스) 신규 작성** + 개편 전 기준 출력 확보
2. `Agency.isDemo` migration, PRO/무제한 파일럿 기관, Manager 준비
3. 급여·연차·결제 및 외부 assignment 생성 하드블록(`assignmentLock.ts` 호출부 7곳 기준)
4. 공통 `requirePilotWorker()` 접근 가드
5. `/pilot` 시작·설정 화면과 setup transaction(훈련생 1~5명 상한)
6. 근무일 preview/confirm + delta PATCH 공통 계산 helper
7. 파일럿 일지 UI/API
8. 사업체 담당자 서명 wrapper와 `gov_agent` 차단
9. 위탁기관 담당자 이름 입력과 PDF payload 전달
10. 기존 `signatures()` 고정 폭 개선 및 5종 시각 검증
11. 나머지 운영 조회·집계 격리와 cleanup dry-run
12. 전체 테스트·모바일·PDF 렌더 검증 후 Preview 배포

---

## 13. v2 → v3 변경 요약

Claude 2차 검토(코드 실측 기반)에서 나온 지적을 반영했다.

| # | 지적 | 반영 |
|---|---|---|
| 1 | "519개 테스트"는 존재하지 않음(실측 416건). 519는 PDF 스윕 케이스 수이고 **스윕 스크립트가 리포에 없음** | §11-5에 두 기준선 분리, §12-1·P0에 스윕 스크립트 신규 작성 |
| 2 | 근무일 전체 집합 수정은 lost update 발생 | §5-3 delta(`add`/`update`/`remove`) + `expectedUpdatedAt` 409로 변경, §7 `PUT`→`PATCH` |
| 3 | `TraineeLog.attendanceId`가 `onDelete: Cascade` | §5-3에 근거 명시 — remove 전 일지 존재 검사가 **필수**임을 못박음 |
| 4 | 훈련생 상한 미정 | §1-0-1·§4-6 직무지도원당 5명, PDF 검증 1~5명 |
| 5 | `attendanceMode` 미정 | §4-4 `NONE` 확정 + **이 필드를 읽는 코드가 없다**는 실측 명시 |
| 6 | 유료 기관 통계는 조건부 `count`라 목록 제외로는 안 잡힘 | §8에 `system/stats/route.ts:24` 파일·줄 단위 명시 |
| 7 | 결제 경로는 이미 구조적으로 안전 | §8 위험도 표로 P1 세 항목의 실제 위험도 차등 표기 |
| 8 | cleanup 순서에 `AttendanceIssueEvent` 누락 | §9 순서 보정 |
| 9 | 배정 chokepoint 전수 조사 방법 | §4-5에 `assignmentLock.ts` 호출부 앵커 + 대상 7곳/비대상 3곳 실측 표 |

## 13-1. v3 보정 (배정 경로 누락 1건)

v3 최초본이 *"`assignmentLock.ts` 호출부를 앵커로 삼는다 … 새 경로를 추측으로 찾지 않는다"* 라고 단정한 것은
**틀렸다.** `app/api/worker/invite/[id]/route.ts:135`가 락을 거치지 않고 `siteAssignment.create()`를 직접 호출한다.

| # | 보정 | 위치 |
|---|---|---|
| 1 | 초대 수락 경로를 **8번째 하드블록 대상**으로 추가 | §4-5 ⑧ · §8 · §11-1 |
| 2 | "단일 관문" → **"주요 앵커"** 로 표현 정정 | §4-5 |
| 3 | 전수조사는 **락 호출부 + `create`/`upsert`/`updateMany` 검색 병행** | §4-5 |
| 4 | `expectedUpdatedAt`은 조회 후 비교가 아니라 **`WHERE id AND updatedAt` 원자적 CAS** | §5-3 |

★**교훈**: 이 리포는 "chokepoint 단일화"를 여러 차례 수행했지만(정원=`checkSiteCapacity`, 근태소유권=`ownedAttendanceWhere`,
배정=`assignmentLock`), **의도적으로 제외된 예외가 주석으로만 남아 있는 경우**가 있다.
관문 함수의 호출부를 훑는 방식은 그런 예외를 구조적으로 놓친다.
**모델 단위 쓰기 구문(`create`/`upsert`/`updateMany`) 직접 검색을 항상 병행**할 것.

**참고(파일럿 범위 밖)**: `WorkerInvite.code`에는 unique 제약이 없다(`prisma/schema.prisma:1845`는 index만).
파일럿 참여 판정은 `code`가 아니라 `existingWorkerId`/`usedByWorkerId`로 하므로 영향은 없다.

---

## 14. 승인 게이트

이 문서는 구현 승인이 아니다. **문서 확정과 P0 구현 승인은 별개로 진행한다.**
v3 문서가 확정되어도 코드·schema·migration·seed·test 작업은 시작하지 않으며,
**P0(기준선 확보 + 스윕 스크립트 작성)부터 별도 승인**을 받는다.
