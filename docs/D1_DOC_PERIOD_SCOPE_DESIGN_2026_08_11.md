# D-1 통합 설계 v5 — 훈련생 재적·전담 직무지도원·월별 마감서류

작성일 2026-08-11 · 상태 **설계 검토** · 구현 **미착수** · 마이그레이션 **필요**
원칙: **구현 승인 전 코드·스키마·migration·seed·테스트·패키지 변경 및 commit/push/배포 금지**

> **최종 결론**
> 훈련생은 누구의 소유도 아니다. 특정 기간 **사업체에 재적**하며 그 기간에는 **한 명의 직무지도원이 전담**한다.
> **한 직무지도원이 여러 훈련생을 동시에 담당하는 것은 정상이며, 바로 그 경우가 1:多다.**
> 문서 정체성은 coverage 종료일이 아니라 **reportingMonth + assignment/supervision 관계**로 결정된다.

> **개정 이력** — v1(siteId=기관스코프) 폐기 · v2(기관 소유) 폐기 · v3(⊆ 포함규칙) 수정 ·
> v4(coverageRange 도입) → **v5**: 1:多 전담 기준 확정, DocumentRun 멱등키 확정,
> 불연속 supervision, docType 번역 경계 명시, 표현 정정.

---

## 1. 도메인 정의 (확정)

**1-1 훈련생** — 공단 등록 인원. **위탁기관·사업체·직무지도원·운영자 누구의 소유도 아니다.**
사업체와 직무지도원은 **특정 기간의 업무 관계**만 갖는다.

**1-2 사업체 재적(`TraineePlacement`)**
- 한 훈련생은 같은 시점에 **하나의 사업체에만** 재적
- 동일 훈련생의 placement 기간은 **사업체가 같더라도 중복 불가**
- 이동 시 기존 종료 → 신규 생성
- 과거 재적은 `currentSiteId`가 아니라 **placement로 판정**

**1-3 직무지도원 전담(`TraineeSupervision`)**
- 한 훈련생은 같은 시점에 **정확히 한 명**에게만 배정
- 여러 직무지도원의 **공동 관리 불가**
- **동일 훈련생**의 supervision 기간 중복 불가
- ★**한 직무지도원은 여러 훈련생을 동시에 담당할 수 있다(정상). 이것이 1:多의 근거다.**

> ⚠️ **금지 대상은 "같은 훈련생에 대한 supervision 중복"이다.**
> "직무지도원의 supervision 기간 중복 금지"라는 표현을 쓰지 않는다(v4 표현 정정).

같은 사업체에 여러 직무지도원이 근무할 수 있으나 **각자 자신에게 배정된 훈련생만** 조회·관리한다.

---

## 2. 신규 모델 `TraineeSupervision`

```prisma
model TraineeSupervision {
  id           BigInt    @id @default(autoincrement())
  traineeId    BigInt    @map("trainee_id")
  placementId  BigInt    @map("placement_id")
  assignmentId BigInt    @map("assignment_id")
  startDate    DateTime  @map("start_date")
  endDate      DateTime? @map("end_date")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt      @map("updated_at")

  trainee    Trainee          @relation(fields: [traineeId],    references: [id])
  placement  TraineePlacement @relation(fields: [placementId],  references: [id])
  assignment SiteAssignment   @relation(fields: [assignmentId], references: [id])

  @@index([traineeId, startDate, endDate])
  @@index([assignmentId, startDate, endDate])
  @@index([placementId])
  @@map("trainee_supervisions")
}
```

중복 저장 금지: `workerId`=`assignment.workerId` · `siteId`=`placement.siteId`/`assignment.siteId` · `agencyId`=`assignment.agencyId`.
**삭제를 기본 동작으로 쓰지 않는다** — 종료일 기록으로 이력 보존.
명칭 충돌 없음(리포 전체 `supervision` 식별자 0건).

---

## 3. 관계 불변식

