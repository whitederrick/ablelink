# Able-Link 파일럿 설계 v1.7 — 검토 이력

> ⚠️ 구현 기준으로 사용하지 않는다.
>
> 파일럿 범위를 `WORKER_DOCUMENT_POC`로 다시 한정한 최종 기준 문서는
> `docs/PILOT_DESIGN_2026_08_12_v1_8.md`이다. 이 문서는 v1.8에 이르는 검토 이력 보존용이다.

작성일: 2026-08-12
계보: v1.1(2026-08-11) → v1.2(운영 모델 전환) → v1.3(1차 리뷰 7건) → v1.4(2차 리뷰) → v1.5(3차 리뷰) → v1.6(4차 리뷰) → **v1.7(5차 리뷰 — 코드 전수 실측 + 교차 검토 반영·최종)**
기준 문서: 이 문서가 **파일럿 설계의 단일 최신본**이다. `docs/PILOT_DESIGN_2026_08_11.md`(v1.1)를 대체한다.
v1.2~v1.6은 이 문서로 수렴한 중간 개정본이며 별도 파일로 남기지 않는다(v1.6 파일은 2026-08-12 삭제).
08-11자 `PILOT_WORKER_DOCUMENT_SERVICE_DESIGN` / `..._IMPLEMENTATION_PLAN`(v3, 워커 자가 프로비저닝형)은
운영 모델이 전환되어 **폐기 상태**이며 참조하지 않는다.

**v1.6 → v1.7 개정 사유 (5차 리뷰 — 실측 검증 상 3건·중 4건 + 교차 검토 신규 P0 1건 + 문구·라인 정정)**

1. **Capability fail-closed 확정** — §9-2 의사코드와 §9-3 본문("집합에 없으면 플랜 게이트")이 모순이었다. `pilotSessionId`가 있는 배정은 회차 판정에서 반드시 종결하고 일반 플랜 폴백을 금지한다.
2. **파일럿 배정 경로의 락·정원 정책 확정** — 수락 분기·위저드 배정이 9·10번째 생성 경로가 되는데 정책이 없었다. 둘 다 `assignmentLock → checkSiteCapacity → 생성`을 적용한다.
3. **`traineeIds BigInt[]` 기각 → `PilotParticipantTrainee` 조인 테이블** — §7-2가 범용 목록 테이블을 "FK 정합성 미보장"으로 기각해 놓고 배열이 같은 약점을 갖는 자기모순이었다(스키마 전체에 `BigInt[]` 전례 0건).
4. **`WorkerStatus.INACTIVE`는 존재하지 않는 값** — enum은 `ACTIVE`·`RESIGNED`·`PAUSED` 3종(schema.prisma:1525-1529). `PAUSED` + `sessionVersion` 증가로 정정.
5. **폐기 순서 FK 위반 교정 + `PilotSession`·`PilotParticipant` 보존** — `WorkerInvite.siteId`가 `Site`를 참조하므로 선삭제. `purgedAt`을 기록할 회차·참여자 행은 삭제하지 않는다.
6. **초대 수락은 `READY`에서만** — 수락 허용 상태가 미정이었다. 상태 전이 조건과 미응답 참여자 처리 규칙을 확정.
7. **★신규 P0: `AGENCY_FULL_FLOW` 급여 스코프** — `computePayrollItems(agencyId, yearMonth)`는 기관 전체를 계산한다(`lib/payroll/computeRun.ts:66-69`). 회차 필터 없이 PAYROLL을 허용하면 정상 Worker가 파일럿 급여에, 파일럿 Worker가 cron 정상 급여에 섞인다. 회차 단위 급여 구조를 신설(§9-5).
8. **기간 규칙 이원화** — 생성 불변식(배정 ⊆ 회차)만으로는 문서 요청 기간의 안전이 완결되지 않는다. D-1의 단일 coverage resolver 검증을 병행한다. coverage는 **문서 종류별로 다르고**(출근부는 placement·supervision 불요), 불연속 supervision에 대비해 **`coverageRanges`(구간 배열) 계약**으로 정의한다(§9-4).
9. **"배정 8경로 하드블록" → SiteAssignment 전체 쓰기 경로 매트릭스** — 실측상 순수 생성은 4곳뿐이고 락 밖 상태 변경이 다수라, 경로 개수가 아니라 분류·판정표가 구현 기준이 되어야 한다(§15-4).
10. **실측 문구·라인 정정** — 급여명세서 서명란·verify-pdf 케이스 수·bulk-generate 조건·PDF 슬롯 매핑·급여 계산 호출 라인 등(각 절에 반영).
11. **capability 판정의 assignment 문맥 필수** — 기관에 활성 회차가 있다는 이유만으로 권한을 주지 않는다. 서명 경로 포함 모든 판정에 명시적 `assignmentId` + 본인 소유 검증을 요구한다(§9-2).

**v1.7 최종 보정 (6차 — 교차 검토 3건 + 실측 3건, 2026-08-12)**

구조 재설계가 아니라 **문서 완결성 보정**이다. 판정식과 스키마 목록의 누락만 채웠다.

12. **D-1 결정 게이트 표기 1건 → 2건** — 상단·§15-2는 "1건"인데 §9-4·§16은 불연속 coverage 정책을 D-1 v6 확정 항목으로 두어 문서 내부가 어긋나 있었다.
13. **`CONTRACT_ONLINE` agency 배선 + 산출물 출처 필드** — §9-3이 계약 capability를 부여하지만 실행 구조는 급여만 다뤘다. 계약 게이트도 agency 축이다(`admin/contracts/route.ts:152` · `admin/contract-clauses/route.ts:51`). 출처 필드가 없으면 폐기 대상을 정할 수 없다(§9-6·§7-2). ★**단 `contract-clauses`는 7차에서 배선 대상에서 제외했다 — 아래 21번이 최종**이다.
14. **Prisma 역방향 관계 누락** — `Admin.createdWorkerInvites`가 빠져 있어 그대로 옮기면 `prisma validate`에서 막힌다. `PayrollRun` 쪽 관계 필드도 명시한다(§3·§7-2).
15. **★급여 소비처는 3곳이 아니라 4곳** — `scripts/seed-payslip-demo.mts:99`가 누락됐다. `tsconfig.json`의 `include`에 `"**/*.mts"`가 있고 `exclude`는 `node_modules`·`.claude`뿐이라 스크립트도 타입체크 대상이며, `@@unique` 제거 시 **tsc 게이트가 깨진다**(§9-5).
16. **★`adaptationStartDate`에 의한 serviceStep 경계 분할이 coverage 판정식에서 빠졌다** — 단일 배정 안에서 문서 종류가 갈리는데(`schema.prisma:277-279`) 훈련일지·적응지도일지를 똑같이 `∩ SiteAssignment`로 처리하고 있었다(§9-4-1).
17. **`SiteAssignment.endDate`는 nullable + 배정 단건 확정 전제** — resolver가 운영 공용이므로 종료일 미정 배정을 다뤄야 하고, "출근부는 항상 단일 구간"은 배정 1건 확정 뒤에만 성립한다(§9-4).
18. **★계약 생성은 진입 경로가 3개다** — 6차 보정 초안이 급여에서 유추해 `assignmentId` 필수로 썼으나, `workerId` 경로와 수동입력(신규 워커 최초 계약) 경로에는 배정이 없다. 그대로면 **파일럿 2에서 신규 워커의 최초 계약을 만들 수 없다.** 경로별 회차 귀속 판정으로 교정(§9-6).
19. **연차 하드블록의 범위 명시** — §15-3의 차단은 **cron 자동 적립 한정**이고, 급여 실행이 만드는 `AnnualLeaveEntry`는 별개 경로다. 둘을 구분하지 않으면 `AnnualLeaveEntry.pilotSessionId?`가 하드블록과 모순처럼 보인다(§15-3).
20. **서명된 근로계약서의 삭제 가부는 단정하지 않는다** — 실재 기관·워커 간 실제 계약이라 `Worker` hard delete 금지와 같은 성격의 판단이 필요하다(§19-1).

**v1.7 7차 보정 (2026-08-12) — 파일럿 2 봉인**

21. **`contract-clauses`를 회차 capability 배선 대상에서 제외** — `AgencyContractClause`는 `agencyId`만 갖는 **기관 전체 공용 마스터**다(`schema.prisma:958-972`). 파일럿 권한으로 열면 같은 기관의 정상 계약에 영향을 준다(§9-6).
22. **§9-6 경로 ②의 회차 추론 금지** — `workerId`로 `PilotParticipant`를 찾아 회차를 추론하면, 파일럿 참여 워커에게 발행하는 **정상 계약이 자동으로 파일럿 계약으로 분류**되고 `FREE` 기관에서 거부되어야 할 계약이 허용되는 역전이 생긴다. ②③은 **명시 `pilotSessionId` 필수**, 참여자 조회는 검증 전용(§9-6).
23. **"열린 질문 0건" 표현 정정 → 3층 분리** — §13-1이 미확정 항목을 남긴 것과 어긋나 있었다(상단 표).
24. **미확정 자원을 실행 가능한 폐기 순서에서 제거** — 정책 확정 전까지 계약·연차 3종을 **보존**하고 회차의 `PURGED` 전환을 **차단**한다(§13-3).
25. **인용 오류 정정** — `PayContract.siteId`는 `:1234`가 아니라 `:1189`(관계 선언 `:1215`). `:1234`는 `PayrollRun`의 `@@unique` 라인이다(§13-3).
26. **★파일럿 2 항목을 §19로 봉인** — 계약 알림톡·연차 5경로·산출물 보존 정책을 개별 반영하지 않고 **단일 게이트로 묶는다.** v1은 `WORKER_DOCUMENT_POC`만 실행하므로 이 항목들은 **v1 착수를 막지 않는다.**

**열린 결정 — 3층으로 분리한다** (★7차 보정: "열린 질문 0건"은 §13-1의 미확정 항목과 어긋나 있었다)

| 층 | 건수 | 내용 | v1 착수 영향 |
|---|---|---|---|
| `WORKER_DOCUMENT_POC` 자체 | **0건** | — | 없음 (착수 가능) |
| **선행 D-1 결정 게이트** | **2건** | ①1:多 판정 기준 ②불연속 coverage 문서화 정책 (§15-2) | ★**착수 지점** |
| `AGENCY_FULL_FLOW` 착수 전 게이트 | **1건(묶음)** | 파일럿 2 산출물·부작용 정책 (§19) | 없음 (v1 미실행) |

★**v1 착수를 막는 것은 D-1 게이트 2건뿐이다.** 파일럿 2 항목은 §19에 **봉인**하고
개별 보정으로 문서를 계속 열지 않는다.

---

## 1. 운영 모델

### 1-1. 공통

- **시스템 운영자**가 파일럿 관리 메뉴에서 환경 전체를 셋업한다.
- **직무지도원**은 초대를 받아 로그인하고, 기존 사용자 화면을 그대로 쓴다. 별도 등록 UI를 만들지 않는다.
- **위탁기관은 실재 기관**을 필수 지정한다. 운영자와 직무지도원 모두 어느 기관인지 알고 있다.
- 기관 엔티티에 **영구 파일럿 플래그를 붙이지 않는다**(`Agency.isDemo` 방식 기각). 실재 기관이 이후 정식 운영으로 전환되어도 꼬이지 않아야 한다.
- 파일럿 데이터는 **실데이터**다. 체험·데모가 아니다. 격리하는 이유는 데이터가 가짜여서가 아니라, 위탁기관 담당자 부재로 생긴 예외 프로세스를 운영 흐름에 섞지 않기 위해서다.

### 1-2. 유형별 분리

"위탁기관 담당자 계정 없음"은 **공통 항목이 아니라 `WORKER_DOCUMENT_POC` 전용**이다.

| 항목 | `WORKER_DOCUMENT_POC` (파일럿 1) | `AGENCY_FULL_FLOW` (파일럿 2) |
|---|---|---|
| 위탁기관 담당자 계정 | **없음** | **실제 `Manager` 계정 필수** |
| 담당자 이름 출처 | `PilotSession.managerDisplayName`(선택) | 실제 서명한 `Manager.displayName` |
| `managerDisplayName` | 사용 | **미사용** |
| 직무지도원 최종 제출 | 차단 | 허용 |
| 위탁기관 승인·서명 | 차단 | 허용(공식 흐름) |
| 급여 | 차단 | **회차 스코프로만** 허용(§9-5, 시급제 검증) |
| 외부 전송 | 차단 | 차단 |
| PDF 미리보기·다운로드 | 허용 | 허용 |