생성 시 전부 검증: **3-1** `supervision.traineeId == placement.traineeId` ·
**3-2** `assignment.siteId == placement.siteId` ·
**3-3 기간 포함** — supervision ⊆ placement **그리고** ⊆ assignment
```
supervisionStart >= placementStart   supervisionEnd <= placementEnd
supervisionStart >= assignmentStart  supervisionEnd <= effectiveAssignmentEnd
```
열린 기간(null)은 무기한으로 취급하되 **ENDED인데 종료 근거 없는 assignment는 fail-closed**.

**3-4 중복 금지**
| 대상 | 판정 |
|---|---|
| 동일 훈련생의 placement 기간 중복 | **금지** |
| 동일 훈련생의 supervision 기간 중복 | **금지** |
| 한 직무지도원이 **서로 다른 훈련생**을 동시 담당 | **허용**(1:多 근거) |
| 한 사업체에 여러 직무지도원 동시 근무 | **허용** |

애플리케이션 사전 검사만으로 충분하다고 보지 않는다 → advisory lock + 트랜잭션.
DB exclusion constraint는 후속 심층방어(1차 필수조건 아님 — Prisma drift·운영 복잡성).

---

## 4. 날짜·기간

모든 업무 날짜는 **KST 날짜 단위**, 경계는 **포함형**.

**담당자 변경일 D** → 기존 supervision 종료 `D-1`, 신규 시작 `D` (같은 날 중복 금지).
**사업체 이동일**도 동일.

**4-1 assignment 유효 종료일**
```
effectiveAssignmentEnd =
  endDate·endedAt 모두 존재 → 더 이른 날짜
  endDate만                → endDate
  endedAt만                → endedAt
  둘 다 없고 ENDED         → 비정상, fail-closed
  둘 다 없고 활성          → 열린 기간
```
**수동/cron 종료 시 `endDate`를 덮어쓰지 않는다.** `endDate`(예정) 보존 + `endedAt`(실제)만 기록 + 읽기 시 계산.
근거: `cron/daily:534`가 `endDate < 오늘`로 자동종료를 판정하고, `dashboard:174` "곧 종료" 카운트,
`attendances:121,229`·`assignments/[id]:97,130`이 표시·수정에 사용한다.

---

## 5. 월 단위 문서

문서는 **월 단위 제출**. 월 중 시작이어도 그 달 말 기준으로 제출한다.

| 개념 | 의미 | 예 |
|---|---|---|
| `reportingMonth` | 제출 귀속 월 | `2026-07` (DB는 월 첫날 Date 저장 우선 검토. 문자열이면 `YYYY-MM` 왕복검증 필수) |
| `requestedMonthRange` | 달력상 전체 범위 | `07-01 ~ 07-31` |
| `coverageRange` | **실제 포함 기간** | `07-10 ~ 07-31` |

```
훈련생 종속: coverageRange = requestedMonthRange ∩ assignment ∩ placement ∩ supervision
출근부      : coverageRange = requestedMonthRange ∩ assignment
```
교집합이 비면 생성 불가. 축소 시 **UI에 반드시 표시**:
*"2026년 7월 제출분이며 실제 작성 기간은 2026-07-10부터 2026-07-31까지입니다."*

**resolver가 산출한 `coverageStart`/`coverageEnd`를 모든 하위 쿼리·payload·PDF·서명 토큰에 명시 전달한다.**
호출부가 원래 요청 월 범위를 다시 쓰는 일이 없어야 한다.

---

## 6. 불연속 supervision

PAUSED 후 같은 달 복귀·담당자 교체 등으로 coverage가 불연속일 수 있다.
```
supervision 1: 07-01~07-10 / 중단 07-11~07-15 / supervision 2: 07-16~07-31
```
단일 `coverageStart~coverageEnd`로 표현하면 **중단 기간이 포함되므로 허용하지 않는다.**