`AGENCY_FULL_FLOW`는 담당자가 실재하므로 예외 프로세스가 없다. 파일럿 회차로 묶는 목적은 **격리와 폐기 스코프 확보**이지 권한 우회가 아니다.

---

## 2. 접근권 — 3-관계 교집합 (D-1 정합)

파일럿용 권한 우회 코드는 만들지 않는다. 다만 접근권이 자연 파생되려면 **세 관계가 모두 있어야** 한다.

```
문서 접근 허용 =
    SiteAssignment      (그 현장에 그 기간 자기 배정으로 관여했는가)
  ∩ TraineePlacement    (그 훈련생이 그 현장에 그 기간 재적했는가)
  ∩ TraineeSupervision  (그 훈련생을 그 직무지도원이 담당했는가)
  ∩ 요청 문서 기간과의 겹침
```

`SiteAssignment ∩ TraineePlacement`만으로는 **같은 사업체에 직무지도원이 2명일 때 누가 어느 훈련생을 담당하는지 구분할 수 없다.** 따라서 운영자 셋업에도 `TraineeSupervision` 생성이 반드시 포함된다(§6).

- ★위 교집합은 **훈련생 종속 문서**(훈련일지·적응지도 일지·종합평가) 기준이다. **출근부는 직무지도원 본인의 근태 문서**라 placement·supervision을 접근 조건으로 요구하지 않는다 — `SiteAssignment ∩ 요청 기간`(파일럿은 ∩ 회차)만으로 파생된다(§9-4). 출근부의 1:多 표기가 placement 데이터를 **읽는** 것은 payload 파생이지 접근 조건이 아니다(담당 훈련생 이탈이 출근부를 잘라내면 안 된다).
- 접근권은 훈련생 "소유"가 아니라 **관여 사실**에서 파생된다(2026-08-11 도메인 판정).
- 훈련생 **기간 겹침 placement 거부 불변식**은 파일럿에도 예외 없이 적용한다.
- ★이 교집합을 계산하는 **단일 coverage resolver는 D-1 산출물**이다. 파일럿 전용 함수를 만들지 않고 그것을 재사용한다(§9-4).
- ★`TraineeSupervision`은 **현재 저장소에 존재하지 않는다**(`prisma/schema.prisma` 전수 검색 0건). D-1 구현이 선행되어야 한다(§16).

---

## 3. PilotSession 엔티티

```prisma
enum PilotSessionType {
  WORKER_DOCUMENT_POC   // 파일럿 1 — 직무지도원 문서 서비스
  AGENCY_FULL_FLOW      // 파일럿 2 — 위탁기관 풀 플로우
}

enum PilotSessionStatus {
  DRAFT       // 셋업 중
  READY       // 필수 설정 완료 — 초대 발급·수락 창구
  ACTIVE      // 직무지도원 사용 중
  ENDED       // 종료·보존 중
  PURGED      // 파일럿 데이터 폐기 완료 (행 자체는 영구 보존)
  CANCELLED   // 시작 전 취소
}

model PilotSession {
  id                  BigInt             @id @default(autoincrement())
  type                PilotSessionType
  status              PilotSessionStatus @default(DRAFT)

  startDate           DateTime           @map("start_date") @db.Date
  endDate             DateTime           @map("end_date")   @db.Date

  agencyId            BigInt             @map("agency_id")

  // 위탁기관 담당자 표시명 — WORKER_DOCUMENT_POC 전용, 선택, 후입력 가능.
  // AGENCY_FULL_FLOW에서는 사용하지 않는다(실제 Manager.displayName이 우선).
  managerDisplayName  String?            @map("manager_display_name")

  createdByAdminId    BigInt             @map("created_by_admin_id")
  activatedAt         DateTime?          @map("activated_at")
  endedAt             DateTime?          @map("ended_at")
  purgedAt            DateTime?          @map("purged_at")
  createdAt           DateTime           @default(now()) @map("created_at")
  updatedAt           DateTime           @updatedAt      @map("updated_at")

  agency       Agency  @relation(fields: [agencyId],         references: [id])
  createdBy    Admin   @relation(fields: [createdByAdminId], references: [id])

  participants PilotParticipant[]
  invites      WorkerInvite[]
  payrollRuns  PayrollRun[]

  @@index([status, startDate, endDate])
  @@index([agencyId, status])
  @@map("pilot_sessions")
}
```

★Prisma는 관계 양방향 선언을 요구한다. 역방향 필드를 함께 추가한다:
`Agency.pilotSessions PilotSession[]` · `Admin.pilotSessions PilotSession[]` ·
★`Admin.createdWorkerInvites WorkerInvite[]` · `Worker.pilotParticipations PilotParticipant[]` ·
`WorkerInvite.pilotParticipant PilotParticipant?` ·
`Site.pilotParticipants PilotParticipant[]` · `SiteAssignment.pilotParticipant PilotParticipant?` ·
`Trainee.pilotParticipantLinks PilotParticipantTrainee[]`.

★**`Admin.createdWorkerInvites`는 v1.7 최초본에서 누락됐던 항목이다.** §5-2가 `WorkerInvite`에
`createdByAdminId BigInt?` + `createdBy Admin?`을 추가하므로 `Admin` 쪽 역방향이 없으면
`prisma validate`가 실패한다. `WorkerInvite.creator Manager?`(기존)와 이름이 겹치지 않도록
`createdWorkerInvites`로 둔다.

`PilotSession` 쪽 역방향은 모델 정의에 이미 있으나(`payrollRuns PayrollRun[]` 등),
**참여 FK를 붙이는 상대 모델에도 관계 필드를 명시**해야 한다(§7-2).

---

## 4. PilotParticipant 엔티티 (★v1.7 개정 — 실 FK·조인 테이블)

### 4-1. 왜 필요한가

신규 Worker 흐름은 "사업체·훈련생·placement를 사전 설정 → 초대 → 수락 시 assignment·supervision 생성"이다.
그런데 **계정과 assignment가 아직 없는 시점**에 아래 값을 저장할 곳이 없다.

대상 Site / 배정 시작·종료일 / `serviceStep` / `workType` / 출퇴근지도 포함 여부 / `CUSTOM` 근무시각 / `attendanceMode` / `attendanceButtonExempt` / 담당 훈련생

`PilotSession`은 **기관 단위 회차**이고 `WorkerInvite`는 **초대 정보**다(실측: WorkerInvite에 배정 사전 설정 필드 없음). 회차 하나에 직무지도원이 여러 명이므로 **참여자 단위 중간 모델**이 필요하다.

### 4-2. 정의

v1.6의 `traineeIds BigInt[]`는 **기각**한다. §7-2가 범용 목록 테이블을 기각한 사유(FK 정합성 미보장)가 배열에 똑같이 적용되고, 스키마 전체에 `BigInt[]` 전례가 0건이다. 조인 테이블로 대체한다.

```prisma
enum PilotParticipantStatus {
  CONFIGURED   // 설정 완료, 초대 전
  INVITED      // 초대 발급됨
  ACCEPTED     // 수락 완료, assignment 생성됨
  CANCELLED    // 운영자 취소(미응답 포함) — 연결 초대 즉시 무효화
}

model PilotParticipant {
  id                       BigInt                 @id @default(autoincrement())
  pilotSessionId           BigInt                 @map("pilot_session_id")

  // 기존 Worker면 셋업 시점에 채워지고, 신규 Worker면 초대 수락 시 채워진다.
  workerId                 BigInt?                @map("worker_id")
  // ★@unique — 초대 수락 시 invite → participant를 유일하게 역참조한다(모호성 제거).
  inviteId                 BigInt?                @unique @map("invite_id")
  // ★폐기 시 Site가 삭제될 수 있어 nullable + SetNull. CONFIGURED~ACCEPTED 동안은 앱 검증으로 필수.
  siteId                   BigInt?                @map("site_id")
  status                   PilotParticipantStatus @default(CONFIGURED)

  // ── 배정 사전 설정값 (수락 시 이 값으로 SiteAssignment를 만든다) ──
  // ★생성 불변식: assignmentStartDate~EndDate ⊆ 회차 startDate~endDate (§9-4)
  assignmentStartDate      DateTime               @map("assignment_start_date") @db.Date
  assignmentEndDate        DateTime               @map("assignment_end_date")   @db.Date
  serviceStep              ServiceStep            @map("service_step")
  // ★workType은 SiteAssignment에서 enum이 아니라 String이다(schema.prisma:282).
  //   기존 컬럼 타입과 일치시키고, 값 검증은 lib/workSchedule.ts:17 VALID_WORK_TYPES로 한다.
  workType                 String                 @map("work_type")
  commuteGuidanceIncluded  Boolean                @default(true) @map("commute_guidance_included")
  customWorkStart          String?                @map("custom_work_start")
  customWorkEnd            String?                @map("custom_work_end")
  attendanceMode           AttendanceMode         @default(NONE) @map("attendance_mode")
  attendanceButtonExempt   Boolean                @default(true) @map("attendance_button_exempt")

  createdAssignmentId      BigInt?                @unique @map("created_assignment_id")
  acceptedAt               DateTime?              @map("accepted_at")
  purgedAt                 DateTime?              @map("purged_at")   // 폐기 잡이 관계를 정리한 시점
  createdAt                DateTime               @default(now()) @map("created_at")
  updatedAt                DateTime               @updatedAt      @map("updated_at")

  pilotSession      PilotSession    @relation(fields: [pilotSessionId],      references: [id])
  worker            Worker?         @relation(fields: [workerId],            references: [id])
  invite            WorkerInvite?   @relation(fields: [inviteId],            references: [id], onDelete: SetNull)
  site              Site?           @relation(fields: [siteId],              references: [id], onDelete: SetNull)
  createdAssignment SiteAssignment? @relation(fields: [createdAssignmentId], references: [id], onDelete: SetNull)
  trainees          PilotParticipantTrainee[]

  @@unique([pilotSessionId, workerId])
  @@index([pilotSessionId, status])
  @@map("pilot_participants")
}

model PilotParticipantTrainee {
  id            BigInt @id @default(autoincrement())
  participantId BigInt @map("participant_id")
  traineeId     BigInt @map("trainee_id")

  participant PilotParticipant @relation(fields: [participantId], references: [id], onDelete: Cascade)
  trainee     Trainee          @relation(fields: [traineeId],     references: [id])

  @@unique([participantId, traineeId])
  @@map("pilot_participant_trainees")
}
```

- `@@unique([pilotSessionId, workerId])` — 같은 회차에 같은 Worker 중복 참여 금지. `workerId`가 NULL인 신규 Worker 대기 행은 Postgres가 NULL을 구분값으로 취급하므로 충돌하지 않는다.
- `PilotParticipant`는 **폐기 시 삭제하지 않는다**(§13). 참여 이력·감사 근거로 보존하고, SetNull FK 정리 후 `purgedAt`을 기록한다.

### 4-3. 수락 트랜잭션

초대 수락 시:

1. 회차 상태가 **`READY`인지 검사**(§8-1). 아니면 수락 거부.
2. `inviteId @unique`로 `PilotParticipant` 행을 특정하고 **잠근다**(`SELECT … FOR UPDATE` 또는 `updateMany` CAS).
3. `createdAssignmentId`가 이미 있으면 **재수락으로 보고 중복 생성하지 않는다**(멱등).
4. **수락 시점 검증**: 연결된 각 `Trainee`가 실존하고, 해당 `Site`에 배정 기간과 겹치는 `TraineePlacement`가 있는지 확인. 실패하면 수락을 거부하고 운영자에게 알린다(설정과 실데이터의 드리프트 노출).
5. **한 트랜잭션**에서 Worker 생성 → `assignmentLock` + `checkSiteCapacity`(§5-4) → SiteAssignment 생성(`pilotSessionId` 부여) → TraineeSupervision 생성 → `status = ACCEPTED`, `createdAssignmentId` 기록.

`workType`·`commuteGuidanceIncluded`·`customWorkStart/End`는 운영과 동일하게 `lib/workSchedule.ts:38`
`computeWorkTimes()`로 해석한다. 파일럿 전용 근무시간 규칙을 만들지 않는다.

---

## 5. WorkerInvite 확장

### 5-1. 문제 (코드 실측)

"기존 `WorkerInvite` 재사용"은 현재 코드로는 **성립하지 않는다.**

- 초대 생성 API가 `requireManagerSession()` — 위탁기관 담당자 로그인만 허용 (`app/api/admin/workers/invite/route.ts:20`)
- 스키마가 생성자를 **필수 Manager**로 요구 (`prisma/schema.prisma:1838` `createdByManagerId BigInt`, `:1843` `creator Manager`)