**확정**: 복귀 시 새 supervision 생성 · 훈련생 종속 `DocumentRun`은 **supervision 단위**로 생성 ·
같은 `reportingMonth`에 supervision 2개면 **문서도 2건** · 각 문서에는 해당 supervision과 겹치는 **연속 기간만** 포함 ·
**중단 기간의 로그·평가가 문서에 포함되면 안 된다.** 담당자 변경도 동일 원칙.

---

## 7. 문서 종류 — ★docType 번역 경계

**API/PDF docType과 DB `DocumentType` enum은 서로 다른 어휘이며, 이는 기존의 의도된 경계다.**
`lib/docs/docTypeMap.ts`가 양방향 변환의 **단일 출처**다. 신규 결함이 아니다.

**훈련생 종속 문서**
| API·PDF docType | DB `DocumentType` |
|---|---|
| `TRAINING_DAILY_LOG` | `TRAINING_DAILY_LOG` |
| `TRAINEE_FINAL_EVAL` | `TRAINEE_COMPREHENSIVE_EVAL` |
| `ADAPTATION_DAILY_LOG` | `POST_EMPLOY_ADAPT_LOG` |
| `ADAPTATION_FINAL_EVAL` | `ADAPTATION_COMPREHENSIVE_EVAL` |

**`ATTENDANCE_SHEET`**(양쪽 동일) — 직무지도원 출근부. **supervision을 문서 접근의 필수조건으로 요구하지 않는다.**
단 1:1/1:多 표기는 **날짜별 supervision 집계**를 사용한다(§8-3).

**`CHECKLIST`** — DB enum에만 존재하고 `docTypeMap`에 매핑이 없다(PDF 렌더 경로 없음).
`traineeId`와 함께 생성되는 흔적도 없다. → **의미 확인 전까지 훈련생 종속으로 추론하지 않으며, D-1 범위에서 제외**한다.

**계층 사용 규칙 (구현 시 준수)**
- 요청 검증·payload 분기·PDF 렌더링 → **API/PDF docType**
- `DocumentRun` 저장·조회·서명정책·DB index → **Prisma `DocumentType`**
- 경계에서만 `PDF_TO_PRISMA_DOCTYPE` / `PRISMA_TO_PDF_DOCTYPE` 사용
- **DB enum을 API 이름으로 개명하거나 API 문자열을 DB enum에 추가하지 않는다**
- **migration의 partial unique index에는 DB enum 명칭 사용**
- `TRAINEE_DOC_TYPES`(`traineeSiteGuard.ts:46`)는 **API/PDF 문자열 배열**이므로 DB enum과 직접 비교 금지

---

## 8. 1:1 / 1:多 급여 정책 (확정)

**8-1 규칙** — 1:多는 **사업체 전체 재적 인원수가 아니다.**
> 해당 직무지도원이 해당 날짜에 유효하게 담당하는 훈련생이 **2명 이상**일 때 1:多.

| 상황 | 결과 |
|---|---|
| A가 T1, B가 T2 담당(같은 사업체) | A 1:1, B 1:1 |
| A가 T1·T2 담당 | **A 1:多** |
| 사업체 훈련생 5명이나 A 담당 1명 | A 1:1 |
| A가 S1에서 1명, S2에서 1명을 다른 시간에 담당 | **각 assignment 1:1** |

날짜별 집계 조건: `supervision.assignmentId == attendance.assignmentId` ∧
`supervision.startDate <= workDate` ∧ (`endDate IS NULL` ∨ `endDate >= workDate`) ∧
placement·assignment도 `workDate`에 유효. **사업체 전체 placement 수를 세지 않는다.**

**8-2 급여 유형별** — 계산 구조는 유지하고 **"훈련생 수를 가져오는 근거"만** supervision 기준으로 교체.

현재 판정 지점(실측, `lib/payroll/computeRun.ts`):
| 위치 | 현재 근거 | 용도 |
|---|---|---|
| `:335` | `traineeCountOn(siteId, workDate) >= 2` | **HOURLY** 시간 분해(1:1/1:多) |
| `:352` | 동일 | **DAILY** 일자별 판정 |
| `:254` `maxSiteCount` | 월 전체 최대 재적 수 | **DAILY `:360` 표시단가 · MONTHLY `:364` 단가** |
| `:540` | `hourlyRate2Plus ?? rate1*1.2` | payLines "2인이상지원" |