파일럿에는 Manager 계정이 없으므로 운영자가 초대를 발급할 수 없다.
따라서 결정을 **"단순 재사용" → "운영자 발급·회차 전파가 가능하도록 확장 재사용"** 으로 정정한다.

### 5-2. 스키마 보정

```prisma
model WorkerInvite {
  // 기존 필수 → 선택으로 완화
  createdByManagerId BigInt?  @map("created_by_manager_id")
  // 신규
  createdByAdminId   BigInt?  @map("created_by_admin_id")
  pilotSessionId     BigInt?  @map("pilot_session_id")

  creator          Manager?          @relation(fields: [createdByManagerId], references: [id])
  createdBy        Admin?            @relation(fields: [createdByAdminId],   references: [id])
  pilotSession     PilotSession?     @relation(fields: [pilotSessionId],     references: [id])
  pilotParticipant PilotParticipant?
}
```

**규칙**

- `createdByManagerId`와 `createdByAdminId` 중 **정확히 하나만 존재**(XOR). 애플리케이션 검증 + DB `CHECK`.
- 파일럿 초대: `createdByAdminId` + `pilotSessionId` **필수**.
- 일반 초대: 기존 `createdByManagerId` 방식 **그대로**. 동작 변화 없음.
- ★참여자가 `CANCELLED`되면 연결된 초대를 **즉시 무효화**한다(`expiresAt`을 현재로 당기거나 취소 마킹). 만료·취소된 초대의 수락 시도는 거부된다.

```sql
ALTER TABLE worker_invites ADD CONSTRAINT worker_invites_creator_xor
  CHECK (num_nonnulls(created_by_manager_id, created_by_admin_id) = 1);
```

### 5-3. 생성 경로 분리

```
POST /api/admin/pilots/[sessionId]/invites     ← 운영자 전용 (requireAdminSession)
POST /api/admin/workers/invite                 ← 기존 매니저 경로, 확장하지 않음
```

일반 초대 API의 권한 구조를 억지로 확장하지 않는다. 기존 경로의 보안 모델을 건드리지 않는 것이 안전하다.

### 5-4. 초대 수락 분기 (★기존 분기 재사용 금지 + 락·정원 적용)

현재 신규 계정 초대 수락 코드는 `invite.siteId`가 있으면 assignment를 **자동 생성**한다
(`app/api/worker/invite/[id]/route.ts:135`). 파일럿 초대가 이 분기를 그대로 타면:

- 시작일이 **현재 시각으로 고정**되어(`:140`, `:110`의 `new Date()`) 회차 기간과 불일치
- `FULL_DAY` 기본값(`:143`)·`commuteGuidanceIncluded: false`(`:144`) 적용
- `pilotSessionId` 누락
- 운영자가 사전 설정한 assignment와 **중복 생성** 가능

★ 이 경로는 `:131-133` 주석대로 **의도적으로 정원검사에서 제외**되어 있다(주석이 명시한 것은 정원 제외이며,
`assignmentLock` 부재는 별도 사실이다). 락 호출부만 훑으면 구조적으로 발견되지 않으므로 전수조사는
**락 호출부 + 모델 쓰기 구문 grep을 병행**해야 한다.
★★덧붙여 생성측 `app/api/admin/workers/invite/route.ts:33-35` 주석은 "소비측도 `checkSiteCapacity`로
이중방어"라고 주장하지만 **소비측에 실제 호출이 0건**이다 — 현행 코드와 불일치하는 주석이며, 파일럿 구현과
별개로 정정 대상이다.

**조치**: 수락 처리에서 `invite.pilotSessionId`가 있으면 파일럿 전용 경로로 분기한다(§4-3).
★파일럿 수락 분기와 §6-1 위저드 배정 생성은 **9·10번째 배정 생성 경로**가 된다. 두 경로 모두
기존 chokepoint를 그대로 태운다:

```
withSiteAndWorkersAssignmentLock → checkSiteCapacity → SiteAssignment 생성
```

파일럿이라고 정원 예외를 두지 않는다. 재사용 Site의 실정원을 침범하면 안 되고, 파일럿 전용 Site는
정원을 설정하지 않으면 기존 규칙상 **무제한으로 자연 처리**된다(`lib/assignmentCapacity.ts:22` —
`totalCap <= 0 → null`).

---

## 6. 운영자 셋업 순서 (기존/신규 Worker 분리)

`SiteAssignment.workerId`가 필수이므로, 계정이 없는 신규 직무지도원에게는 "assignment 먼저" 순서가 성립하지 않는다.

### 6-1. 기존 Worker

```
1. 회차 생성 (DRAFT)
2. 사업체(Site) 등록 또는 기존 Site 선택
3. 기존 Worker 선택
4. SiteAssignment 생성            (pilotSessionId 부여, ★락+정원검사 경유 — §5-4,
                                    ★기간 ⊆ 회차 기간 검증 — §9-4)
5. 훈련생(Trainee) 등록            (createdByPilotSessionId 부여)
6. TraineePlacement 생성           (pilotSessionId 부여, 기간 겹침 불변식 적용)
7. TraineeSupervision 생성         (pilotSessionId 부여)
8. PilotParticipant 생성           (workerId 채움) + CONNECT_EXISTING 초대 발급
9. READY 전환 → 수락 대기 → ACTIVE (§8-1 조건)
```

### 6-2. 신규 Worker

```
1. 회차 생성 (DRAFT)
2. 사업체(Site) 등록
3. 훈련생 등록 + TraineePlacement 생성
4. PilotParticipant 생성           ← 배정 사전 설정값(★기간 ⊆ 회차 기간 검증) + PilotParticipantTrainee
5. READY 전환 + WorkerInvite 발급   (createdByAdminId + pilotSessionId)
6. ── 초대 수락 (직무지도원, ★회차 READY 상태에서만) ──
     §4-3 수락 트랜잭션:
       Worker 생성
       → 락+정원검사 → SiteAssignment 생성 (PilotParticipant 설정값, pilotSessionId 부여)
       → TraineeSupervision 생성   (PilotParticipantTrainee 목록 사용)
       → PilotParticipant.status = ACCEPTED, createdAssignmentId 기록
7. ACTIVE 전환 (§8-1 조건 충족 시 운영자 명시 액션)
```

파일럿 관리 메뉴의 셋업 위저드는 **두 경로를 모두** 지원해야 한다.

### 6-3. 운영자 권한 실측 — 대행 가능 여부

| 셋업 항목 | 현재 가능? | 근거 |
|---|---|---|
| 위탁기관 조회·생성 | ✅ | 운영자 콘솔 `/admin/agencies` |
| 직무지도원 계정 직접 생성 | ✅ | `POST /api/admin/system/workers:84` (`requireAdminSession`, 등급 지정·임시비번) |
| 현장(Site) 생성 | ✅ | `POST /api/admin/sites:185` dual 세션 + `:247` `resolveScopeAgencyId(session, body.agencyId)` |
| 배정 생성 | ✅ | `POST /api/admin/assignments:164` dual 세션 (`:316` 락 → `:338` 정원 → `:353` 생성) |
| 근태 **시각** 수정 | ✅ | `PATCH /api/admin/system/attendances/[id]:17` (사유 필수) |
| **훈련생 생성** | ❌ | `app/api/admin/trainees/route.ts:67` `requireManagerSession` — 운영자용 경로 없음(`trainee.create` 전수 2건: 이 경로 + seed) |
| **초대 발급** | ❌ | §5-1 |
| **근무일 생성** | ❌ | `bulk-generate:47`이 워커 세션 전용 |
| **근무일 삭제** | ❌ | `dailyAttendance.delete*` 전수 검색 **0건** — 수정 PATCH만 존재 |

★`bulk-generate`의 실제 조건(v1.6 기술이 불완전했다): **출퇴근버튼 면제 배정 한정**(`:112` — 아니면 403),
**최대 100일**(`:17`), **미래 날짜 절단**(`:71` — 오늘까지만), 배정 기간 밖 제외(`:162`),
주말·공휴일·`SiteHoliday`(`countAsWorkday:false`) 제외(`:163-165`), 기존 기록일 제외(`:166`).
즉 "기간 내 평일 전부"가 아니라 "면제 배정에 한해, 배정기간∩과거 평일 중 미기록분"이다.
파일럿 참여자는 `attendanceButtonExempt` 기본 true(§4-2)라 면제 조건은 자연 충족된다.

★실제로 나가지 않은 날을 **누구도 지울 수 없고**(삭제 경로 0건), 워커의 유일한 수단인
`attendance/edit-request`는 매니저에게 가는데 `WORKER_DOCUMENT_POC`에는 그 매니저가 없다.
또한 **미래 절단 때문에 회차 전체 근무일을 시작 전에 만들어 둘 수 없다.**
→ **파일럿 근무일 확정 화면은 다음 3-구조로 이 결함을 회차 범위 안에서 해소한다:**

```
오늘까지:      근무일 생성·수정·삭제 가능 (delta PATCH + 원자적 CAS + TraineeLog cascade 검사)
미래:          예정일로만 표시 (DailyAttendance 미생성)
날짜 도래 후:  실제 DailyAttendance 생성
```

---

## 7. 파일럿 데이터의 명시적 연결

### 7-1. 판정 규칙

| | 판정식 |
|---|---|
| ❌ 잘못된 판정 | `agencyId` 일치 + 기간 겹침 |
| ✅ 올바른 판정 | **`pilotSessionId` 일치** + 문서 기간이 회차 기간과 겹침 |

기관+기간으로 판정하면, 같은 실재 기관이 같은 기간에 **정상 운영을 병행**할 때 정상 데이터까지
공단 발송 차단·급여 제외·폐기 대상이 된다. 이것이 v1.2의 설계 결함이었다.

### 7-2. FK 적용 대상 (nullable FK 방식 확정)

두 필드의 **의미가 다르다.**

| 필드 | 의미 |
|---|---|
| `pilotSessionId` | 해당 회차에 **참여하는** 운영 데이터 |
| `createdByPilotSessionId` | 해당 회차가 **새로 만들었고 폐기 후보인** 공유 자원 |

```prisma
// 회차 참여 데이터
WorkerInvite.pilotSessionId?
SiteAssignment.pilotSessionId?
TraineePlacement.pilotSessionId?
TraineeSupervision.pilotSessionId?
PayrollRun.pilotSessionId?          // 회차 단위 급여(§9-5)

// ★AGENCY_FULL_FLOW 산출물 — 폐기 출처 판정에 필수(§9-6·§13)
EmploymentContract.pilotSessionId?  // schema.prisma:872
PayContract.pilotSessionId?         // schema.prisma:1182
AnnualLeaveEntry.pilotSessionId?    // schema.prisma:1045

// 회차가 직접 생성한 공유 자원 (폐기 판정용)
Site.createdByPilotSessionId?
Trainee.createdByPilotSessionId?
Worker.createdByPilotSessionId?     // 신규 Worker 종료 정책(§13-2)에 필요
```

★**`PayContract`는 조건부가 아니라 확정이다.** `computePayrollItems`가 `PayContract`(`lib/payroll/computeRun.ts:120`)와
`EmploymentContract`(`:157`·`:163`)를 실제로 읽어 급여를 계산한다. 파일럿 급여가 이 계약들을 소비하므로
출처를 남기지 않으면 폐기 시 어느 계약이 회차 산출물인지 판정할 수 없다.

★**참여 FK는 양방향으로 선언한다.** 필드명만 적어 두면 `prisma validate`가 통과하지 않는다. 예:

```prisma
model PayrollRun {
  pilotSessionId BigInt?       @map("pilot_session_id")
  pilotSession   PilotSession? @relation(fields: [pilotSessionId], references: [id])
}
// PilotSession.payrollRuns PayrollRun[] 는 §3 모델 정의에 이미 있다.
```

나머지 참여·출처 FK(`EmploymentContract`·`PayContract`·`AnnualLeaveEntry`·`Site`·`Trainee`·`Worker` 등)도
동일하게 상대 모델의 관계 필드와 `PilotSession` 쪽 역방향 컬렉션을 **쌍으로** 추가한다.

범용 `PilotSessionResource(type, id)` 목록 테이블은 **기각**한다.
다양한 모델의 FK 정합성을 DB가 보장하지 못한다. (★같은 사유로 v1.6의 `traineeIds BigInt[]`도 기각 — §4-2.)

---

## 8. 상태 전이·불변성·동시성

### 8-1. 상태 전이 (★v1.7 확정 — 수락 창구 = READY)