- **HOURLY** — 출근 기록의 assignment·workDate 기준 담당 수. 1명 이하 1:1 시급 / 2명 이상 1:多 시급
- **DAILY** — 같은 근무일의 attendance별 담당 수. 어느 attendance에서든 2명 이상이면 기존 일급 정책대로 1:多 일급.
  **서로 다른 사업체에서 각각 한 명을 순차 지도한 것만으로 1:多가 되면 안 된다** → 현재 "같은 날 여러 배정" 의미론과의 충돌 여부를 테스트로 고정
- **MONTHLY** — ★현재는 `maxSiteCount >= 2`, 즉 **월 중 한 번이라도 2명이면 월 전체가 `rate2`**다.
  이 **단가 선택 방식 자체는 변경하지 않고**, 입력만 "월 최대 재적 수" → "확정 근무일의 assignment별 supervision 수의 월 최대"로 교체한다.

**8-3 출근부** — 급여와 출근부가 다른 판정을 쓰면 안 된다. **공통 함수 사용.**
```
supervisedTraineeCountOnDate(assignmentId, workDate)   // 담당 인원
traineeCountOnDate(...)                                 // 사업체 재적 인원 (기존 의미 유지)
```
★**기존 `traineeCountOnDate`의 의미를 몰래 바꾸지 않는다.** 재적/담당 두 개념을 **이름으로 분리**한다.

**8-4 일지 저장** — `worker/logs/batch-save`는 **인원수를 세어 권한을 검증하면 안 된다.**
관계 존재를 검증한다: `supervision.traineeId == 요청 traineeId` ∧ `supervision.assignmentId == attendance.assignmentId` ∧
supervision·placement 기간에 `workDate` 포함 ∧ `assignment.workerId == 로그인 workerId`.
**현장 재적만을 이유로 타 직무지도원의 훈련생 일지를 저장할 수 없어야 한다.**

**8-5 적용 시점** — 이미 확정·지급·마감된 과거 급여는 **소급 변경하지 않는다.**
supervision 도입 이후 데이터와 미확정 급여부터 적용. 운영 데이터 0건이라 백필·재계산 없음.
확정 스냅샷이 생긴 뒤 새 기준으로 재생성해 덮어쓰지 않는다.

> **표현 정정(v4 수정)**: "현재 로직은 과지급"이라는 단정을 철회한다.
> → *현재 사업체 전체 기준은 확정된 전담 모델에서 기대되는 결과보다 높은 단가를 적용할 수 있다.
> supervision 도입 후 전담 인원 기준으로 교체한다.*

---

## 9. `DocumentRun` 식별과 멱등성 (확정)

**9-1 `periodEnd`는 식별자가 아니다.** 같은 월 문서의 coverage는 작성 중 확장될 수 있고
(`07-10~07-20` → `07-10~07-31`) 이는 **별도 문서가 아니라 같은 문서의 완성 과정**이다.
→ **unique key에 `periodEnd`를 넣지 않는다.** `periodStart`/`periodEnd`는 coverage **속성**이지 논리적 식별자가 아니다.

**9-2 훈련생 종속** = `supervisionId + docType + reportingMonth`
(supervision이 종료됐다 다시 생성되면 **별도 문서 관계**)
**9-3 출근부** = `assignmentId + docType + reportingMonth` (`supervisionId=null`, `traineeId=null`)