```
DRAFT ──────► READY ──────► ACTIVE ──────► ENDED ──────► PURGED
  │             │                                          (행은 영구 보존)
  └─────────────┴──────────► CANCELLED     (시작 전 취소만 가능)
```

- `DRAFT → READY`: 필수 설정(기관·기간·참여자 1명 이상) 완료 + 설정 검증 통과 시
- **초대 발급·수락은 `READY`에서만 허용한다.**
  - `DRAFT`: 설정 미완성 — 수락 금지
  - `ACTIVE`: 신규 참여자 추가·초대 발급·수락 **전면 금지** (★운영 제약으로 선언: ACTIVE 중 참여자를
    추가할 수 없다. v1은 "아는 테스터 소수"라 수용한다. 추가가 필요하면 회차를 새로 연다.)
  - `CANCELLED`/`ENDED`/`PURGED`: 수락 금지
- `READY → ACTIVE`: 운영자 명시 액션. **조건 = ACCEPTED가 1명 이상이고, 나머지 참여자 전원이
  ACCEPTED 또는 CANCELLED.** `activatedAt` 기록.
  - ★미응답 참여자 1명이 회차를 잠그지 않도록, 운영자는 참여자를 `CANCELLED` 처리할 수 있다.
    이때 연결된 `WorkerInvite`도 즉시 무효화한다(§5-2).
- `ACTIVE → ENDED`: 운영자 명시 액션. `endedAt` 기록
- `ENDED → PURGED`: 폐기 잡 완료. `purgedAt` 기록. **회차 행은 삭제하지 않는다**(§13)
- `CANCELLED`는 `ACTIVE` 이전에만 가능

### 8-2. 상태별 수정 범위

| 상태 | 수정 가능 필드 |
|---|---|
| `DRAFT` / `READY` | 전체 설정 |
| `ACTIVE` | **`managerDisplayName`만** |
| `ENDED` / `PURGED` / `CANCELLED` | **없음(전부 불변)** |

- `ACTIVE` 이후 `agencyId`·`type`·`startDate`·`endDate` **불변**.
- `endDate` 연장은 **v1 비범위**다. 필요가 생기면 감사 가능한 별도 액션으로 설계한다.
- `managerDisplayName`은 `ACTIVE` 중에는 후입력·수정 가능하지만, **`ENDED` 이후 고정**한다(과거 문서 재현성).

### 8-3. ACTIVE 1개 보장 — 이중 방어

★**두 파일럿 유형을 합쳐 전역 `ACTIVE`는 1개다.** 파일럿 1과 파일럿 2를 동시에 운영할 수 없다.
이는 아래 SQL의 실제 동작이며, v1.7에서 정책으로도 명시한다.

```
1차: 트랜잭션 advisory lock   — E-2 계약 발행 락 패턴(b7afc56) 재사용. 정상 경로의 충돌 처리.
2차: partial unique index     — 비정상 경로·향후 코드 누락에 대한 최종 불변식 방어.
```

```sql
CREATE UNIQUE INDEX pilot_sessions_one_active
  ON pilot_sessions ((1))
  WHERE status = 'ACTIVE';
```

회차 간 **기간 겹침 거부**도 같은 advisory lock 안에서 검사한다(일반 `CHECK`로는 막을 수 없다).

---

## 9. Capability 게이트

### 9-1. 문제 (코드 실측) — 게이트는 두 축이다

**worker 축**: PDF 미리보기·생성이 **가장 먼저** `checkPlanAccess(workerId, "PDF_GENERATE")`를 호출한다.

- `app/api/worker/docs/preview/route.ts:27`
- `app/api/worker/docs/generate/route.ts:43`
- `lib/planGuard.ts:132`

★**그런데 `assignmentId`는 그 뒤에야 파싱된다**(`preview:42-43`). 파일럿 판정에 배정이 필요하므로
**배정을 먼저 확정한 다음 권한을 판정하도록 순서를 조정**해야 한다.

**agency 축 (★v1.7 신설)**: 급여 실행의 실제 게이트는 worker 축이 아니라
`checkAgencyPlanAccess(agencyId, "PAYROLL")`(`app/api/admin/payroll/runs/route.ts:54`)다.
`AGENCY_FULL_FLOW`의 PAYROLL capability는 **agency 축에도 회차 판정을 배선**해야 작동한다(§9-5).

`Manager`가 0명인 기관은 `isSelfManagedAgency`(`planGuard.ts:94-97`)로 PDF가 **우연히** 허용될 수 있으나
여기에 의존하면 안 된다.

- 실재 기관에 다른 `Manager` 계정이 이미 있으면 `SELF_MANAGED`가 아니다
- 기관 플랜이 `FREE`/`STARTER`면 PDF가 차단될 수 있다
- 파일럿 권한이 **기관의 계정 수나 구독 상태에 따라 달라진다**

### 9-2. 판정 순서 (의사코드) — ★fail-closed 확정

`pilotSessionId`가 있는 배정은 **회차 판정에서 반드시 종결**한다. 어떤 경우에도 일반 플랜 게이트로
폴백하지 않는다(폴백 허용 시, 유료 플랜 기관의 파일럿 Worker가 회차 종료 후에도 문서를 계속 생성하거나
회차가 금지한 기능을 플랜으로 우회할 수 있다).

```ts
async function resolveDocCapability(
  workerId: bigint,
  requestedAssignmentId: bigint | null,
  feature: PremiumFeature,
  periodStart: string,
  periodEnd: string,
): Promise<CapabilityResult> {

  // 1. 배정을 먼저 확정한다 (기존 resolveDocAssignment 재사용 — lib/docs/resolveDocAssignment.ts:27)
  const resolved = await resolveDocAssignment(workerId, requestedAssignmentId, { … });
  if (resolved.status !== "resolved") return passthrough(resolved);
  const assignment = resolved.assignment;

  // 2. 파일럿 배정이면 회차 판정에서 종결한다 — 기관·기간이 아니라 명시 FK로만
  if (assignment.pilotSessionId) {
    const session = await prisma.pilotSession.findUnique({
      where: { id: assignment.pilotSessionId },
    });

    if (!session)                                        return deny("PILOT_SESSION_NOT_FOUND");
    if (session.status !== "ACTIVE")                     return deny("PILOT_SESSION_NOT_ACTIVE");
    if (!overlaps(periodStart, periodEnd, session.startDate, session.endDate))
                                                         return deny("PILOT_PERIOD_OUT_OF_RANGE");
    if (!PILOT_CAPABILITIES[session.type].has(feature))  return deny("PILOT_FEATURE_NOT_ALLOWED");

    return { allowed: true, via: "PILOT_SESSION", sessionId: session.id };
    // ★여기서 함수가 끝난다. checkPlanAccess로 내려가는 경로 없음.
  }

  // 3. 일반 배정만 기존 플랜 게이트를 적용한다
  return checkPlanAccess(workerId, feature);
}
```

★**모든 파일럿 capability 판정은 명시적 assignment 문맥을 요구한다.** `PDF_SIGN`·`SITE_MANAGER_SIGN`처럼
assignment 문맥 없이 호출될 수 있는 경로도 `assignmentId`를 필수로 받아 **본인 소유를 검증한 뒤** 판정한다
(1단계의 `resolveDocAssignment`가 소유 검증을 겸한다 — 서명 경로도 이미 이 함수를 쓴다, `inperson-sign:53`).
**"기관에 활성 회차가 있다"는 사실만으로 권한을 부여하는 우회 구현을 금지**한다.

### 9-3. Capability 집합

```ts
const PILOT_CAPABILITIES: Record<PilotSessionType, Set<PremiumFeature>> = {
  WORKER_DOCUMENT_POC: new Set([
    "PDF_GENERATE",
    "PDF_SIGN",
    "SITE_MANAGER_SIGN",
  ]),
  // 파일럿 2는 급여·문서 워크플로 검증이 목적이며, 구독 플랜과 무관하게 수행한다.
  AGENCY_FULL_FLOW: new Set([
    "PDF_GENERATE",
    "PDF_SIGN",
    "SITE_MANAGER_SIGN",
    "PAYROLL",          // ★회차 스코프로만 — §9-5
    "CONTRACT_ONLINE",
  ]),
};
```

- 6개 값 전부 실존 확인(`lib/planGuard.ts` — `PremiumFeature`는 enum이 아니라 유니온 타입, 총 14종).
- `WORKER_DOCUMENT_POC`은 `AI_VOICE`·`PAYROLL`을 **허용하지 않는다.**
- ★**집합에 없는 기능은 거부한다.** v1.6의 "집합에 없으면 기존 플랜 게이트를 그대로 탄다"는 문장은
  §9-2 의사코드와 모순이었으므로 **삭제·정정**한다(파일럿 배정 = 회차 판정 종결, §9-2).
- ★**`Worker.planType`이나 실재 `Agency`의 구독 플랜을 파일럿 때문에 임시 변경하지 않는다.**
  권한은 회차에서만 파생되어야 하며, 회차가 끝나면 자동으로 원복되어야 한다.
  기관에 활성 파일럿이 있다는 이유만으로 **기관 전체 플랜 게이트를 우회하지 않는다.**

### 9-4. 기간 규칙 — 생성 불변식 + coverage 검증 (★v1.7 이원화)

**(1) 생성 불변식** — 회차 밖 데이터가 생길 경로를 원천 차단한다:

```
SiteAssignment(pilotSessionId 있음) 기간 ⊆ PilotSession 기간
PilotParticipant 설정 기간          ⊆ PilotSession 기간
```

위저드 배정 생성(§6-1)·참여자 생성(§6-2)·수락 트랜잭션(§4-3)에서 검증하고, `ACTIVE` 이후
회차 기간이 불변(§8-2)이므로 사후 이탈도 없다.

**(2) coverage 검증** — 불변식만으로는 **문서 요청 기간**의 안전이 완결되지 않는다.
배정이 8/10 시작인데 사용자가 8/1~8/31 문서를 요청하면, 출근 기록은 10일 이후뿐이어도
**PDF 제목·기간란은 1~31일로 출력**될 수 있다. `TraineePlacement`·`TraineeSupervision`이
배정보다 좁을 수도 있다. 따라서 D-1의 **단일 coverage resolver**(§2)를 유지한다.

★**coverage는 문서 종류별로 다르다.** 5-관계 교집합을 전 문서에 동일 적용하면 출근부가 잘못 막힌다:

```
출근부 (본인 근태 문서):
  authorizedCoverage = requestedPeriod ∩ PilotSession ∩ SiteAssignment

훈련생 종속 문서 (훈련일지·적응지도 일지·종합평가):
  authorizedCoverage = requestedPeriod ∩ PilotSession ∩ SiteAssignment
                     ∩ TraineePlacement ∩ TraineeSupervision
```

★**coverage는 단일 시작~종료일이 아닐 수 있다.** D-1의 supervision은 불연속일 수 있다
(예: 08-01~10 담당, 08-11~19 타 지도원, 08-20~31 재담당). 최소일~최대일로 병합하면
담당하지 않은 중간 기간이 포함되므로 **병합을 금지**하고, resolver는 **구간 배열을 반환**한다:

```ts
coverageRanges: [
  { start: "2026-08-01", end: "2026-08-10" },
  { start: "2026-08-20", end: "2026-08-31" },
]
```

- 불연속 구간의 문서화 정책(구간별 분할 생성 vs 불연속 지원 문서만 단일 생성)은 **D-1 v6에서 확정**한다.
- UI 재요청도 **단일 기간을 전제하지 않는다**(다중 구간 표시·선택).
- ★복잡도의 상한: 불연속은 placement·supervision에서만 발생하므로 **출근부 coverage는 구조상
  항상 단일 구간**이다(회차·배정 모두 단일 구간의 교집합). 일지는 1일 단위라 "어느 구간에든 속함"으로
  자명하고, 실질 복잡도는 **종합평가 2종**에 국한된다. 파일럿 v1 셋업은 참여자당 단일 기간
  supervision만 만들므로 파일럿 데이터가 불연속을 만들지는 않지만, resolver는 운영 공용이므로
  **계약(반환 타입)은 처음부터 배열**로 정의한다.

★**상한 논리의 전제 — 배정 단건 확정 후 계산.** "출근부는 항상 단일 구간"은 `SiteAssignment`가
`startDate`(필수) + `endDate`(nullable) **단일 구간**이고(`schema.prisma:270-271`) `PilotSession`도
단일 구간이므로 성립한다. 단 이는 **resolver가 배정 1건으로 확정된 뒤** 계산할 때만 참이다.
워커는 여러 배정을 가질 수 있고, `resolveDocAssignment`가 활성 2개 이상이면 `409 SELECT_SITE`로
선택을 유도해(`worker/docs/preview:53-55`) 이 전제를 코드가 지키고 있다. resolver는 이 전제를
**계약에 명시**하고, 배정 미확정 상태로 호출되면 거부한다.

★**`endDate`는 nullable이다.** 종료일 미정 배정에서 coverage 상한을 무엇으로 볼지 정의해야 한다.
파일럿 배정은 생성 불변식(배정 ⊆ 회차)으로 사실상 종료일이 필수화되지만, **resolver는 운영 공용**이므로
일반 배정의 `endDate = null`을 다뤄야 한다(열린 상한으로 볼지, 요청 기간 상한으로 절단할지 —
D-1 v6 resolver 계약에서 확정).

#### 9-4-1. serviceStep 경계 분할 (★6차 보정 — 불연속과는 다른 축)

`SiteAssignment.adaptationStartDate`(`schema.prisma:277-279`)는 **단일 배정 안에서 문서 종류를 가른다.**

> 설정 시: 전체 계약기간 중 `[시작~전환 전날]`=지원고용 훈련, `[전환일~종료]`=적응지도. (2026-06-14)

따라서 훈련생 종속 문서를 전부 `∩ SiteAssignment`로 동일 처리하면, 8/1~8/31 배정에 전환일이 8/15일 때
**적응지도 기간인 8/15~8/31까지 훈련일지로 뽑을 수 있다.** 판정식에 serviceStep 경계를 넣는다:

```
훈련일지 · 훈련생 종합평가 (지원고용 훈련):
  ∩ [assignment.startDate, (adaptationStartDate ?? assignment.endDate) - 1일]

적응지도 일지 · 적응지도 종합평가:
  ∩ [adaptationStartDate, assignment.endDate]        // adaptationStartDate가 null이면 공집합
```

- `adaptationStartDate`가 `null`이면 배정 전체가 `serviceStep` 값 그대로의 단건이다(주석 `:277`).
- 단계별 세부 기간이 필요한 경우 `stepStart`/`stepEnd`(`:274-275`)가 우선한다 — 두 필드의
  우선순위는 D-1 v6 resolver 계약에서 확정한다.
- **출근부는 전 구간이므로 이 분할의 영향을 받지 않는다.** 상한 논리(항상 단일 구간)는 그대로 유지된다.
- 이것은 **불연속이 아니라 연속 분할**이다. `coverageRanges` 배열과는 다른 축이며, 두 규칙이 함께 적용된다.

구현 방식(단순화):

- UI가 resolver가 계산한 **실제 허용 구간을 요청**한다.
- 서버는 요청 기간이 `coverageRanges`에 **부합하는지 검증**한다.
- 불일치하면 실제 허용 구간(배열)을 반환하고 재요청하게 한다.
- ★각 PDF payload에 교집합 로직을 **중복 배선하지 않는다.** 검증은 중앙 resolver 한 곳이다.

### 9-5. AGENCY_FULL_FLOW 급여 스코프 (★v1.7 신설 — P0)

**문제 (코드 실측)**: `computePayrollItems(agencyId, yearMonth)`(`lib/payroll/computeRun.ts:66-69`)는
**기관 전체를 계산**한다. 배정·회차 필터가 없다. 이대로 PAYROLL capability를 허용하면:

- 파일럿 급여에 같은 기관의 **정상 Worker가 포함**되고,
- cron 월간 DRAFT(`app/api/cron/daily/route.ts:437-452`)와 수동 실행(`app/api/admin/payroll/runs/route.ts:72`)이
  같은 함수를 쓰므로 **정상 급여에 파일럿 Worker가 포함**된다. 두 경로 모두 문제다.

★**정상 급여와 파일럿 급여는 run 분리가 아니라 계산 단계부터 상호 배제한다.** 파일럿 run을 따로
만들어도 정상 계산이 파일럿 assignment를 배제하지 않으면 같은 Worker가 정상 급여에 다시 포함된다.

**판정 체인**:

```
일반 급여 실행(매니저):
  기존 checkAgencyPlanAccess(agencyId, "PAYROLL") 유지
  → computePayrollItems(agencyId, yearMonth, { excludePilot: true })
    ← pilotSessionId 있는 assignment의 근태를 제외

파일럿 급여 실행(매니저, AGENCY_FULL_FLOW):
  요청에 pilotSessionId 명시
  → session.type === AGENCY_FULL_FLOW
  → session.status === ACTIVE
  → session.agencyId === scope.agencyId
  → PILOT_CAPABILITIES[type].has("PAYROLL")
  → computePayrollItems(agencyId, yearMonth, { pilotSessionId })
    ← 해당 회차 assignment만 계산

cron(:437-452):
  일반과 동일 필터(excludePilot). 파일럿 급여 run은 cron이 만들지 않는다 — 수동 실행 전용.
```

**스키마 — `PayrollRun.pilotSessionId?` + partial unique 쌍**:

현재 `@@unique([agencyId, yearMonth])`(schema.prisma:1234)에 nullable `pilotSessionId`를 그냥 추가하면
Postgres가 NULL을 구분값으로 취급해 **정상 run이 같은 달에 2개 생길 수 있다.** 따라서 Prisma의
`@@unique`를 **제거**하고 raw migration의 partial unique index 두 개로 관리한다:

```sql
-- 정상 급여: 기관·월당 1개
CREATE UNIQUE INDEX payroll_runs_normal_unique
  ON payroll_runs (agency_id, year_month)
  WHERE pilot_session_id IS NULL;

-- 파일럿 급여: 회차·월당 1개
CREATE UNIQUE INDEX payroll_runs_pilot_unique
  ON payroll_runs (pilot_session_id, year_month)
  WHERE pilot_session_id IS NOT NULL;
```

★**`@@unique` 제거로 깨지는 소비처 4곳**(전수 grep) — `prisma.payrollRun.findUnique({ where: { agencyId_yearMonth } })`가
컴파일 불가가 되므로 `findFirst({ where: { agencyId, yearMonth, pilotSessionId: null } })`로 재배선한다:

- `app/api/admin/payroll/runs/route.ts:65` (기존 DRAFT 조회)
- `app/api/admin/payroll/runs/route.ts:97` (upsert 계열)
- `app/api/cron/daily/route.ts:448` (멱등 체크)
- ★`scripts/seed-payslip-demo.mts:99` (**6차 보정 — 최초본 누락**)

★**네 번째는 앱 코드가 아니라 스크립트지만 빌드를 깨뜨린다.** `tsconfig.json`의 `include`에
`"**/*.mts"`가 있고 `exclude`는 `node_modules`·`.claude`뿐이라 `scripts/*.mts`도 타입체크 대상이다.
tsc strict가 실게이트이므로 이 한 줄을 빼면 마이그레이션 커밋에서 **빌드가 실패**한다.

**폐기**: 파일럿 `PayrollRun`(과 cascade되는 `PayrollItem`, schema.prisma:1251)은 회차 폐기 출처에
포함한다(§13-3). 계약·연차 등 파일럿 2가 만든 산출물도 동일하게 `pilotSessionId` 출처로 폐기 대상에 넣는다(§9-6).

### 9-6. AGENCY_FULL_FLOW 계약 스코프 (★6차 보정 — 급여와 같은 축)

§9-3이 `CONTRACT_ONLINE`을 회차 capability로 부여하지만, v1.7 최초본의 실행 구조는 **급여만** 다뤘다.
계약 게이트도 급여와 마찬가지로 **agency 축**이다(코드 실측):

- `app/api/admin/contracts/route.ts:152` — `checkAgencyPlanAccess(scope.agencyId, "CONTRACT_ONLINE")` → **회차 판정 배선 대상**
- `app/api/admin/contract-clauses/route.ts:51` — 동일 게이트이나 ★**배선 대상이 아니다**(아래)

worker 축 의사코드(§9-2)만으로는 이 경로에 회차 판정이 걸리지 않는다.

★**`contract-clauses`는 파일럿 권한 우회 대상에서 제외한다** (7차 보정 — 6차 초안의 오분류).
`AgencyContractClause`(`schema.prisma:958-972`)는 `agencyId`만 갖는 **기관 전체 공용 마스터**다.
회차·배정·현장 스코프가 없다. 파일럿 capability로 이 CRUD를 열면 **같은 기관의 정상 운영 계약에도 영향**을 준다.

- v1: `CONTRACT_ONLINE` 회차 capability는 **실제 계약 발급 경로(`admin/contracts`)에만** 적용한다.
- 파일럿 계약은 **기존 기관 조항을 스냅샷으로 사용**한다(조항을 새로 만들지 않는다).
- 파일럿 전용 조항이 필요해지면 **회차 귀속 모델을 별도 설계**한다(v1 비범위).

★**계약 생성은 진입 경로가 3개다**(`admin/contracts/route.ts:163-175` 실측). 급여와 달리
`assignmentId`를 항상 요구할 수 없다:

| 경로 | assignment 문맥 | 파일럿 판정 근거 |
|---|---|---|
| ① `assignmentId` 지정 | **있음** | `assignment.pilotSessionId` (FK라 모호성 없음) |
| ② `workerId` 지정(이력 검색) | 없음 | ★**명시 `pilotSessionId` 파라미터** + 참여자 검증 |
| ③ 수동 입력(신규 워커 최초 계약) | 없음 | ★**명시 `pilotSessionId` 파라미터** |

②·③에 `assignmentId`를 강제하면 **신규 워커의 최초 계약을 만들 수 없다.**
(③은 배정보다 계약이 먼저 오는 정상 순서다.)

★**②를 `workerId`로 회차를 추론하게 두면 안 된다** (7차 보정 — 6차 초안의 결함).
파일럿에 참여 중인 워커에게 같은 기관이 **정상 계약**을 발행하는 경우, 추론 방식은 그것을 자동으로
파일럿 계약으로 분류한다. `FREE` 기관이라면 플랜상 거부되어야 할 계약이 회차 capability로 **허용되는 역전**까지 생긴다.
→ ②·③은 **운영자가 회차를 명시**해야 하고, `PilotParticipant` 조회는 회차를 **추론하는 용도가 아니라
"그 워커가 그 회차의 참여자가 맞는가"를 검증하는 용도**로만 쓴다.
`pilotSessionId`가 없으면 **파일럿이 아닌 일반 계약**으로 처리한다(기존 플랜 게이트).

**판정 체인**

```
일반 계약:
  기존 checkAgencyPlanAccess(agencyId, "CONTRACT_ONLINE") 유지

파일럿 계약:
  회차 결정 — ① assignment.pilotSessionId          (FK)
             ②③ 요청의 명시 pilotSessionId          (추론 금지)
    없으면 → 일반 계약(기존 플랜 게이트)
    → session.type === AGENCY_FULL_FLOW
    → session.status === ACTIVE
    → session.agencyId === scope.agencyId               (크로스테넌트 차단)
    → ①이면 assignment.pilotSessionId === session.id    (배정 귀속 일치)
    → ②면  PilotParticipant(session, worker) 존재 + CANCELLED 아님   (검증 전용)
    → CONTRACT_ONLINE ∈ PILOT_CAPABILITIES[session.type]
    → 계약 생성 + pilotSessionId 기록
    → ★알림톡 자동 발송 skip (§19)
```

★§9-2의 원칙은 그대로다 — **"기관에 활성 회차가 있다"는 사실만으로 부여하지 않는다.**
세 경로 모두 **워커·배정·참여자 중 하나로 회차 귀속을 확정**한 뒤 판정하고, 파일럿이면 **fail-closed로 종결**한다.
회차 귀속을 확정할 수 없으면 파일럿이 아닌 것으로 보고 기존 플랜 게이트를 태운다(일반 계약).

★`workerId` 경로는 기존 크로스테넌트 IDOR 가드(`workerBelongsToAgency`, `:172`)를 **그대로 유지**한다.
회차 판정이 이 가드를 대체하지 않는다.

**산출물 출처**: 이 경로가 만드는 `EmploymentContract`(`schema.prisma:872`)·`PayContract`(`:1182`)와
파일럿 급여·정산이 만드는 `AnnualLeaveEntry`(`:1045`)에 `pilotSessionId`를 남긴다(§7-2).
출처가 없으면 폐기 시 **어느 계약이 회차 산출물인지 판정할 수 없다.**
`WORKER_DOCUMENT_POC`은 `CONTRACT_ONLINE`을 허용하지 않으므로 이 절의 대상이 아니다.

---

## 10. 외부 전송 차단

### 10-1. 차단 범위 (양 유형 공통, v1)