**9-4 DB 제약** — PostgreSQL은 nullable 컬럼을 일반 unique로 막지 못한다. **partial unique index 2개**(raw SQL):
```sql
CREATE UNIQUE INDEX ... ON document_runs (supervision_id, doc_type, reporting_month)
  WHERE supervision_id IS NOT NULL;
CREATE UNIQUE INDEX ... ON document_runs (assignment_id, doc_type, reporting_month)
  WHERE supervision_id IS NULL;
```
기존 `@@unique([assignmentId, docType, periodStart, traineeId])`는 신규 정책과 **충돌하므로 제거·교체 대상**으로 명시.
index 이름은 프로젝트 규칙에 맞춘다. `doc_type`은 **DB enum 명칭** 사용(§7).

**9-5 필드** — `reportingMonth` 추가 · `supervisionId` nullable FK 추가 ·
`periodStart`=`coverageStart`, `periodEnd`=`coverageEnd`(**물리명은 유지하고 의미만 coverage로 명시** — 소비처 영향 큼).
`traineeId`·`workerId`·`siteId`·`agencyId`·`assignmentId`는 **감사·조회 스냅샷 역할이 있으므로 즉시 제거하지 않는다.**

**9-6 제출과 버전** — 제출 전 coverage 갱신 가능 / 수정요청은 동일 run 아래 새 `DocumentVersion` /
서명 완료 후 변경은 기존 서명 무효화 규칙 / **공단 제출 완료 후 coverage를 조용히 변경하지 않는다**(별도 정정 run 또는 명시적 재제출 전이).

advisory lock 키와 DB unique key의 **의미가 일치**해야 한다:
```
docsubmit:supervision:{supervisionId}:{docType}:{reportingMonth}
docsubmit:assignment:{assignmentId}:{docType}:{reportingMonth}
```
**advisory lock은 보조 수단이며 DB unique constraint를 대체하지 않는다.**

---

## 10. 접근 권한

**10-1 위탁기관 담당자** — `assignment.agencyId == 로그인 agencyId` ∧ `supervision.assignmentId == assignment.id` ∧
`supervision.placementId == placement.id` ∧ `supervision.traineeId == trainee.id` ∧ `assignment.siteId == placement.siteId` ∧
요청 월과 supervision 기간 겹침 ∧ `coverageRange ≠ ∅`.
**같은 사업체의 다른 직무지도원 훈련생은 목록·직접 요청 모두 차단.**

**10-2 직무지도원** — `assignment.workerId == 로그인 workerId` ∧ supervision 조건 ∧ 기간 겹침.
독립(`agencyId=null`)이어도 본인 assignment·supervision으로 증명.

**10-3 시스템 운영자** — 대행 등록 가능하나 **소유자가 되지 않는다.**
감사로그: 조작 운영자 · 대상 직무지도원 · 대상 assignment · 생성된 trainee/placement/supervision · 시각 · (가능하면) 사유.

**10-4 직접 ID 요청** — 목록과 **같은 resolver** 사용. 다음은 **외부 응답에서 구분하지 않는다**:
존재하지 않는 `traineeId` · 다른 직무지도원의 훈련생 · 다른 기관 assignment · 관계 기간 불일치 · placement/supervision 불일치.
**명시 전달된 `assignmentId`/`supervisionId`가 무효면 다른 활성 관계로 폴백하지 않고 즉시 fail-closed.**

---

## 11. 목록 조회

기준: 선택 `assignmentId` + `reportingMonth` + 해당 월과 겹치는 supervision.
표시: 훈련생 이름 · 사업체 · 직무지도원 · `reportingMonth` · **실제 `coverageStart~coverageEnd`** ·
현재/과거 관계 · 담당 변경·중단·이동으로 분리된 구간.

**목록 쿼리와 직접 요청 resolver가 기간 조건을 각각 재구현하지 않게 한다** —
공통 기간 조건 + 공통 core resolver, actor별 권한 predicate만 분리.

---

## 12. Lifecycle 전이