```
차단:
  - 공단 공식 발송
  - PDF 이메일 발송        (generate route의 sendEmail / toEmail)
  - 일괄 ZIP 이메일 발송
  - 문서 링크 알림톡
  - 문서 데이터 webhook

허용:
  - 브라우저 미리보기
  - 로컬 다운로드
  - ★WorkerInvite 인증번호·가입 링크 SMS
```

★ **초대 SMS는 허용해야 한다.** 이것까지 막으면 신규 Worker 흐름 자체가 성립하지 않는다.
차단 대상은 **PDF·ZIP·공식문서·문서 데이터**의 외부 전송이지, 계정 발급용 인증 메시지가 아니다.

### 10-2. 구현

`app/api/worker/docs/generate/route.ts:47`에 `sendEmail`·`toEmail`이 있고 `:279`에서 실제로
`sendEmailWithPdf()`를 호출한다. 따라서 공단 발송 API만 막는 것으로는 부족하다.

- **서버(1차)**: 파일럿 assignment에 대한 `sendEmail=true` 요청을 **403**으로 거부
- **UI(2차)**: 이메일 발송 옵션을 숨김
- 외부 전송 해제 기능은 **v1에서 구현하지 않는다.** 필요가 생기면
  `externalDispatchApprovedAt` · `externalDispatchApprovedByAdminId`를 가진 별도 감사 액션으로 추가한다.

---

## 11. 문서 흐름 — PDF 다운로드 vs 공식 제출

### 11-1. 왜 제출을 막아야 하는가 (코드 근거)

`lib/docs/requiredSignatures.ts:16-20`은 공식 5종 **전부** `manager: true`를 요구한다
(같은 블록 `:21`의 `CHECKLIST`는 3자 서명 전부 불요 — 공식 5종에 포함되지 않는다).

```
ATTENDANCE_SHEET               worker ✓  companyManager ✓  manager ✓
TRAINING_DAILY_LOG             worker ✓  companyManager ✓  manager ✓
POST_EMPLOY_ADAPT_LOG          worker ✓  companyManager ✗  manager ✓
TRAINEE_COMPREHENSIVE_EVAL     worker ✓  companyManager ✗  manager ✓
ADAPTATION_COMPREHENSIVE_EVAL  worker ✓  companyManager ✗  manager ✓
```

직무지도원이 기존 화면에서 최종 제출을 누르면 `DocumentRun` 생성 → 매니저 알림 → **위탁기관 서명 대기** →
공단 발송으로 이어진다. `WORKER_DOCUMENT_POC`에는 그 매니저가 없으므로 **제출은 구조적으로 완결될 수 없다.**
공단 발송만 막는 것으로 부족하고, **`/api/worker/docs/submit` 단계부터** 차단해야 한다.

### 11-2. 정책 (`WORKER_DOCUMENT_POC`)

| 동작 | 허용 |
|---|---|
| PDF 미리보기·다운로드 | ✅ |
| 사업체 담당자 인퍼슨 서명 | ✅ |
| 직무지도원 서명 | ✅ |
| 위탁기관 담당자명 표시 | ✅ 선택 |
| 직무지도원 최종 제출 | ❌ `submit` 라우트부터 차단 |
| 위탁기관 승인·서명 | ❌ |
| 외부 전송 | ❌ |

**UI**: 파일럿 회차 문서에서는 `[위탁기관에 최종 제출]`을 **`[파일럿 PDF 다운로드]`** 로 대체 표시한다.
서버 차단이 1차 방어, UI 대체가 2차(혼란 방지).

### 11-3. 사업체 담당자 서명은 운영과 동일

사업체 담당자는 **현장에서 직접 이름을 입력하고 서명**하므로 예외 처리가 필요 없다.
기존 `app/api/worker/docs/inperson-sign/route.ts`를 그대로 쓴다. `:63`이 서명자명 미입력 시
`Site.businessContactName` → `"사업체 담당자"` 순으로 폴백하고, 폼에서 직접 입력도 지원한다. **신규 코드 0.**

---

## 12. PDF 담당자 표시명·서명

### 12-1. 서명란 공란 원칙의 정확한 범위

> `WORKER_DOCUMENT_POC`에서 **위탁기관 담당자 서명 이미지**는 항상 공란으로 유지한다.
> **사업체 담당자 인퍼슨 서명에는 적용하지 않는다.**
> `AGENCY_FULL_FLOW`는 실제 `Manager`의 이름과 서명을 기존 공식 흐름대로 사용한다.

v1.1~v1.3의 "서명란 항상 공란"은 이 한정된 표현으로 **대체**한다.

### 12-2. 표시명 우선순위 (유형별)

| 유형 | 이름란 | 서명란 |
|---|---|---|
| `WORKER_DOCUMENT_POC` | `PilotSession.managerDisplayName` → 없으면 **고정 폭 수기 공란** | 항상 공란 |
| `AGENCY_FULL_FLOW` | 실제 서명한 `Manager.displayName` | `Manager` 서명 이미지 |

`AGENCY_FULL_FLOW`에서 회차의 임의 문자열이 실제 서명자명보다 우선하면 안 된다 — 이 유형은 `managerDisplayName`을 **사용하지 않는다.**

### 12-3. 슬롯 매핑 (★v1.7 라인 정정)

문서에는 세 역할 슬롯이 있다. `companyManager`에는 **주입 금지**(기존 이름·인퍼슨 서명 흐름 유지).

| 문서 | 주입 슬롯 | 렌더러 |
|---|---|---|
| 출근부 | `govAgent.name` | `pdfkitRenderer.ts:298` |
| 지원고용 훈련일지 | `govAgent.name` | `:496` |
| 적응지도 일지 | `govAgent.name` | `:466` |
| 훈련생 종합평가 | `agencyAgent.name` | `:623` |
| 적응지도 종합평가 | `agencyAgent.name` | `:623` |

### 12-4. 렌더 규칙

```
표시명 입력됨:   위탁기관 담당자 : 김○○        (서명 또는 인)  ← 서명 공간 유지, 이미지 없음
표시명 미입력:   위탁기관 담당자 : ___________  (서명 또는 인)  ← 고정 폭 수기 공란(밑줄)
```

이름 유무와 무관하게 **서명 공간은 항상 유지**한다.
표시명을 나중에 입력하면 **이후 생성되는 PDF부터** 반영된다.

### 12-5. `signatures()` 개선 — 현재 코드의 결함

`lib/pdf/pdfkitRenderer.ts:106-136`

```ts
const line = `${r.label} : ${name}    ${tail}`;                                  // :120
doc.font("KR").fontSize(11).text(line, left, cy, { width: right - left, align: "right" });  // :121
```

- 이름이 비면 `"위탁기관 담당자 :     (서명 또는 인)"` — **콜론 뒤 공백 4칸**이 전부다. 밑줄도, 고정 폭도 없다.
- **우측정렬 한 줄**이라 이름 영역의 폭이 고정되지 않는다.
- 서명 이미지는 `right - tailW/2` 중앙에 그려지므로(`:128-130`) 이미지 위치 자체는 이름 길이와 무관하다.

**개선**: 한 줄을 **라벨 / 이름영역 / tail** 세 구획으로 분리하고 이름영역을 **최소 40mm 고정**, 빈 값이면 밑줄.

★`:112`의 페이지 가드 `y + rows.length * 24 + 12 > pageBottom(doc)`는 `3792360`(2026-07-20 서명부 분할 수정)의
산물이다. **행 높이를 바꾸면 이 상수도 함께** 바꿔야 하고, 출근부 호출부(`:286` 주석·상위 블록 가드)와 쌍이다.

**영향 범위**: `signatures()`는 **공식문서 5종 전용**이다. 호출부는 4곳(`:297`·`:466`·`:495`·`:623`)뿐이고
계약서 3종(`:799`·`:966`·`:1215`)은 자체 서명란을 그리며, **급여명세서(`:643-780`)는 서명란 자체가 없다**
(v1.6의 "자체 서명란을 그린다"는 표현을 정정 — 말미 `:767-778`은 기관 정보 텍스트 블록뿐).
→ 5종 전용 helper 신설 없이 **기존 함수를 직접 고치는 것이 맞다.**

**회귀 검증**: `scripts/verify-pdf.mts`는 **문서당 1케이스, 총 5케이스**(v1.6의 "문서당 5케이스"를 정정)이고
출근부가 10일치라 **페이지 분할이 일어나지 않아** 서명부 회귀를 잡지 못한다.
**519케이스 기간 스윕**(28~200일 × 시작요일 3종, `scripts/verify-pdf-sweep.mts` 신규 — P0 산출물)으로
개편 전후를 대조한다. baseline은 관측값 그대로 기록하고 통과 기준은 "baseline 대비 악화 없음"이다.

### 12-6. `preview`와 `generate`의 기존 불일치

현재 다운로드본(`worker/docs/generate/route.ts:143,145`)은 `govAgent`/`agencyAgent` 이름을 **`""` 빈칸**으로 두는데,
미리보기(`worker/docs/preview/route.ts:74-75`)는 `adminForSign?.displayName`을 **채운다**(`:59-66` —
서명 이미지는 양쪽 다 없음). **같은 문서가 화면과 파일에서 다르게 나온다.** 운영에 이미 존재하는 불일치이므로,
표시명 배선 시 **양쪽을 같은 우선순위 함수로 통일**한다. 한쪽만 고치면 불일치가 그대로 남는다.

---

## 13. 폐기 정책

### 13-1. 출처 기준 판정

**`createdAt`(생성 시각) 기준 폐기 금지.** 회차 기간 안에 생성됐다는 이유로 지우면 정상 운영 데이터가 포함될 수 있고,
반대로 운영자가 회차 시작 전에 미리 만든 파일럿 데이터는 빠진다.

폐기 대상 = **출처(FK)로만 판정**한다.

- `pilotSessionId`로 명시 연결된 데이터
- `createdByPilotSessionId`로 이 회차가 직접 생성한 자원

| 자원 | 정책 |
|---|---|
| 실재 `Agency` | **삭제 금지** |
| 기존 `Worker` | **삭제 금지** — 파일럿 관계만 제거 |
| 재사용한 기존 `Site` | **삭제 금지** |
| 회차 전용 assignment·placement·supervision·attendance·log·invite | 삭제 가능 |
| ★파일럿 `PayrollRun`(+cascade `PayrollItem`) | 삭제 가능(§9-5) |
| ★계약·연차 산출물 — `EmploymentContract`·`PayContract`·`AnnualLeaveEntry` | 출처 필드로 **식별은 가능**하나 삭제 여부는 **미확정**(아래 ★) |
| 회차가 생성한 `Site`·`Trainee` | 삭제 가능(다른 참조가 없을 때) |
| ★`PilotSession`·`PilotParticipant` | **삭제 금지** — SetNull 정리 후 `purgedAt` 기록(§13-3) |
| 감사 로그 | **보존** — 각 로그에 `pilotSessionId` 기록, 폐기 시 자유 입력 payload의 **PII만 비식별화** |
| PDF 파일·서명 이미지·토큰 | **별도 삭제 대상**(DB 밖 자원 — 폐기 절차에 명시) |

★**서명된 근로계약서의 삭제 가부는 이 문서가 단정하지 않는다.** `EmploymentContract`는
`AGENCY_FULL_FLOW`에서 **실재 기관과 실재 워커 사이에 서명된 실제 계약**이다. 파일럿 산출물이라는
이유로 지우는 것은 §13-2가 신규 `Worker`를 hard delete하지 않기로 한 것과 같은 성격의 문제이며,
근로계약서 보존 의무와도 얽힌다. **파일럿 2 착수 전 별도 판단이 필요한 항목**으로 남긴다
(v1에서는 `WORKER_DOCUMENT_POC`만 실행하므로 계약 산출물 자체가 생기지 않아 착수를 막지 않는다).
`PayContract`·`AnnualLeaveEntry`도 같은 판단에 따른다.

폐기 완료 시 `ENDED → PURGED`, `purgedAt` 기록.

### 13-2. 파일럿 신규 Worker 종료 정책 (★v1.7 — PAUSED로 정정)

초대로 새로 생성된 `Worker`는 **동의 이력·로그인 계정·서명 이미지·개인정보**를 가질 수 있으므로 단순 삭제하면 안 된다.

★`WorkerStatus`에 `INACTIVE`는 **존재하지 않는다**(enum = `ACTIVE`·`RESIGNED`·`PAUSED`, schema.prisma:1525-1529).
로그인은 `status !== "ACTIVE"`면 이미 차단되고(`app/api/worker/auth/login/route.ts:75`), 발급된 세션도
`ensureWorkerActive()`가 매 요청 재검증한다(`app/worker/_lib/session.ts:82-85`).