| 시나리오 | 절차 |
|---|---|
| **12-1 신규 등록** | Trainee 생성/연결 → placement → assignment 검증 → supervision. **한 트랜잭션**, 중간 저장 상태 불허 |
| **12-2 담당자 변경(동일 사업체)** | 기존 supervision `D-1` 종료 → 신규 assignment 검증 → 신규 supervision `D` 시작. placement 유지. **자동 배정 금지** |
| **12-3 사업체 이동** | 기존 supervision·placement 종료 → 신규 placement → 신규 assignment 명시 선택 → 신규 supervision. 한 트랜잭션 + 훈련생 락 |
| **12-4 PAUSED/DROPOUT** | 열린 supervision 종료 → 열린 placement 종료 → 상태 변경 |
| **12-5 복귀** | 기존 관계를 **다시 열지 않는다.** 새 placement → 새 supervision (같은 사업체여도 새 이력) |
| **12-6 assignment 종료** | 그 assignment의 열린 supervision을 **같은 유효 종료일로** 종료. 계속 재적하면 새 직무지도원 **명시 선택 필요** |

---

## 13. 모듈 구조

| 모듈 | 책임 |
|---|---|
| `lib/traineePlacement.ts` | 사업체 재적 생성·종료·기간 검증 (기존 `traineeCountOnDate` 의미 유지) |
| `lib/traineeSupervision.ts` | 전담 관계 생성·종료·중복 검증 |
| `lib/traineeLifecycle.ts` | 등록·이동·담당 변경·상태 변경 트랜잭션 |
| `lib/docs/periodRange.ts` | KST 월 범위 · `effectiveAssignmentEnd` · 교집합 |
| `lib/docs/resolveDocSupervision.ts` | 문서 관계·권한·coverage resolver |
| 급여용 공통 helper | `supervisedTraineeCountOnDate(assignmentId, workDate)` |

**재적 인원 계산과 담당 인원 계산을 이름으로 분리한다.**

---

## 14. 동시성

**훈련생 단위** advisory lock 네임스페이스를 신규 추가한다.
기존(실측 `lib/assignmentLock.ts`): 단일키=`workerId` · `SITE_LOCK_NS=1` · `POST_LOCK_NS=2` · `CONTRACT_ISSUE_LOCK_NS=3`
→ 훈련생은 **NS=4**.

잠금 대상: placement 생성 · 사업체 이동 · supervision 생성 · 담당자 변경 · PAUSED/DROPOUT · 복귀 · assignment 종료 연동.

방지: 열린 placement 2개 · 기간 겹치는 placement 2개 · 열린 supervision 2개 · 기간 겹치는 supervision 2개.

★**한 직무지도원이 여러 훈련생을 담당하는 것은 허용이므로 worker 단위 잠금으로 전체를 직렬화하면 안 된다.**

⚠️ **기존 lock 전역 순서를 먼저 조사·문서화한 뒤 구현한다.**
현재 알려진 순서는 `[site|post] → worker`이며, 훈련생 락이 이 순서의 어디에 들어가는지 미정이다.
**순서를 정하지 않은 상태에서 구현하지 않는다.**

---

## 15. 기존 데이터 전환

2026-08-11 읽기 전용 실측: 운영 assignments·placements·trainees·sites·agencies **전부 0건** → **운영 백필 없음.**

> "현재 데이터가 0이므로 구조적 권한 문제가 없다"는 결론을 내리지 않는다.
> **파일럿 데이터가 생성되기 전에 구조를 적용해야 한다.**

운영 정책: supervision 없는 훈련생 종속 문서는 **fail-closed** · site가 같다는 이유로 담당자를 추론하지 않음 · legacy fallback 금지.

dev: placement 28건은 합성 시드 → **임의 백필하지 않고 재시드.**
시드가 Trainee → placement → assignment → supervision을 함께 생성하도록 수정.
필수 표본: 정상 1:1 · **한 직무지도원의 복수 훈련생(1:多)** · 같은 사업체 서로 다른 직무지도원 ·
월 중 시작 · 월 중 담당자 교체 · 사업체 이동 · PAUSED 후 복귀 · ENDED assignment.

---

## 16. 테스트 명세 (**코드 미작성**)

**16-1 불변식** — 다른/같은 사업체 placement 기간 중복 거부 · 같은 훈련생 supervision 중복 거부 ·
**같은 직무지도원의 서로 다른 훈련생 supervision 동시 존재 허용** · site 불일치 거부 · trainee 불일치 거부 ·
supervision이 placement/assignment 기간 밖이면 거부 · ENDED 종료근거 없으면 fail-closed

**16-2 권한·PII** — 같은 사업체 A·B 상호 조회 불가 · 직접 ID 거부 · 타 기관 거부 ·
독립 직무지도원 본인 것만 · 존재하지 않는 ID와 권한 없는 ID **응답 동일** · 무효 명시 ID **폴백 없음** ·
과거 supervision으로 현재 프로필 수정 불가 · 과거는 해당 기간 문서만

**16-3 월 문서** — 월 중 시작/전체/종료 coverage · 담당자 변경 문서 분리 · **PAUSED 후 복귀 supervision별 분리** ·
coverage 밖 로그 미포함 · 같은 reportingMonth라도 supervision 다르면 별도 문서 ·
동일 supervision·docType·month 동시 제출 시 run 1건 · **출근부(traineeId null) 동시 제출도 run 1건** ·
coverage 연장 시 새 run이 아니라 **동일 run 갱신** · 공단 제출 완료 후 조용한 변경 거부 ·
`ATTENDANCE_SHEET`는 supervision 없이 assignment coverage로 생성

**16-4 급여·출근부** — A→T1/B→T2 둘 다 1:1 · A→T1·T2는 1:多 · 사업체 인원 많아도 A 담당 1명이면 1:1 ·
supervision 종료 다음 날부터 제외 · 월 중 1→2명 변경 시 날짜별 판정 변경 ·
HOURLY/DAILY/MONTHLY 각각 supervision 기준 · **출근부와 급여 결과 일치** ·
타 직무지도원 훈련생이 급여 인원에 미포함 · **다른 사업체 순차 지도만으로 1:多 아님** · **확정 과거 급여 스냅샷 불변**

**16-5 lifecycle·동시성** — 등록 트랜잭션 실패 시 고아 없음 · 담당 변경 시 placement 유지 ·
이동 시 둘 다 교체 · PAUSED 종료 · 복귀 신규 생성 · assignment 종료 시 supervision 종료 ·
동시 담당 변경에도 열린 supervision 1건 · 동시 이동에도 열린 placement 1건 · 운영자 대행 감사로그

**16-6 docType 번역 경계** — 지원 API/PDF docType이 전부 DB enum으로 변환됨 ·
저장 가능한 훈련생 DB docType이 전부 PDF docType으로 역변환됨 · **왕복 변환 결과가 원래 값과 동일** ·
미지원 docType은 조용히 통과하지 않고 **fail-closed** · **`CHECKLIST`를 훈련생 종속으로 추론하지 않음**

**16-7 기존 경로 무회귀** — worker `logs/save`·`docs/context`·`preview`·`generate`·`submit` · `buildDocPayload` ·
admin `docs/trainees`·`preview`·`generate` · 사업체 담당자 서명 · 위탁기관 담당자 서명 ·
수정요청·재제출 · 공단 제출 상태 · ZIP·문서함·버전 조회 · 급여 산정 · 출근부 생성

---

## 17. 파일럿 반영

**17-1 독립 직무지도원** — 위탁기관 담당자 없이 사업체 등록 → 훈련생 등록/연결 →
본인 assignment(또는 운영자 대행) → placement → 본인 supervision → 일지 → 사업체 담당자 서명 → 월별 문서.

위탁기관 담당자가 없으면 **담당자 이름 수기 입력**. 이는 서명 이미지나 계정을 위조하는 방식이 아니다.
**별도 스냅샷 필드**로 기록하고 다음을 구분: 계정 인증 서명자 / 현장 수기 입력 이름 / 운영자 대행 입력.
수기 입력 사실과 주체를 **감사로그에 기록**한다.
> 현재 스키마: `DocumentRun.managerSignerName`(:704) · `SiteSignToken.signerName`(:855).
> **위탁기관 담당자 수기란은 현재 없음** — 신규 필드 필요(파일럿 W5).