```
기존 Worker:
  - 계정 유지
  - 파일럿 관계(assignment·supervision·placement)만 제거

파일럿 신규 Worker (Worker.createdByPilotSessionId 존재):
  - 다른 정상 assignment가 있으면        → 계정 유지, 파일럿 관계만 제거
  - 다른 관계가 없으면                    → status = PAUSED + sessionVersion 증가(기존 토큰 즉시 무효화)
  - 이후 다른 정상 배정이 생기면          → 운영자 승인 절차를 거쳐 ACTIVE 복구 가능
  - 보존기간 종료 후                      → 별도 탈퇴·비식별화 정책 적용
  - ★파일럿 폐기 잡에서 즉시 hard delete 금지
```

`Worker.createdByPilotSessionId`(§7-2)가 이 판정의 근거다.

### 13-3. 삭제 순서 (★v1.7 — FK 실측 기준 교정)

```
PilotParticipantTrainee                        ← ★맨 앞 (Trainee를 실 FK로 참조)
  → TraineeLogTask → TraineeLog
  → AttendanceIssueEvent → AttendanceIssue → DailyAttendance
  → SiteSignToken → DocumentVersion → DocumentRun
  → PayrollRun(파일럿分, PayrollItem은 cascade)   ← ★§9-5 산출물
  ── AnnualLeaveEntry · EmploymentContract · PayContract 는 이 순서에 넣지 않는다 ──
     ★삭제 가부 미확정(§19). 폐기 잡은 이 3종을 **보존**하고,
       해당 회차의 PURGED 전환도 **차단**한다(정책 확정 전까지).
     정책 확정 시 삽입 위치는 PayrollRun 다음·TraineeSupervision 앞
     (PayContract.siteId가 Site를 참조하므로 Site보다 반드시 앞).
  → TraineeSupervision → TraineePlacement → Trainee
  → SiteAssignment
  → WorkerInvite                               ← ★Site보다 먼저 (WorkerInvite.siteId가 Site 참조)
  → Site
  → PilotParticipant·PilotSession은 삭제하지 않는다
      (invite·site·createdAssignment FK는 onDelete: SetNull로 자동 정리,
       참여자 purgedAt 기록 → 회차 status = PURGED, purgedAt 기록)
```

- v1.6 순서의 FK 위반 2건을 교정했다: ① `Site → WorkerInvite` 순서 역전(invite가 site를 참조),
  ② 말미 `PilotSession` 삭제(§8-1의 `PURGED`·`purgedAt` 기록과 모순 — 삭제한 행에 기록할 수 없다).
- `PilotParticipant`의 실 FK(§4-2)는 전부 `SetNull`이라 삭제 순서 제약을 만들지 않는다.
  `PilotParticipantTrainee`만 실참조(Restrict)이므로 맨 앞에서 지운다.
- ★계약·연차 3종의 위치 근거(FK 실측): `PayContract`는 `siteId BigInt?`(`schema.prisma:1189`, 관계 선언 `:1215`)로 **`Site`를 참조**하므로
  반드시 `Site`보다 앞이어야 한다. `EmploymentContract`(`:872`)·`AnnualLeaveEntry`(`:1045`)는 `agencyId`·`workerId`만
  참조해 순서 제약이 약하지만, 같은 산출물군이므로 함께 배치한다. 셋 다 `Trainee`·`Placement`를 참조하지 않는다.

★**`TraineeLog.attendanceId`는 `onDelete: Cascade`**(`prisma/schema.prisma:469`)다.
`DailyAttendance`를 지우면 **DB가 일지를 조용히 함께 지운다.** `AttendanceIssue.dailyAttendanceId`도 동일(`:1328`).
폐기 잡은 dry-run을 기본으로 하고, **훈련생 개인정보 건수를 별도 항목으로 출력**한다.

---

## 14. 유지되는 기존 결정

- 파일럿 1 데이터 = 격리 후 검증만, 종료 후 폐기 (판정 = `pilotSessionId`)
- 참여자 = 아는 테스터 소수
- 파일럿 2 급여 = 시급제 (★회차 스코프 — §9-5)
- 셀프 가입(OTP) 폐쇄 → `WorkerInvite` **확장 재사용**(v1.4 정정)
- 훈련생 기간 겹침 placement 거부 불변식 — 파일럿 포함 전면 적용
- 서명란 공란 원칙 — §12-1의 한정 표현으로 대체(v1.4 정정)
- 회차 단위 `managerDisplayName`, 후입력 가능(`ENDED` 이후 고정)
- 문서 단위 담당자명 오버라이드는 추가하지 않음 (YAGNI 확정)
- 근무시간 기준은 **운영과 동일**. 파일럿 전용 규칙을 만들지 않는다(§15-1)

---

## 15. 부록 — 코드 실측 근거

### 15-1. 근무형태 기준 (용어 혼선 정리)

"오전4·오후4·전일8"은 `lib/workSchedule.ts:20-25`의 라벨(`WORK_TYPE_LABELS`)과 **정확히 일치**한다.
메모리의 "AM/PM 5.5h"는 **출근부 측정시간**(출근지도 0.5h + 근무 4h + 휴게 0.5h + 퇴근지도 0.5h)이고,
"4시간"은 훈련 근무시간 라벨이다. **충돌이 아니라 같은 것의 두 표현이다.**

| 근무형태 | 출퇴근지도 포함(기본) | 미포함(예외) |
|---|---|---|
| `AM` 오전 4시간 | 08:30~14:00 (5.5h) | 09:00~13:30 (4.5h) |
| `PM` 오후 4시간 | 12:30~18:00 (5.5h) | 13:00~17:30 (4.5h) |
| `FULL_DAY` 전일 8시간 | 09:00~18:00 (강제 미포함) | 동일 |

파일럿도 `computeWorkTimes()`를 그대로 쓴다. 이 파일은 단일 출처이며 파일럿이 분기를 만들지 않는다.

### 15-2. 선행 D-1 결정 게이트 — ★2건 (6차 보정)

**게이트 ① — 1:多 판정 기준**

출근부의 1:1 / 1:多 표기는 **그 날짜에 그 현장에 재적한 훈련생 수**로 판정한다
(`lib/docs/attendanceSheetPayload.ts` — 2026-06-18 사용자 확정 절대불변 규칙).
`TraineeSupervision`이 도입되면 담당 관계가 명시되므로, D-1 v6에서 **1:多 판정의 기준을
"현장 재적 수"로 유지할지 "담당 훈련생 수"로 바꿀지 확정**해야 한다. 이 판정은 **급여에 영향**을 준다.

**게이트 ② — 불연속 coverage의 문서화 정책**

supervision이 불연속일 때(§9-4) 문서를 **구간별로 분할 생성**할지, **불연속을 지원하는 문서만 단일 생성**할지
D-1 v6에서 확정한다. 실질 대상은 **종합평가 2종**이다(출근부는 구조상 단일 구간, 일지는 1일 단위라 자명).

두 건 모두 **파일럿 자체의 열린 질문이 아니라 선행 D-1의 결정 게이트**다. 파일럿 설계는 어느 쪽으로
확정되어도 변하지 않는다(판정·resolver 모두 단일 출처를 그대로 쓴다).

★참고 — **게이트가 아닌 항목**: §9-4-1의 `adaptationStartDate` serviceStep 경계 분할은 결정 사항이 아니라
**이미 코드에 정의된 규칙**(`schema.prisma:278`)이므로 resolver 계약에 반영만 하면 된다.
`endDate = null` 처리와 `stepStart`/`stepEnd` 우선순위는 resolver **계약 세부**로 D-1 v6에서 함께 확정한다.

### 15-3. 자동화 하드블록 (데이터 생성 **전에** 적용)

| 위치 | 위험 |
|---|---|
| `lib/leave/runAccrual.ts:80` | **연차 자동 적립. `{isActive:true}`만 보고 전 기관 순회 — 위험 최대** |
| ★위 하드블록의 범위 | **cron 자동 적립 한정**이다. 급여 실행이 만드는 `AnnualLeaveEntry`(`admin/payroll/runs/route.ts:118` · `runs/[runId]/route.ts:180`)는 **별개 경로**이며, `AGENCY_FULL_FLOW`는 급여를 허용하므로 이 경로로 연차 행이 생긴다. 그래서 `AnnualLeaveEntry.pilotSessionId?`가 필요하다(§7-2). 모순이 아니다 |
| `app/api/cron/daily/route.ts:437` | 급여 DRAFT 자동 생성 — ★파일럿 필터는 §9-5(excludePilot) |
| `app/api/payments/charge/route.ts:59` | 결제 대상 조회. 심층방어 — `tossBillingKey`·`tossCustomerKey` 조건으로 빌링키 없는 기관은 구조적으로 청구 불가 |

### 15-4. SiteAssignment 쓰기 경로 매트릭스 (★v1.7 — "8경로 하드블록" 대체)

전수조사는 **두 축을 병행**한다. ① `lib/assignmentLock.ts` 호출부(**주요 앵커이지 단일 관문이 아니다**)
② `siteAssignment.create`/`upsert`/`updateMany` 직접 검색.

실측: 순수 **생성**(create)은 앱 코드 4곳뿐이고, 나머지는 상태 승격·속성 변경(updateMany)이다.
경로 개수가 아니라 **분류·판정표**가 구현·테스트 기준이다. 각 경로를 다음 4종 중 하나로 판정한다:

```
A. 허용                          — 파일럿 assignment에도 그대로 동작해야 하는 경로
B. 파일럿 전용 경로에서만 허용    — 일반 API로는 불가, 파일럿 관리 메뉴로만
C. pilotSessionId 보존 조건 허용  — 동작하되 pilotSessionId를 지우거나 바꾸면 안 됨
D. 파일럿 assignment면 차단       — 403
```

**인벤토리 (실측 전수):**

| 분류 | 경로 | 락 |
|---|---|---|
| 생성 | `admin/assignments:353` (락 `:316`·정원 `:338`) | ✅ |
| 생성 | `admin/recruit-applications/[id]:142` (락 `:166-168`) | ✅ |
| 생성 | `worker/recruit/offers:112` (락 `:135-136`) | ✅ |
| 생성 | `worker/invite/[id]:135` — ★락·정원 없음(의도적 예외, §5-4) | ❌ |
| 생성(신규) | ★파일럿 수락 분기·위저드 — 9·10번째, 락+정원 적용(§5-4) | ✅ |
| 승격·변경 | `admin/assignments/[id]:126` (PATCH, 락) | ✅ |
| 승격 | `admin/assignment-requests:184` (락) + 락 밖 `:18`·`:127`·`:146` | 혼재 |
| 승격 | `worker/assignment/respond:106` (락) + 락 밖 `:69`·`:77` | 혼재 |
| 승격 | `worker/contracts:219` (락) + 락 밖 `:362`·`:368` | 혼재 |
| 연결 | `worker/assignment/connect:55`·`:66` | ❌ |
| 근무정책 | `admin/sites/[id]/attendance-exempt:37` | ❌ |
| 자동종료 | `cron/daily:539` | ❌ |
| 기타 | `site/basepoint/propose:33`·`:37` | ❌ |

기본값은 **D(차단)**로 두고, A~C 예외는 구현 단계에서 경로별로 명시 판정·테스트한다.
(참고: `withWorkersAssignmentLock`(assignmentLock.ts:32)은 호출부 0건 — dead export.
계약발행·연차 락 호출부는 배정 생성이 아니므로 매트릭스 밖.)

★**일반화된 교훈**: 이 리포는 chokepoint 단일화를 여러 번 했지만(`checkSiteCapacity`·`ownedAttendanceWhere`·`assignmentLock`)
**의도적 예외가 주석으로만 남은 경우**가 있다. 관문 호출부 훑기는 그런 예외를 구조적으로 놓친다.
**모델 단위 쓰기 구문 grep을 항상 병행**한다.

### 15-5. 조회 격리 대상

`admin/system/stats:20`(전체 기관 수) · `:24`(유료 기관 수 — **조건부 count**) ·
`admin/system/usage:31`(★전역성은 `:23` groupBy에 있음) · `admin/system/billing:12` · `admin/system/agencies:14` ·
`admin/subscription:16`(★매니저 세션은 자기 기관 격리, admin만 전역) · `admin/sites/options:17`(동일)

`Agency.findMany/count`뿐 아니라 **`{isActive:true}` 기관 순회와 agencyId 없는 전역 count**를 전수 조사한다.

---

## 16. 구현 순서 (★선행관계·v1.7 항목 반영)

`TraineeSupervision`이 **현재 저장소에 없다.** 따라서 `TraineeSupervision.pilotSessionId?`를
첫 파일럿 스키마 커밋에 단독으로 추가할 수 없다. D-1이 **반드시 선행**한다.

```
1. D-1 통합 설계 v6 확정            ← 착수 지점. 3-관계 교집합 + 단일 coverage resolver
                                       · 문서 종류별 판정식(출근부 3관계 / 훈련생 종속 5관계)
                                       · coverageRanges 배열 계약(병합 금지)
                                       · ★serviceStep 경계 분할(adaptationStartDate·stepStart/End 우선순위)
                                       · ★endDate=null 상한 처리 · 배정 단건 확정 전제
                                       + 파일럿 회차 연계
                                       + ★결정 게이트 2건 확정(§15-2 — 1:多 기준 · 불연속 문서화 정책)
2. TraineeSupervision 모델·불변식 + coverage resolver 구현
3. D-1 전용 마이그레이션 + 테스트
   ────────────────────────────────  마이그레이션 경계(롤백 범위 분리)
4. PilotSession · PilotParticipant · PilotParticipantTrainee · 파일럿 FK 일괄
   + PayrollRun.pilotSessionId + partial unique 쌍(raw migration, @@unique 제거·소비처 ★4곳 재배선 — §9-5)
   + 계약·연차 산출물 출처 FK(EmploymentContract · PayContract · AnnualLeaveEntry — §7-2)
5. WorkerInvite 확장 (XOR CHECK 포함)
6. 파일럿 판정 유틸 (단일 판정식, fail-closed) + coverage 검증 배선
7. 운영자 초대 API + 초대 수락 분기 (READY 한정 · 락+정원 · 멱등 · 수락 시점 검증)
8. Capability 게이트 (worker 축 + agency 축 이원) + 외부 전송 차단
9. submit 차단
10. 급여 스코프 (computePayrollItems 필터 · cron excludePilot · 파일럿 run 수동 경로 — §9-5)
10-1. ★계약 스코프 — admin/contracts:152 **한 곳만** 회차 판정 배선 (§9-6)
      · contract-clauses:51은 기관 공용 마스터라 배선 제외
      · 파일럿 2 전용이므로 v1(WORKER_DOCUMENT_POC)에서는 실행하지 않는다 — §19
11. SiteAssignment 쓰기 경로 매트릭스 판정·차단 구현 (§15-4)
12. 파일럿 관리 메뉴 (회차 CRUD · 상태 전이 · 셋업 위저드 2경로)
13. 근무일 확정 화면 (3-구조 — §6-3)
14. PDF 슬롯·수기 공란 + preview/generate 통일
15. 폐기 잡
```

★ D-1과 파일럿 스키마를 **한 마이그레이션에 섞지 않는다.**
도메인 전담 관계와 파일럿 운영 메타데이터는 **장애·롤백 범위가 다르다.**

---

## 17. 구현 항목

### 스키마
- [ ] `TraineeSupervision` (D-1 선행)
- [ ] `PilotSession` (type, status 6종, 타임스탬프, 불변 필드 규칙, 역방향 관계 일괄)
- [ ] `PilotParticipant` (실 FK + `inviteId @unique` + `createdAssignmentId @unique` + `@@unique([pilotSessionId, workerId])` + `purgedAt`)
- [ ] `PilotParticipantTrainee` 조인 테이블
- [ ] `WorkerInvite`: `createdByManagerId` 선택화 + `createdByAdminId?` + `pilotSessionId?` + XOR CHECK
- [ ] `pilotSessionId?`: `SiteAssignment` · `TraineePlacement` · `TraineeSupervision` · `WorkerInvite` · `PayrollRun`
- [ ] ★`pilotSessionId?` (AGENCY_FULL_FLOW 산출물): `EmploymentContract`(:872) · `PayContract`(:1182) · `AnnualLeaveEntry`(:1045) — 폐기 출처 판정에 필수(§7-2·§9-6)
- [ ] `createdByPilotSessionId?`: `Site` · `Trainee` · `Worker`
- [ ] ★역방향 관계 **쌍으로** 선언 — `Admin.createdWorkerInvites WorkerInvite[]`(v1.7 최초본 누락, 없으면 `prisma validate` 실패) · `PayrollRun.pilotSession PilotSession?` 등 참여 FK 상대 모델 전부(§3·§7-2)
- [ ] `PayrollRun` `@@unique` 제거 + partial unique 쌍 raw migration + 소비처 ★**4곳** `findFirst` 재배선 — `payroll/runs:65`·`:97`·`cron/daily:448`·**`scripts/seed-payslip-demo.mts:99`**(tsc 게이트, §9-5)
- [ ] `ACTIVE` 전역 1개(양 유형 합산): advisory lock + partial unique index
- [ ] 감사 로그에 `pilotSessionId` 기록

### 서버
- [ ] 파일럿 판정 유틸 — `pilotSessionId` + 기간 겹침 **단일 판정식, fail-closed**(§9-2)
- [ ] capability 판정 assignment 문맥 필수 — 서명 경로 포함 `assignmentId` + 본인 소유 검증, 기관 회차 존재만으로 부여 금지(§9-2)
- [ ] coverage 검증 — 문서 종류별 판정식(출근부/훈련생 종속) · `coverageRanges` 배열 계약 · UI 다중 구간 재요청 · 불일치 시 허용 구간 반환(§9-4)
- [ ] ★serviceStep 경계 분할 — 훈련일지/훈련생 종합평가는 `[시작~전환 전날]`, 적응지도 2종은 `[전환일~종료]`. `adaptationStartDate=null`이면 배정 전체가 단건(§9-4-1)
- [ ] ★resolver 계약 — `endDate=null` 상한 처리 · 배정 단건 확정 후 호출(미확정 시 거부) · `stepStart`/`stepEnd` 우선순위(§9-4)
- [ ] 생성 불변식 — 배정·참여자 설정 기간 ⊆ 회차 기간(§9-4)
- [ ] `POST /api/admin/pilots/[sessionId]/invites` — 운영자 전용(일반 초대 API 비확장)
- [ ] 초대 수락 `pilotSessionId` 분기 — READY 한정 · `inviteId` 역참조 · 참여자 잠금 · 락+정원 · 단일 트랜잭션 · 멱등 · 수락 시점 훈련생/placement 검증(§4-3)
- [ ] 참여자 `CANCELLED` 처리 + 연결 초대 즉시 무효화(§8-1·§5-2)
- [ ] 운영자 훈련생 생성 경로 (현재 매니저 전용 — §6-3)
- [ ] Capability 게이트 — worker 축(배정 확정 → 회차 판정 → 플랜) + agency 축(§9-5) 이원 배선
- [ ] `/api/worker/docs/submit` — `WORKER_DOCUMENT_POC` 차단
- [ ] 위탁기관 승인·서명 경로 차단(동일 유형)
- [ ] 외부 전송 차단 — `sendEmail=true` 403, ZIP·알림톡·webhook 포함. **초대 SMS는 예외**
- [ ] 급여 — 일반 경로 `excludePilot` 필터(수동+cron) · 파일럿 run 수동 전용 경로 · `WORKER_DOCUMENT_POC` 데이터 전면 제외(§9-5)
- [ ] ★계약 (**파일럿 2 전용 — v1 미실행**) — `admin/contracts:152`에만 회차 판정 배선. **경로 3개별 회차 귀속 확정**(②③은 명시 `pilotSessionId` 필수·추론 금지) 후 fail-closed, `workerBelongsToAgency` 가드 유지, 산출물 `pilotSessionId` 기록, **알림톡 skip**. `contract-clauses`는 **배선 제외**(기관 공용 마스터 — §9-6)
- [ ] 회차 필드 불변성 가드 (상태별 수정 범위)
- [ ] 자동화 하드블록 3곳 (§15-3) — **데이터 생성 전에**
- [ ] SiteAssignment 쓰기 경로 매트릭스 — 경로별 A~D 판정·차단·테스트(§15-4, 기본값 D)
- [ ] 폐기 잡 — 출처 기준 + 보존 정책 + 신규 Worker `PAUSED`+`sessionVersion` + PII 비식별화 + PDF/서명/토큰 삭제 + 파일럿 PayrollRun 삭제 + dry-run 기본(§13)

### PDF
- [ ] 유형별 이름·서명 분기 (§12-2)
- [ ] 슬롯 매핑 (§12-3), `companyManager` **비침범 테스트**
- [ ] `signatures()` 고정 폭 이름영역 + 수기 공란 + 페이지 가드 상수 동반 갱신
- [ ] `preview`/`generate` 담당자명 우선순위 **통일** (§12-6)
- [ ] 519케이스 기간 스윕으로 개편 전후 대조 (baseline 관측값 그대로, "악화 없음" 기준)

### 운영자 UI
- [ ] 파일럿 관리 메뉴 — 회차 CRUD, 상태 전이(READY→ACTIVE 조건 표시), `managerDisplayName` 수정, 참여자 CANCELLED 처리
- [ ] 셋업 위저드 — **기존 Worker 경로 / 신규 Worker 경로 분리**

### 직무지도원 UI
- [ ] 근무일 확정 화면 — 3-구조(오늘까지 생성·수정·삭제 / 미래 예정 표시 / 도래 후 생성) + delta PATCH + 원자적 CAS + `TraineeLog` cascade 검사
- [ ] `[최종 제출]` → `[파일럿 PDF 다운로드]` 대체 표시

---

## 18. 승인 게이트

- 이 문서가 확정되어도 코드·schema·migration·seed·test 작업은 시작하지 않는다.
- **착수 지점은 파일럿이 아니라 `D-1 통합 설계 v6` 확정**이다(§16).
- 각 단계 완료 시 다음 단계 착수 전에 결과를 보고한다.
- production migration·배포·파일럿 공개는 **별도 승인** 대상이다.

---

## 19. AGENCY_FULL_FLOW 착수 전 게이트 (★7차 — 봉인)

★**이 절의 항목은 v1에서 구현하지 않는다.** `WORKER_DOCUMENT_POC`만 실행하므로 계약·급여·연차 산출물이
애초에 생기지 않는다. **파일럿 2 착수를 결정할 때 이 절만 한 번에 열어 확정**하고, 그전에는
개별 보정으로 문서를 다시 열지 않는다. (v1.7이 6·7차에 걸쳐 재개정된 주된 원인이
"안 만들 기능의 개별 검토"였다.)

### 19-1. 미확정 결정

| # | 항목 | 쟁점 |
|---|---|---|
| 1 | **산출물 보존/삭제 정책** | `EmploymentContract`는 실재 기관·워커 간 **서명된 실제 근로계약서**다. 파일럿 산출물이라는 이유로 지우는 것은 §13-2가 신규 `Worker`를 hard delete하지 않기로 한 것과 같은 성격이며, 근로계약서 보존 의무와 얽힌다. `PayContract`·`AnnualLeaveEntry`도 동일 판단을 따른다 |

**확정 전까지의 안전 동작**(§13-3): 폐기 잡은 이 3종을 **보존**하고, 해당 회차의 **`PURGED` 전환을 차단**한다.

### 19-2. 확정 시 함께 처리할 실측 항목

| 항목 | 코드 근거 | 처리 |
|---|---|---|
| 계약 생성 **알림톡 자동 발송** | `admin/contracts/route.ts:436` `sendKakaoAlimtalk(contractUrl)` · `:440` `tokenSentAt` 기록 | §10의 "문서 링크 알림톡 차단"과 정면 충돌. 파일럿 계약은 **발송 skip + `tokenSentAt` 미기록**. 직무지도원은 `/worker/contracts`에서 대기 계약과 `signToken`을 조회해 **앱 안에서 서명**하므로 동선이 끊기지 않는다. 응답의 `contractUrl`(`:451`)은 **운영자 화면 표시 전용**, 외부 전송 금지 |
| **연차 생성 경로 5곳** | `runAccrual.ts`(cron) · `admin/payroll/runs:118` · `runs/[runId]:180` · `admin/leave/[workerId]:139`·`:189`(수동 등록) · `admin/leave/requests/[id]:96`(신청 승인) | §15-3이 명시한 것은 cron·급여 2계열뿐이다. 파일럿 2 워커가 연차를 **신청하고 실재 매니저가 승인**하면 출처 없는 행이 생긴다. 5곳 전부에 `pilotSessionId` 기록 또는 차단을 배선 |
| `contract-clauses` | `schema.prisma:958-972` — `agencyId`만, 기관 공용 마스터 | v1 결정 유지(**배선 제외**). 파일럿 전용 조항이 필요하면 회차 귀속 모델을 별도 설계 |