**17-2 위탁기관 파일럿** — 기관 생성 → 배정 → placement·supervision → 출퇴근·일지 → 서명 →
월 문서 제출 → **supervision 기준 1:1/1:多 급여** → 확정.

**두 파일럿 모두 다른 직무지도원의 훈련생 PII가 노출되지 않는 것을 필수 검증한다.**

---

## 18. 구현 순서 (**승인 후에만**)

1 schema+migration → 2 `reportingMonth`·`supervisionId`·partial unique migration → 3 dev seed 재구성
→ 4 기간·교집합 공통 함수 → 5 supervision 도메인 서비스 → 6 lifecycle+advisory lock
→ 7 등록·이동·상태변경 경로 통합 → 8 assignment 종료 연동 → 9 문서 resolver·권한 가드
→ 10 목록 API → 11 payload·PDF coverage 전달 → 12 DocumentRun 멱등성
→ 13 급여 담당 인원 계산 → 14 출근부 담당 인원 계산 → 15 일지 저장 supervision 검증
→ 16 UI reportingMonth·coverage → 17 단위·통합·동시성 테스트 → 18 dev 재시드
→ 19 dev 런타임 스모크 → 20 Preview 검증 → 21 **운영 migration·배포 별도 승인**

**커밋 분리**: schema·migration / supervision·lifecycle / 문서 resolver·권한 / DocumentRun 멱등성 /
급여·출근부 1:1/1:多 / UI / seed·통합 테스트

---

## 19. 남은 확인사항

**정책 확정 완료** — 소유 없음 · 한 시점 한 사업체 · 한 시점 한 직무지도원 전담 · 공동 관리 불가 ·
**복수 훈련생 담당 허용** · 월 단위 제출 · 월 중 시작은 시작일~월말 · coverage 교집합 ·
`endDate` 보존/`endedAt` 실제 · **1:多 = 담당 훈련생 2명 이상** · 과거 확정 급여 소급 금지 ·
DocumentRun은 reportingMonth+관계로 식별 · `periodEnd`는 멱등키 아님 · 담당자 변경 `D-1`/`D` ·
supervision 없는 훈련생 문서 fail-closed

**구현 전 코드 조사 필요**
| 항목 | 현재 파악 |
|---|---|
| `CHECKLIST` 종속 범위 | docTypeMap 매핑 없음·traineeId 흔적 없음 → **D-1 제외**로 잠정 분류. 의미 확인 필요 |
| MONTHLY 1:多 단가 선택 | ✅ 확인 — `maxSiteCount >= 2`면 **월 전체 `rate2`**(`computeRun:254,364`). 방식 유지, 입력만 교체 |
| DAILY 같은 날 복수 assignment | `:350-356` `dayMulti` — 그날 **어느 배정이든** 2명+면 그날 `rate2`. supervision 교체 시 의미 재확인 필요 |
| DocumentRun 생성·조회·제출·재생성 소비처 | **미조사** |
| raw partial unique와 Prisma drift | **미조사** |
| advisory lock 전역 순서 | NS 1/2/3 + workerId 단일키 확인. **훈련생 락 위치 미정** |
| 운영자 대행 등록 API 범위 | **미조사** |
| 위탁기관 담당자 수기 이름 저장 위치 | 현재 필드 없음 확인. 신규 필요 |

**별도 정책** — 공단 등록 훈련생 중복 식별: 주민등록번호 전체 신규 수집은 **기본안 아님**.
우선순위 = 공단 고유번호 사용 → 없으면 이름·생년월일·연락처로 **중복 후보 경고** → **자동 병합 금지** →
운영자 확인 후 연결. 미확정이어도 supervision schema 설계는 진행 가능하나 **파일럿 훈련생 등록 전에는 결정 필요**.
