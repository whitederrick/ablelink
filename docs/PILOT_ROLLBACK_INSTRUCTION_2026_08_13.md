# 작업지시 — 파일럿 범위 재정의와 재구성 (2026-08-13 v4 · **2026-08-14 v5 개정**)

> 수신: VS Code Claude · 작성: 검토 세션(Claude Code)
> 이 문서는 **지시서**다. "확정 사실"은 전부 코드로 실측했으므로 **재조사하지 말 것.**
> 설계를 다시 확장하지 말 것. 범위 밖 개선·리팩터링 금지.
> **★사용자 승인 완료(2026-08-13) — §14 순서대로 착수 가능.**
>
> ★★**v5 개정(2026-08-14) — 5단계 착수 게이트(§10-5 FK 전수조사) 수행 결과 반영. 9건.**
> 초안의 초기화 설계에 **실행하면 실패하는 결함 2건**이 있었다:
> ①`TraineeEvaluation` 누락(RESTRICT라 삭제가 막힌다) ②감사 축이 `agencyId` 1순위인데 그 값은 **항상 null**이라 0건을 잡는다.
> 개정 항목: ①FK 기준값 107/69·Cascade15·SetNull18·Restrict36(§10-5) ②감사 축 재정의(§10-2-1)
> ③`ApiCallLog`·`AgencyAnnouncement`·`TraineeEvaluation` 명시 삭제 추가(§10-2) ④자식 5종 사전 수집(§10-2)
> ⑤`SiteSignToken.token` 사전 수집(§10-2·§7) ⑥`DocumentVersion` Storage 오기 삭제(§10-2)
> ⑦Storage 등록 규칙을 **prefix 나열**로 대체(§7 — 운영 라우트 수정 요구를 기각) ⑧부분완료 시 생성 차단(§10-3-2)
> ⑨초기화 경로 `audit()` 호출 금지(§10-2-2). 근거는 전부 실측이며 GPT·Claude 교차검토 3라운드를 거쳤다.
>
> ★★**v5-a 보정(2026-08-14, 외부 코드리뷰 반영) — 4건.** 정상 경로만 검증해 **실패 경로와 동시성**을 놓쳤다.
> ①**재시도 목록 유실**(P1): 레지스트리 `STORAGE_OBJECT` 를 재시도 입력으로 안 썼다 → `sign-tokens` 경로는
> 근거가 Cascade 로 사라져 재시도에서 못 찾고 **"완료"로 오보** (§10-2 사전 수집)
> ②**초기화 중 생성 경쟁**(P1): `deleteError` 는 실패 이후에야 기록돼 그 전 구간이 무방비 →
> **행 잠금 + 기관 실물 확인** 두 겹으로 교체 (§10-3-2)
> ③`AgencyContractClause` preflight 누락(P2, §10-5) ④**부분 실패인데 "잔여 전부 0"** 표시(P2, §10-3).
> ★교훈: **통과 수치가 검증 범위를 보증하지 않는다** — 52/52 는 실패 주입·재시도·동시 실행 케이스가 아예 없었다.

---

## 1. 파일럿이 무엇인가 (사용자 확정)

> **실제 운영에 들어가기 전에, 소수 직무지도원이 서비스를 직접 써 보게 하는 사용성 테스트다.**
> 일지 작성이 정말 편해졌는지를 **대면·전화로 직접 물어** 확인한다.
> 위탁기관이 아직 참여하지 않아 담당자 이름을 넣을 수 없으므로, **PDF에 수기로 적을 공란**이 필요하다.

지표 수집·이벤트 추적·회차 상태 관리는 **필요 없다.**

**수행 구조**

| 원칙 | 내용 |
|---|---|
| 전용 자원 | Agency·Site·Trainee·재적·Worker·Assignment를 **전부 신규 생성** |
| 재사용 금지 | 실제 기관·기존 Worker·기존 Site·기존 Trainee를 **재사용하지 않는다** |
| 삭제 대상 | **레지스트리에 명시적 ID로 기록**한다. 이름 접두어·생성 날짜로 추정 금지(F16) |
| 기존 코드 | 급여·연차·cron·초대·제출·발송 코드를 **수정하지 않는다** |

★재사용을 금지하면 급여·연차 오염과 "삭제할지 보존할지" 분류가 **동시에 사라진다.** 이것이 이 구조의 핵심이다.

---

## 2. 제출·발송 처리 방식 — **UI 격리 + 운영 통제** (사용자 확정 2026-08-13)

★**표현을 정확히 쓴다. 이것은 "제출·발송 차단"이 아니다.**

> **파일럿 전용 화면에는 미리보기·다운로드만 노출한다. 기존 운영 API는 수정하지 않으므로 서버 강제 차단은 하지 않으며,
>  소수 대면 운영으로 기존 문서 화면 접근을 통제한다.**

### 2-1. 확정 내용

| 항목 | 처리 |
|---|---|
| 파일럿 전용 문서 화면 | **미리보기·다운로드만** 제공 |
| 이메일·제출·공단 발송 UI | 파일럿 화면에 **만들지 않는다** |
| 참여자 안내 | **파일럿 문서 URL만** 알린다 |
| 기존 `/worker/docs` | **수정하지 않고 차단하지도 않는다** |
| 운영 통제 | 소수 참여자를 대면·전화로 운영하며 기존 문서 화면을 쓰지 않도록 안내한다 |

### 2-2. 남는 위험 (명시)

**참여자가 기존 `/worker/docs`를 직접 찾아가면 제출 기능에 접근할 수 있다.**
서버 수준 강제 차단을 하려면 `worker/docs/generate`·`submit`에 파일럿 판정을 넣어야 하는데,
그것은 **"기존 운영 코드 수정 0"과 동시에 만족할 수 없다.** 소수·대면 운영이므로 UI 격리로 수용한다.

### 2-3. 위험이 낮은 근거 (실측)

- **F19: `/worker/docs` 화면에 이메일 발송 UI가 없다.** 있는 것은 인앱 제출뿐이고 `page.tsx:230` 주석이 "기존 이메일 발송과 **별개**"라고 명시한다
- 파일럿 기관에 **위탁기관 Manager 계정을 만들지 않으므로** 제출해도 수신자가 없다. `DocumentRun` 상태만 바뀌고 §10이 지운다
- 공단 발송(`admin/document-runs/send`)은 **운영자 화면**이라 참여자가 못 누른다
- 매니저 직접 PDF 이메일은 기존 서명 게이트로 **항상 400**이다(F8)

---

## 3. 무엇이 잘못됐나

구현된 것은 "운영 서비스 **안의** 격리된 파일럿 영역"이었다.
격리를 코드로 만들어야 했으므로 **운영 파일 12개를 편집**했고, DB 테이블 4개와 nullable FK 7컬럼이 추가됐다.

| 만든 것 | 왜 불필요한가 |
|---|---|
| 회차 상태 전이·전역 ACTIVE 1개 제약 | 회차 개념 자체가 없다 |
| 기존 Worker 연결 초대 | 전용 Worker만 쓴다 |
| 운영 파일 12곳 차단 | 전용 자원이라 섞일 대상이 없다 |
| 근무일 확인·정정 화면 | 기존 '일괄 작성'이 이미 한다(F6) |
| 복잡한 폐기 보존 분류 | 재사용이 없으므로 전부 삭제다 |

**되돌리는 비용은 지금이 가장 싸다** — 운영 DB 마이그레이션 미적용, 운영 배포 미실행.

---

## 4. 확정 사실 (재조사 금지)

| # | 사실 | 근거 |
|---|---|---|
| F1 | 서명 줄은 `` `${label} : ${name}    ${tail}` `` 한 줄을 **우측정렬**로 그린다. 이름이 비면 콜론과 `(서명 또는 인)` 사이 **공백 5칸(≈14pt·5mm)** 뿐 → 한글 3자(≈33pt·12mm)를 못 쓴다 | `lib/pdf/pdfkitRenderer.ts:118-121` |
| F2 | 다운로드(`worker/docs/generate`)는 `govAgent`·`agencyAgent` 이름을 **빈 문자열로 하드코딩**한다. 미리보기(`preview`)는 매니저 `displayName`을 넣는다 → **원래 둘이 어긋나 있다** | `generate:158-161` · `preview:340` |
| F3 | 외부 발송(이메일·알림톡·SMS·결제)은 `DB_ENV=development` 하나로 전면 차단된다. **운영 환경에서는 켜져 있다** | `lib/outboundGuard.ts:13-18` |
| F4 | cron은 `CRON_SECRET` 미설정 시 모든 호출 401이다 | `app/api/cron/daily/route.ts:36` |
| F5 | 급여는 **PRO 전용 기능**이다. 기관 `planType`을 STANDARD로 두면 급여가 막히고 문서·PDF·서명은 열린다 | `lib/planGuard.ts:44-51` · `cron/daily:446` |
| F6 | 출퇴근 버튼 없이 근무일을 만들려면 **`attendanceButtonExempt: true` + 기존 '일괄 작성'**이면 된다. 일일 cron도 면제 배정에 자동 생성한다 | `bulk-generate:113` · `cron/daily:273-291` |
| F7 | `073ce08`(TraineeSupervision, D-1)은 **pilot 참조 0건**이다 | `git show 073ce08` |
| F8 | 매니저 직접 PDF 이메일(`admin/docs/generate`)은 payload에 `manager` 서명 키가 없고 지원 5종이 전부 `manager: true` 필수라 **`toEmail` 요청이 항상 400**이다 | `admin/docs/generate:208` · `requiredSignatures.ts:15` |
| F9 | `worker/docs/submit`의 파일럿 차단 블록은 파일럿이 없어도 **모든 제출에 쿼리 2~4개를 추가**한다 | `submit:381` |
| F10 | 파일럿 편집 지점은 `pilot\|파일럿` grep으로 **100% 회수**되며 `★[PILOT]` 마커가 붙어 있다 | `WORK_STATUS §5` |
| F11 | 급여 계산은 전 구간 **`agencyId` 스코프**다 — 배정·근태 조회 모두 | `computeRun.ts:89` · `:137` · `:177` |
| F12 | 연차 자동적립은 `EmploymentContract` 기준이다. 근로계약이 없으면 후보에 안 들어간다 | `lib/leave/runAccrual.ts:88` |
| F13 | `maybeStartTrial`(FREE→TRIAL 자동 승격)은 **호출부 0건**이다 | `lib/planGuard.ts:318` |
| F14 | ★**`Worker`·`Trainee` 모델에 `agencyId`가 없다.** 기관 연결은 각각 `SiteAssignment`·Site 경유다 | `schema.prisma` |
| F15 | ★F14 때문에 **배정을 먼저 지우면 그 Worker가 파일럿 것이었는지 판별할 수단이 사라진다** → 레지스트리가 구조적으로 필요하다 | F14 |
| F16 | Prisma `startsWith`는 `_`를 **LIKE 와일드카드로 넘긴다**. `"__"` 패턴이 한글 기관명까지 매칭한 사고가 실제로 있었다 | `WORK_STATUS §6-7` |
| F17 | `reset-data-keep-admin.mts`는 `admins`·`_prisma_migrations`만 남기고 나머지 전 테이블을 TRUNCATE한다. **보험요율·소득세액표도 함께 지워진다** | `reset-data-keep-admin.mts:23,51-57` |
| F18 | `/admin/pilots/[id]/page.tsx`는 **1,110줄**이다(목록 247줄 별도) | `wc -l` |
| F19 | ★**`/worker/docs` 화면에 이메일 발송 UI가 없다.** 인앱 제출만 있고 `:230` 주석이 "기존 이메일 발송과 별개"라 명시한다 | `app/worker/docs/page.tsx:230` |
| F20 | ★서명 이미지는 Supabase Storage **`signatures` 버킷**에 있다. 객체 경로는 DB에 저장된 URL에서 `signaturePathFromStored()`로 파생된다 → **DB 행을 지우기 전에 경로를 수집해야 한다** | `lib/signatureImage.ts:13,24-27,69` |
| F21 | ★**`AuditEvent`·`AccessLog`에는 FK가 없다**(`actorId`·`subjectId`는 느슨한 참조). Cascade로 안 지워진다. 게다가 `actorLabel`·`subjectLabel`에 **성명·로그인ID가 스냅샷으로 박혀 있다** | `schema.prisma` AuditEvent·AccessLog |
| F22 | ★위탁기관 담당자 슬롯은 **문서마다 라벨과 키가 다르다** — 출근부·훈련일지 `(공단/위탁기관) 담당자`=`govAgent` / 적응지도 일지 `위탁기관 담당자`=`govAgent` / 종합평가 `(위탁기관) 담당자`=`agencyAgent`. **파일럿 대상은 `govAgent`** | `pdfkitRenderer.ts:298,466,496,623` |
| F23 | ★서명 줄이 폭을 넘으면 pdfkit이 **wrap**하는데, `:112` 페이지 분할 가드는 높이를 `rows.length * 24`로 계산한다 → **한 행이 2줄이 되면 높이를 과소평가해 서명 블록이 페이지를 넘는다**(`3792360`·07-20 사고와 같은 클래스). 일지·평가는 `right`가 **표 셀 폭에 묶여** 출근부보다 좁다 | `pdfkitRenderer.ts:112,121,133` · `:466,495,623` |
| F24 | ★`Site.gpsLat`·`gpsLon`은 **필수(non-null)** 다. 좌표 없이 사업체를 만들 수 없다. 4-B에서 Kakao SDK 도메인 미등록으로 **등록 전체가 막힌 전례**가 있다 | `schema.prisma` Site |
| F25 | ★사업체 담당자의 **단일 출처는 `Site.businessContactName`/`Phone`/`Email`** 이다(`:195-199` 주석이 명시). `SiteContact`는 별도 모델이지만 **문서 payload에 쓰이지 않는다** → 파일럿에서 만들 필요 없다 | `schema.prisma:195-199,250` |
| F25b | ★★**PDF의 `companyManager.name`은 `businessContactName`이 아니라 서명 토큰의 `signerName`에서 온다.** 토큰이 없으면 **빈 문자열**이다 → 파일럿 payload에서 이름을 **명시적으로 전달해야** 표시된다 | `buildDocPayload.ts:112,124,140,152` |
| F26 | `SiteAssignment.workType`은 enum이 아니라 **String**이고 값은 `AM`·`PM`·`FULL_DAY`·`CUSTOM`이다. ★시각은 `computeWorkTimes()`가 단독 결정하는 **사용자 확정 절대불변 규칙**이다 | `lib/workSchedule.ts:6-17,45` |
| F26b | ★`computeWorkTimes()`는 **`CUSTOM`인데 시각이 없으면 조용히 `09:00~18:00`(FALLBACK)로 대체**한다. 오입력이 에러 없이 잘못된 출근부를 만든다 | `lib/workSchedule.ts:32` |
| F29 | 운영자 워커 생성(`POST /api/admin/system/workers`)의 규칙: **`loginId` = 휴대전화번호**(`:101`), 임시 비밀번호는 **운영자가 입력**(8자 이상, `:96`)해 `hashPassword()`로 저장, **`planType` 지정 가능**(FREE~PREMIUM, `:97`) | `app/api/admin/system/workers/route.ts:82-105` |
| F27 | ★출근부 **1:1 / 1:多는 "그 날짜에 그 현장에 재적한 훈련생 수"로 날짜별 결정**된다(워커 입력 아님). 급여 `computeRun`과 판정 소스를 공유한다 | `attendanceSheetPayload.ts:9,91-106` · `lib/traineePlacement.ts` |
| F28 | ★★**`buildDocPayload`에 `EmploymentContract`·`PayContract` 조회가 한 곳도 없다.** 출근부·일지 PDF는 Worker·Site·SiteAssignment·Trainee·DailyAttendance·TraineeLog만으로 완성된다 → **근로계약을 안 만들어도 문서가 온전하다** | `lib/docs/buildDocPayload.ts` 전문 |

---

## 5. 유지 / 제거 / 재작성 결정표

| 산출물 | 커밋 | 처리 |
|---|---|---|
| TraineeSupervision (D-1) | `073ce08` | ★**유지 — 원복 대상에서 제외.** 단 `pilotSessionId` 필드·관계·인덱스만 삭제 |
| PDF 스윕 519케이스 + baseline | `c106595` | ★**유지 — 원복 대상에서 제외** |
| 운영자 파일럿 메뉴 `/admin/pilots` | `3182762`·`a8418db` | ★**축소 재작성**(§8). 1,110줄 → 6기능(F18) |
| 파일럿 스키마 4테이블 + FK 7컬럼 | `7299f60` | **제거** → 최소 레지스트리로 대체(§7) |
| 초대 발급·수락·연결 | `059a9c1` | **제거** — 운영자가 계정을 직접 발급한다 |
| 운영 파일 12곳 차단 | `f8353a6`·`82ca783` | **제거** — §2 (가) 기준. (다)를 택하면 이 행이 달라진다 |
| 근무일 확인·정정 | `58a1deb`·`48426c3` | **제거** — 기존 '일괄 작성'으로 충분(F6) |
| 폐기 잡(보존 분류 포함) | `6791d8b` | **제거** — 레지스트리 ID 기반 전량 삭제로 대체(§10) |
| PDF 담당자명 파일럿 특례 | `d40ec8f` | **제거 후 재구현** — **파일럿 전용 경로**에서만(§9) |
| `docs/PILOT_P1_FIX_PLAN_2026_08_13.md` | (untracked) | ★**삭제** — v1.8 구현분 보완 계획이라 되돌림으로 전량 무효 |

---

## 6. 되돌림 작업 지시

### 6-1. 아카이브 (먼저)

```
git branch pilot/in-app-v1.8 f1a4743
git push origin pilot/in-app-v1.8
```

### 6-2. 되돌림은 revert 연쇄가 아니라 **단일 커밋**으로

`82ca783`(마커 주석)이 기존 파일 11개를 건드려 `git revert` 10건은 충돌이 대량 발생한다. 대신:

**(a) 기존 운영 파일 11개를 착수 전 상태로 복원**

```
git checkout 8da3c30 -- \
  app/worker/docs/page.tsx \
  app/api/worker/docs/submit/route.ts \
  app/api/worker/docs/generate/route.ts \
  app/api/worker/docs/preview/route.ts \
  app/api/worker/site/current/route.ts \
  app/api/worker/invite/\[id\]/route.ts \
  app/api/worker/assignment/connect/route.ts \
  app/api/admin/document-runs/send/route.ts \
  app/api/admin/sites/route.ts \
  app/admin/sites/new/page.tsx \
  app/admin/shell/components/AdminNav.tsx
```

★`AdminNav.tsx`는 §8의 축소 메뉴 링크를 다시 넣어야 하므로, 복원 후 **링크 1줄만** 재추가한다.
★`lib/assignmentLock.ts`는 **통째 복원하지 말 것.** `073ce08`이 넣은 훈련생 락(NS=4)·전역 순서 주석은 남기고
`PILOT_SESSION_LOCK_NS`·`acquirePilotSessionLock`·`acquirePilotActivationLock`만 제거한다.

**(b) 신규 경로 삭제**

```
app/admin/pilots/                     app/api/admin/pilots/
lib/pilot/                            prisma/migrations/20260812130000_add_pilot_session/
scripts/verify-pilot-*.mts            scripts/smoke-pilot-*.mts
docs/PILOT_P1_FIX_PLAN_2026_08_13.md
```

★`app/admin/pilots`·`app/api/admin/pilots`는 삭제 후 §8로 **새로 작성**한다(기존 코드 재활용 금지 — 회차 개념이 배어 있다).
★`scripts/_cleanupGuard.mts`는 다른 스크립트가 참조하는지 grep 후 판단(참조 0이면 삭제).

**(c) `prisma/schema.prisma` 수술**

- 제거: `PilotSession`·`PilotParticipant`·`PilotParticipantTrainee` 모델, 관련 enum 2종,
  각 모델의 `pilotSessionId`/`createdByPilotSessionId` 컬럼·관계·인덱스
  (Worker·Site·SiteAssignment·Trainee·TraineePlacement·WorkerInvite·TraineeSupervision)
- 복원: `WorkerInvite.createdByManagerId`를 **NOT NULL**로, `creator Manager`(non-null)로 되돌리고
  `createdByAdminId`·`pilotSession` 관계 제거. `Admin.createdWorkerInvites` 역방향도 제거
  → ★운영자가 계정을 직접 발급하므로 초대 스키마는 **완전 원복**된다
- **유지**: `TraineeSupervision` 모델 전체(단 `pilotSessionId` 필드·관계·인덱스만 삭제)
- **추가**: §7의 레지스트리 2테이블

**(d) `lib/trainee/supervision.ts`** — `SupervisionCandidate.pilotSessionId` 필드와 create 데이터의 `pilotSessionId` 줄 삭제(총 6줄).

### 6-3. ★dev DB 정리 — 수동 DROP 금지

**`_prisma_migrations` 행을 직접 지우지 않는다.** 실제 스키마와 Prisma 이력이 어긋난다.

- **원칙**: dev 데이터가 불필요하면 **사용자 승인 후 `npx prisma migrate reset`** 으로 새 마이그레이션 집합을 처음부터 적용한다
- dev 데이터를 보존해야 하면 **명시적 rollback 마이그레이션**(파일럿 테이블·컬럼 DROP)을 새로 작성해 정방향으로 적용한다
- 어느 쪽이든 **대상 DB가 dev인지 먼저 출력해 확인**한다(`scripts/_dbGuard.mts` 규율)
- ★운영 DB는 미적용이므로 손대지 않는다

### 6-4. 검증 (전부 통과해야 커밋)

```
grep -rn "pilot\|파일럿" app lib prisma scripts --include=*.ts --include=*.tsx --include=*.mts --include=*.prisma
    → §7~§9에서 새로 만드는 것 외 잔여 0
npx tsc --noEmit          → 0
npx vitest run            → 436에서 파일럿 테스트분만 감소, 그 외 무감소
npx tsx scripts/verify-pdf-sweep.mts  → 519케이스 baseline 동일
next build                → 0  (★dev 서버 종료 후 실행 — Prisma DLL EPERM)
```

---

## 7. 최소 파일럿 레지스트리 (신규 설계)

**왜 필요한가**: `Worker`·`Trainee`에 `agencyId`가 없어(F14) 배정을 지우고 나면 파일럿 소속을 판별할 수단이 사라진다(F15).
이름 패턴 추정은 금지다(F16). **생성 시점에 ID를 기록하는 것 외에 방법이 없다.**

**설계 원칙**: 상태 머신 없음 · 전이 없음 · 보존 판정 없음 · **평문 비밀번호 저장 없음.**

```prisma
model Pilot {
  id        BigInt         @id @default(autoincrement())
  name      String                              // 식별용 라벨
  note      String?                             // ★비밀번호 등 비밀정보 저장 금지
  createdAt DateTime       @default(now())
  resources PilotResource[]
  @@map("pilots")
}

model PilotResource {
  id          BigInt            @id @default(autoincrement())
  pilotId     BigInt            @map("pilot_id")
  kind        PilotResourceKind                  // 삭제 순서 결정용
  resourceKey String            @map("resource_key")   // ★BigInt id와 Storage 경로를 모두 담는다
  deleteError String?           @map("delete_error")   // 삭제 실패 사유(재시도 목록)
  createdAt   DateTime          @default(now())
  pilot       Pilot             @relation(fields: [pilotId], references: [id], onDelete: Cascade)
  @@unique([kind, resourceKey])
  @@index([pilotId, kind])
  @@map("pilot_resources")
}

enum PilotResourceKind {
  AGENCY SITE TRAINEE PLACEMENT WORKER ASSIGNMENT
  STORAGE_OBJECT        // ★Storage 객체 경로(F20)
}
```

- ★`resourceKey`는 **String**이다. `BigInt`로는 Storage 경로를 담을 수 없다
- ★**정규화 규칙(필수)** — `@@unique([kind, resourceKey])`가 의미를 가지려면 형식이 하나여야 한다
  · DB 자원(AGENCY·SITE·TRAINEE·PLACEMENT·WORKER·ASSIGNMENT) = **BigInt의 10진 문자열**(`String(id)`).
    선행 0·공백·따옴표 금지. 조회 시 `BigInt(resourceKey)`로 되돌린다
  · `STORAGE_OBJECT` = **`버킷명/객체경로`** 형식(예: `signatures/xxx/yyy.png`).
    서명 URL을 그대로 넣지 않는다 — 같은 객체가 public/signed 두 형태로 중복 등록된다
- ★운영 테이블에 **컬럼을 추가하지 않는다.** 레지스트리가 단방향으로 참조만 한다 → 제거 시 2테이블 DROP으로 끝난다
- ★`purgedAt` 필드는 **두지 않는다.** §10이 `Pilot` 행까지 지우므로 보존할 곳이 없다(흔적 전량 삭제 우선)
- ★**DB 자원**의 생성과 레지스트리 기록은 **같은 DB 트랜잭션**에서 처리한다.
  기록 없이 생성되면 영원히 못 지운다
- ★**Storage는 이 규칙의 예외다** — 외부 HTTP 호출이라 DB 트랜잭션에 묶을 수 없다(§10-1).
- ★★**개정(2026-08-14) — "업로드 성공 직후 등록" 규칙은 기각한다.**
  그 규칙은 서명을 올리는 **기존 운영 라우트**(`app/api/worker/signature/route.ts` 등) 수정을 요구한다.
  파일럿 때문에 운영 코드를 고치지 않는다는 규율에 정면으로 어긋난다.
  **고칠 필요도 없다** — signatures 버킷의 파일럿 경로가 전부 **결정적 prefix**를 갖기 때문이다.

  | 경로 형식 | 생성 지점 | 초기화 시 prefix 근거 |
  |---|---|---|
  | `{workerId}/signature_*.png` | `worker/signature/route.ts:57` | 레지스트리 `WORKER` id |
  | `inperson/{assignmentId}/*.png` | `worker/docs/inperson-sign/route.ts:66` | 레지스트리 `ASSIGNMENT` id |
  | `sign-tokens/{token}/*.png` | `app/api/sign/[token]/route.ts:95` | ★`SiteSignToken.token` — **DB 삭제 전에 수집**해야 한다 |

  → **초기화 직전에 prefix를 나열(Storage list)** 해 실제 객체를 수집한다. DB가 참조하지 않는
  **고아 객체까지 회수**되므로 "업로드 직후 등록"과 동등하거나 그보다 완전하다.
  ★**단 `sign-tokens/{token}`은 `SiteSignToken` 행이 유일한 근거**이고 그 행은 `SiteAssignment`
  Cascade로 사라진다 — **삭제 전 사전 수집이 필수**다(F20의 실제 사례).
- ★`STORAGE_OBJECT` 레지스트리 행은 **초기화 시점에** 수집 결과로 기록한다(삭제 실패분의 재시도 목록).

---

## 8. `/admin/pilots` — 파일럿 일괄 설정 화면 (재작성)

★**사용자 확정(2026-08-13): 운영자가 파일럿을 한 자리에서 일괄 설정하는 기능은 유용하므로 만든다.**
현재 1,110줄(F18)은 회차 상태 머신 때문이다. 그 개념만 걷어내고 **설정 기능은 살린다.**

### 8-0. 왜 일괄 설정이 필요한가 — 매니저 부재 대체 매핑

★사용자 지적(2026-08-13): **위탁기관(Manager)이 없으므로 매니저가 하던 등록을 운영자가 대신해야 한다.**

원래 매니저가 하는 일을 전수하고, 파일럿 문서(출근부·일지)에 **실제로 필요한 것만** 운영자 화면으로 옮긴다.

| 매니저가 원래 하는 일 | 파일럿 문서에 필요한가 | 처리 |
|---|---|---|
| 사업체(Site) 등록 | ✅ `companyName`이 출근부·일지 전부에 들어간다 | **운영자 일괄 등록**(8-1 ②) |
| 사업체 담당자 등록 | ✅ 출근부 `companyManager` 서명 슬롯의 출처 | **운영자 일괄 등록**(8-1 ③) |
| 훈련생 등록·재적 | ✅ 일지 `traineeName` + ★**1:1/1:多 판정**(F27) | **운영자 일괄 등록**(8-1 ④) |
| 직무지도원 배정 | ✅ `workType`→근무시각, `stepStart`→일지 `preStartYmd` | **운영자 일괄 등록**(8-1 ⑥) |
| **근로계약서 발행** | ❌ **payload에 안 들어간다(F28)** | **만들지 않는다** — 연차 적립도 회피된다(F12) |
| **급여 기준(PayContract)** | ❌ payload에 안 들어간다(F28) | **만들지 않는다** — 급여는 플랜으로도 막힌다(F5) |
| 출근부·일지 확인/서명 | — | 파일럿에서는 서명 없이 수기 공란(§9) |
| 문서 발송 | — | §2 (가) 기준으로 하지 않는다 |

> ★★**핵심**: `buildDocPayload`에 `EmploymentContract`·`PayContract` 조회가 **한 곳도 없다**(F28).
>  근로계약을 만들지 않아도 **출근부·일지 PDF는 완전하게 생성된다.** 계약을 안 만드는 것이 기능 포기가 아니다.

### 8-1. 일괄 설정 단계와 입력 필드 (실측 기반)

| # | 단계 | 생성 모델 | 필수 입력 | 자동/고정 |
|---|---|---|---|---|
| 1 | **파일럿 생성** | `Pilot` + `Agency` | 파일럿 라벨, 기관명 | `planType=STANDARD`(F5) · 레지스트리 AGENCY 기록 |
| 2 | **사업체 등록** | `Site` | 사업체명, 주소, **좌표**(F24) | `agencyId`=전용기관 · `isVerified=false` |
| 3 | **사업체 담당자 등록** | `Site.businessContactName`(F25) | **성명(필수)** · 연락처(선택) | ★**이메일은 수집·저장하지 않는다**(8-4) · ★`SiteContact`는 **만들지 않는다**(payload 미사용) · PDF 표시는 §9-0 |
| 4 | **훈련생 등록·재적** | `Trainee` + `TraineePlacement` | 성명, 성별, 장애유형, 중증도, **재적 기간** | ★`Trainee`에 `agencyId` 없음(F14) — Site 경유 재적으로 연결. ★재적 인원이 서식을 바꾼다(F27) |
| 5 | **직무지도원 등록** | `Worker` | 성명, 로그인ID, 연락처 | `planType=STANDARD` · ★초기 비밀번호 **1회만 표시**(§8-2) |
| 6 | **근무형태·기간 등록** | `SiteAssignment` | **근무형태**(F26), 시작일, 종료일 | ★`attendanceButtonExempt: true`(F6) · `serviceStep`·`stepStart`(일지 `preStartYmd` 출처) |
| 7 | **참여자 현황 확인** | — | — | 아이디·배정·근무형태만. ★비밀번호는 표시하지 않는다 |
| 8 | **전체 초기화** | — | — | §10 실행 |

**근무형태 값(F26)** — `VALID_WORK_TYPES = ["AM", "PM", "FULL_DAY", "CUSTOM"]`

| 값 | 표시 | 시각(출퇴근지도 포함=기본) | 미포함(예외) | 파일럿 |
|---|---|---|---|---|
| `AM` | 오전 4시간 | 08:30~14:00 | 09:00~13:30 | ✅ |
| `PM` | 오후 4시간 | 12:30~18:00 | 13:00~17:30 | ✅ |
| `FULL_DAY` | 전일 8시간 | 09:00~18:00 (지도 강제 미포함) | — | ✅ |
| `CUSTOM` | 직접 지정 | `customWorkStart`/`customWorkEnd` | — | ★**허용하지 않는다** |

> ★★**시각은 `lib/workSchedule.ts`의 `computeWorkTimes()`가 단독 결정한다. 사용자 확정 절대불변 규칙이므로
>  파일럿에서 시각을 직접 입력받거나 재계산하지 않는다.** 근무형태와 `commuteGuidanceIncluded`만 고르게 하고
>  시각은 기존 함수를 호출해 표시한다.
>
> ★**`CUSTOM`을 파일럿 선택지에서 제외하는 이유(F26b)**: `computeWorkTimes()`는 `CUSTOM`인데 시각이 없으면
>  **에러 없이 조용히 `09:00~18:00`로 대체**한다. 오입력이 잘못된 출근부를 만들고도 아무 신호가 없다.
>  소수 파일럿에는 `AM`·`PM`·`FULL_DAY` 3종이면 충분하므로 **선택지에서 뺀다.**
>  (`CUSTOM`을 살려야 한다면 선택 시 시작·종료 시각을 **필수 입력**으로 강제해야 한다.)

### 8-2. ★직무지도원 아이디·비밀번호 발급 방식

기존 운영자 경로(`POST /api/admin/system/workers`)와 **같은 규칙**을 쓴다(F29). 새 규칙을 만들지 않는다.

| 항목 | 규칙 | 근거 |
|---|---|---|
| **아이디(`loginId`)** | ★**휴대전화번호 그대로**(하이픈 제거). 별도 아이디 체계 없음 | F29 `:101` |
| **비밀번호** | 운영자가 **임시 비밀번호를 입력**한다(8자 이상). 시스템 자동 생성도 가능 | F29 `:96` |
| **저장** | `hashPassword()` 해시만. ★**평문 저장 금지** | F29 `:7` |
| **등급** | `planType = STANDARD` (생성 시 지정 가능) | F29 `:97` · F5 |
| **중복** | 같은 번호가 이미 있으면 409. 파일럿 참여자는 실제 본인 번호를 쓴다 | F29 `:101-102` |

**표시 규칙**

- 초기 비밀번호는 **계정 생성 API 응답에서 단 1회만** 반환한다. 운영자가 그 자리에서 참여자에게 전달한다
- 이후 **다시 볼 수 없다.** 목록·상세 화면은 비밀번호 필드를 **아예 갖지 않는다**
- 분실 시 **재설정**(새 임시 비밀번호 발급 → 다시 1회 표시)만 제공한다
- ★평문을 `Pilot.note`·`PilotResource`·어떤 컬럼에도 저장하지 않는다

> ★★**생성은 파일럿 API 안에서 한다.** 기존 `admin/system/workers`를 그대로 호출하면
>  **레지스트리에 기록되지 않아 영원히 못 지운다**(F15). 규칙만 동일하게 따르고, 생성과 레지스트리 기록을 같은 트랜잭션에 묶는다.
> ★참여자에게는 **로그인 URL + 아이디(전화번호) + 임시 비밀번호 + 파일럿 문서 URL** 4가지를 함께 전달한다(§2-1).

### 8-3. ★사전조건 — 전화번호 중복 참여자 처리

`loginId`가 전화번호이고(F29) **기존 Worker 재사용은 금지**이므로, 이미 가입된 번호는 **409로 계정을 만들 수 없다.**
이건 예외 상황이 아니라 **사전에 걸러야 하는 조건**이다.

> **참여자 등록 전에 전화번호 중복을 검사한다. 기존 계정이 있으면 기존 Worker를 재사용하거나 수정하지 않고,
>  해당 참여자는 이번 파일럿 대상에서 제외한다. 별도 번호 사용은 본인 소유·수신 가능한 번호에 한해 운영자가 확인한다.**

- 화면은 등록 **전에** 중복을 조회해 알린다. 409를 만나고 나서 알려주는 방식은 안 된다
- ★기존 Worker의 `planType`·`status`를 **절대 건드리지 않는다.** 파일럿이 끝나고 원래 등급 복원을 놓치면 실제 워커가 공짜 유료등급을 갖는다
- 참여자 섭외 단계에서 번호를 미리 받아 확인하는 것이 가장 확실하다

### 8-4. ★이메일을 수집하지 않는다

운영 환경은 **외부 발송이 켜져 있다**(F3). 파일럿에 이메일 수신처가 존재하면 오발송 경로가 생긴다.

| 대상 | 처리 |
|---|---|
| `Site.businessContactEmail` | ★**입력받지 않고 저장하지 않는다** |
| `Site.govContacts`(현장별 공단 담당자) | ★**설정하지 않는다** |
| `Agency.govContacts`(기관 기본 수신처) | ★**설정하지 않는다** |

→ 수신처가 비어 있으면 발송을 시도해도 보낼 대상이 없다. **§2의 UI 격리를 데이터 쪽에서 한 겹 더 받쳐준다.**
   PDF에 필요한 것은 **표시용 `businessContactName`뿐**이다(§9-0).

### 8-5. ★좌표 입력 (F24 — 4-B에서 실제로 막혔던 지점)

`Site.gpsLat`·`gpsLon`은 **필수(non-null)** 다. 좌표 없이는 사업체를 만들 수 없다.
4-B 시각검증 때 Kakao 지도 SDK가 도메인 미등록으로 실패하자 **사업체 등록 전체가 막힌 전례**가 있다.

- 주소 검색(`/api/geo/search-address`) 결과에 **이미 좌표가 들어 있다** → 선택 즉시 좌표를 채운다
- 지도는 **조정용**으로만 연다. 지도가 안 떠도 등록이 가능해야 한다
- 지도 SDK 실패 시 **수동 좌표 입력 폴백**을 둔다

**만들지 않는 것**: 회차 상태 전이 · 초대 발급/수락 · 근무일 정정 · 보존 분류 · 전역 제약.
**전용 기관에 만들지 않는 것**: 위탁기관 Manager 계정 · 근로계약(F28) · 급여 기준(F28) · 결제/PRO 플랜 ·
**공단·사업체 이메일 수신처(§8-4)** · `SiteContact`(F25).

> ★기존 `/admin/sites/new` 등 운영 화면을 재사용하지 않는다 — 재사용하면 그 화면에 파일럿 분기가 생긴다.
>  전용 자원 생성은 파일럿 API 안에서 완결한다.

---

## 9. 수기 공란 — **파일럿 전용 문서 경로에서만**

**요구**: 위탁기관 담당자 이름을 모를 때 PDF에 손으로 적을 공간이 있어야 한다. 현재는 공백 5칸 + 우측정렬이라 불가능하다(F1).

**★절대 하지 말 것**
- `lib/pdf/pdfkitRenderer.ts`에 "이름 자리를 넓히는 것" **전역 fallback 금지** — 정상 운영 PDF가 전부 바뀐다
- 기존 `app/api/worker/docs/preview`·`generate` **편집 금지** — 비파일럿 워커 문서가 바뀐다

**구현**: 미리보기·다운로드만 제공하는 **파일럿 전용 문서 경로를 신설**한다.

```
app/pilot/docs/                 (또는 합의된 별도 URL)
app/api/pilot/docs/preview/
app/api/pilot/docs/generate/
```

- payload를 만들 때 `govAgent`의 `name`에 **ASCII 공백 15개**(49.5pt ≈ 17.5mm)를 **넣어서 전달**한다
  · ★★**보이는 표시를 넣지 않는다**(사용자 확정 2026-08-13). 같은 서명 블록의 다른 성명 칸
    (사업체담당자·직무지도원)에는 밑줄이 없어서 위탁기관 담당자 줄에만 넣으면 그 줄만 튄다.
    요구는 "손으로 적을 **너비**를 넉넉히"였지 "밑줄을 그어라"가 아니었다.
  · 폭 실측: 공백 1개 = 3.3pt · 활자 한글 3자 ≈ 32pt(11mm) · 손글씨는 그보다 크므로 여유를 둔다
  · ★`agencyAgent`는 건드리지 않는다 — 종합평가 2종 전용이고 파일럿은 그 문서를 제공하지 않는다(F22)
- 렌더러는 무변경 — payload로 받은 문자열을 그대로 그린다
- ★**접근 검증 2단**: Worker 세션 확인만으로 부족하다. **해당 `workerId`와 `assignmentId`가 `PilotResource`에 등록돼 있는지** 반드시 확인한다. 미등록이면 404 — 비파일럿 워커가 이 경로로 자기 문서를 뽑을 수 없어야 한다
- ★전각 `＿` 금지 — HCR 폰트 글리프 누락 시 두부(tofu)로 렌더된다
- ★서명 이미지(`imageUrl`)·`companyManager`는 건드리지 않는다
- ★공란 폭은 **실측으로 확정했다** — 공백 15개(49.5pt ≈ 17.5mm). PNG 육안검증까지 통과(2026-08-13)
- 검증: `verify-pdf-sweep.mts` 519케이스 **baseline 동일**(기존 경로 무영향 증명) + 파일럿 경로 실렌더 후 담당자 줄 문자열 확인(양성 대조 포함)

### 9-0. ★사업체 담당자 이름 — 명시적으로 전달해야 한다 (F25b)

**`companyManager.name`은 `Site.businessContactName`에서 자동으로 오지 않는다.**
`buildDocPayload`는 **서명 토큰의 `signerName`**을 쓰고, 토큰이 없으면 **빈 문자열**이다(F25b).
파일럿은 대면 전자서명을 하지 않으므로 **그대로 두면 사업체 담당자 이름이 비어 나온다.**

**파일럿 전용 경로에서 이렇게 한다**

| 항목 | 처리 |
|---|---|
| 기본정보 저장 | `Site.businessContactName`(F25) — §8-1 ③에서 운영자가 등록. ★이메일은 저장하지 않는다(§8-4) |
| PDF 표시명 | ★파일럿 payload에서 `companyManager.name`에 **`businessContactName`을 명시적으로 전달** |
| 서명 이미지 | **만들지 않는다.** 별도 대면 서명을 할 때만 기존 토큰 흐름을 쓴다 |
| `SiteContact` | **만들지 않는다** — payload에 쓰이지 않는다(F25) |

> ★위탁기관 담당자(`govAgent`)와 다르다. 사업체 담당자는 **이름을 아는** 대상이므로 공란이 아니라 **실명**을 넣는다.

### 9-1. ★위탁기관 담당자 이름 공란 — 대상 슬롯과 폭 위험

**대상 슬롯은 문서마다 다르다(F22).** 하나로 뭉뚱그리면 안 된다.

| 문서 | 라벨 | 슬롯 | 파일럿 범위 |
|---|---|---|---|
| 출근부 | `(공단/위탁기관) 담당자` | `govAgent` | ✅ |
| 훈련일지 | `(공단/위탁기관) 담당자` | `govAgent` | ✅ |
| 적응지도 일지 | `위탁기관 담당자` | `govAgent` | ✅ |
| 종합평가 | `(위탁기관) 담당자` | `agencyAgent` | ✗(파일럿 미사용) |

→ 파일럿이 뽑는 것은 **출근부 + 일지 2종**이므로 실제 대상은 **`govAgent`** 뿐이다.
   ★**`agencyAgent`는 채우지 않는다** — 종합평가 2종 전용이고 파일럿은 그 문서를 제공하지 않는다.
   ★**적응지도 일지에는 `companyManager` 슬롯 자체가 없다**(`pdfkitRenderer:466` 은 2행: 직무지도원·위탁기관 담당자).

**★폭 위험 — 실측 결과 존재하지 않았다 (2026-08-13 종결)**

공란을 넣으면 줄 폭이 늘어난다. 폭이 `right - left`를 넘으면 pdfkit이 **wrap** 하는데,
`:112`의 페이지 분할 가드는 높이를 `rows.length * 24`로 계산하므로 **한 행이 2줄이 되면 높이를 과소평가**해
서명 블록이 페이지를 넘는다(`3792360`·07-20 사고와 같은 클래스). 그래서 스윕으로 확인했고, **여유가 충분했다.**

| 문서 | 최소 폭 여유 |
|---|---|
| 출근부 | 210.4pt |
| **훈련일지** | **194.7pt** ← 가장 좁음(`:499` right = `x+W-mm(10)`, tail `(서 명)`) |
| 적응지도 일지 | 241.7pt |

★**측정 지표 함정**: 서명 줄 전체의 최소 여유는 **담당자명 줄이 지배**해 `govAgent` 공란 변화에 반응하지 않는다.
 `govAgent` 줄 폭을 직접 재야 한다(이걸 놓쳐 "확보폭 0pt" 오판을 한 번 했다).

**확정 사항**

- **ASCII 공백 15개 = 49.5pt ≈ 17.5mm.** 폭 실측: 공백 1개 3.3pt · 활자 한글 3자 32pt(11mm)
- ★**기존 `verify-pdf-sweep.mts`를 재사용하지 않는다.** 그 baseline은 담당자명이 `"김담당"`으로
  하드코딩돼 파일럿 변형과 폭이 달라 같은 기준으로 비교할 수 없다.
  → **신규 `scripts/verify-pilot-pdf.mts` + `scripts/pilot-pdf-baseline.json`**(165케이스).
  기존 자산은 **byte diff 0** 이 커밋 조건이다
- ★**양성 대조 필수** — 공백 200·400개에서 wrap이 실제로 감지되는지 확인한다("0건"이 무결인지 무감각인지 가른다)
- ★**담당자명 길이 변형(2~10자)까지 흔든다.** 파일럿은 같은 블록에서 두 줄이 동시에 길어진다
  (`govAgent` 공란 + `companyManager` 실명). 공란만 흔들면 이 조합을 놓친다
- 렌더러 상수(`cy += 24`)는 이번 범위에서 건드리지 않는다

> ★참고: 서명 **날인** 공간은 이번 범위가 아니다. 전자서명 이미지가 `(서명 또는 인)` 위에 겹쳐 그려지므로(`:127-130`)
>  그 자리가 곧 날인 자리다. 행 간격 24pt(`:133`)를 늘리는 것은 위와 같은 이유로 금지한다.

> ★파일럿 워커가 기존 `/worker/docs`로 들어가면 담당자 줄이 빈 채로 나온다. §2 (가) 기준으로 **막지 않는다.**

---

## 10. 초기화 — 레지스트리 기반 전량 삭제

**대상은 레지스트리에 기록된 것뿐이다.** 이름 접두어·생성 날짜 추정 금지(F16).
**운영 DB 전체 TRUNCATE는 이 계획에 포함하지 않는다** — 사용자가 요청한 것은 파일럿 데이터 초기화다.

### 10-0. ★★운영 흐름 — **파일럿 종료와 데이터 삭제를 분리한다**(2026-08-14 확정)

착지 경쟁을 사후 정리로 쫓지 않는다. **새 업로드가 시작될 수 없는 상태를 먼저 만들고** 지운다.

```
[1] 사전검사        데이터 무변경 — 이름 확인 · FK blocker · 레지스트리 범위. 문제가 있으면 중단
[2] 종료·계정 회수  한 트랜잭션·최초 1회: Pilot 잠금 → 범위·blocker 재확인
                    → Worker.status=PAUSED · sessionVersion+1 → 미사용 SiteSignToken 만료
                    → Pilot.quiescedAt 기록
[3] 배출 대기       quiescedAt + 15분 이전에는 삭제 API 가 거부하고 남은 시간을 돌려준다
                    ★서버 요청 안에서 기다리지 않는다 — 화면이 시각과 남은 초를 보여준다
[4] 전체 삭제       §10-1 의 3단계(수집 → DB 트랜잭션 → Storage) 그대로 수행
[5] 완료 / 재시도   잔여 0 이면 Pilot·레지스트리 삭제 · 실패·착지분이 있으면 보존하고 재시도
```

**효과** — 계정 회수 이후 참여자는 새 서명을 올릴 수 없다:
기존 세션 401(`sessionVersion`) · 재로그인 403(`login:75` status) · 공개 서명 링크 410(만료) ·
`assertPilotWritable` 이 자원 생성 거부. 남는 것은 **회수 시점에 이미 진행 중이던 요청**뿐이고,
그 수명은 유한하므로 배출 대기가 흡수한다.

- ★**배포 게이트**: 서명 업로드 3개 라우트(`worker/signature`·`sign/[token]`·`worker/docs/inperson-sign`)의
  **실제 배포 실행 상한이 대기 시간 이하인지 배포 전에 확인**하고 운영 전제로 기록한다.
  "모든 플랜에서 항상 짧다"고 쓰지 않는다 — 확인한 사실만 근거로 삼는다.
- ★**운영 규칙 의존(수용)**: 종료 후 그 워커를 **다시 `ACTIVE` 로 되돌리지 않는다.** 운영 계정 관리 API 는
  파일럿 때문에 고치지 않고, 화면과 이 문서에 경고로 남긴다(시스템 운영자 1인의 일회성 작업).
- ★**삭제 후 확인 단계는 두지 않는다.** 배출 대기가 그 역할을 대신한다 — 클릭이 세 번이 되면 안 된다.
  재나열·최종 검증 나열은 **마지막 안전망**으로 유지한다.
- 단계는 저장된 `quiescedAt` 으로 복원한다: `READY → DRAINING → PURGE_READY → COMPLETED`
  (실패 시 `RETRY_PENDING`). **화면 상태를 응답에 의존시키지 않는다.**

### 10-1. ★실행은 3단계다 — 전체를 하나의 트랜잭션으로 묶지 않는다

**Storage 삭제는 외부 HTTP 호출이라 DB 트랜잭션과 원자적으로 묶을 수 없다.**
장시간 DB 트랜잭션 안에서 Storage API를 호출해서도 안 된다(커넥션 점유·타임아웃).
**"DB 삭제 단계만" 단일 트랜잭션으로 실행한다.**

```
[1단계] DB 트랜잭션 ─ 원자적
  ① Pilot 행 잠금
  ② ★Storage 경로 확보 → PilotResource(STORAGE_OBJECT)로 기록
     (DB 행을 지우면 경로를 알 수 없다 — F20. 반드시 삭제 전에 뽑는다)
  ③ DB 자원 삭제 (10-2 순서)
  ※ 여기서 Pilot·PilotResource는 아직 지우지 않는다

[2단계] 트랜잭션 종료 후 ─ 외부 호출
  ④ Storage 객체 삭제 (signatures 버킷)

[3단계] 결과 반영
  ★★커밋 직후 **같은 prefix 를 다시 나열**해 첫 목록과 합집합한다(먼저 레지스트리에 기록).
     [1]나열~[2]커밋 사이에 착지한 서명 객체는 첫 목록에 없다.
     ★이 시점부터 **새 업로드는 시작될 수 없다** — 세 업로드 경로가 전부 업로드보다 먼저 DB 를 본다
      (`worker/signature`=checkPlanAccess 워커 조회 / `sign/[token]`=토큰 404 / `inperson-sign`=배정 해석).
     ★그래서 **운영 업로드 라우트를 고치지 않는다.** 공개 서명 라우트에 잠금·레지스트리를 심는 것은
      실제 담당자 서명 경로에 새 실패 모드를 들이는 일이고, 서명 경로가 하나 더 생기면 다시 샌다.
  ⑤ 전부 성공 → PilotResource·Pilot 삭제
  ⑥ 일부 실패 → 실패분에 deleteError 기록, 해당 행과 Pilot을 남긴다(재시도 대상)
  ★★⑦ **최종 검증 나열** — 삭제 도중 착지한 객체가 여기서 잡힌다. 남으면 완료로 보고하지 않는다.
     업로드와 DB 커밋은 원자적일 수 없어 이 꼬리를 0으로 만들 수는 없다 —
     **도구가 거짓말을 하지 않게** 하고 운영자가 재시도 한 번으로 정리하게 한다.
```

**공통 규율**

- 실행 **전에 파일럿명과 종류별 삭제 예정 건수를 출력**하고 재확인을 받는다
- 삭제 후 **잔여 0을 재조회로 확인**한다
- `scripts/_dbGuard.mts` 규율을 따르고 대상 DB를 먼저 출력한다

### 10-2. DB 자원 삭제 구조 (1단계 ③ 내부)

**Cascade가 알아서 지우는 것과 명시 삭제가 필요한 것을 분리한다.** 섞으면 순서 오류가 난다.

★★**2026-08-14 개정** — FK 전수조사(§10-5) 결과로 **명시 삭제 4건 추가 · 감사 축 재정의 · 오기 1건 삭제**.
GPT·Claude 교차검토 3라운드 + 실측으로 확정했다. 구 문안의 감사 축은 **한 건도 못 지운다**(아래 근거).

★**사용자 확정(2026-08-14) — 파생 기록도 초기화의 정식 단계다.**
정식 오픈 전 파일럿이므로 파일럿에 귀속된 `AuditEvent`·`AccessLog`·`ApiCallLog`까지 전량 삭제한다.
**단 범위는 "파일럿 귀속 행"이지 테이블 전량 비우기가 아니다** — 비파일럿 행은 건드리지 않는다
(전량 비우기를 원하면 §10-4의 별도 판단 항목으로 분리한다).

```
[사전 수집] ─ 아무것도 지우기 전에
  · 레지스트리의 모든 DB 자원 id
  · ★Cascade로 사라질 자식 중 **감사기록에 entityType 으로 남는 5종의 id**
      DailyAttendance(assignmentId IN 배정) · TraineeLog(attendanceId IN 위)
      AttendanceEditRequest(attendanceId IN 위) · DocumentRun(assignmentId IN 배정) · SiteHoliday(동)
      ★5종뿐인 이유 = 코드가 실제로 쓰는 entityType 에 없는 자식은 수집이 불필요하다.
        TraineeLogTask · DocumentVersion · DocumentSubmissionLog · AttendanceIssue ·
        SiteHolidayRequest · SiteContact · SiteBasePoint 는 감사기록에 등장하지 않는다(실측)
      ★DocumentRun.id 는 AccessLog 축에도 쓰인다
  · ★SiteSignToken.token — Storage `sign-tokens/{token}/` 의 **유일한 근거**.
      SiteAssignment Cascade 로 사라지면 그 객체는 영영 못 찾는다(F20의 실제 사례)
  · Storage prefix 나열 결과(§7 개정판)
  · ★★**이전 실행이 남긴 `PilotResource(STORAGE_OBJECT)` 를 경로로 복원해 반드시 합집합**한다.
      **이것이 없으면 재시도가 결정적으로 실패한다** — `sign-tokens/{token}/` 의 근거인 `SiteSignToken` 은
      1차 실행의 배정 Cascade 로 이미 사라져 2차 실행의 prefix 나열에서 통째로 빠진다.
      지울 게 없다고 판단해 `completed=true` 로 끝내면 **실패 기록까지 지우고** 객체는 영영 못 찾는다.
      ★삭제기가 다루지 못하는 다른 버킷 키는 조용히 흘리지 말고 **중단 사유**로 세운다
  · WorkerInvite 및 예상 밖 종속 행 조회(§10-5 preflight)
  ⚠️**삭제된 구 문안**: "Storage 경로 — DocumentVersion". `worker/docs/submit:120` 이
    `pdfUrl: ""`(sourceData 재생성 방식·파일 미저장)이라 **DocumentVersion 은 Storage 대상이 아니다.**
    없는 것을 지키느라 정작 `sign-tokens/{token}` 을 놓치고 있었다

[파생 기록 삭제] ─ ★ApiCallLog 는 부모보다 반드시 먼저
  · ApiCallLog   ★신규. agencyId·workerId 가 **둘 다 SetNull** 이라 막지도 지워지지도 않고
                 **판별 불가 상태로 잔존**한다. 부모를 먼저 지우면 null 이 되어 영영 못 찾는다.
                 `lib/logApiCall.ts:10-16` 이 워커의 ACTIVE 배정에서 agencyId 를 끌어와 기록하므로
                 파일럿 AI 음성일지 사용 시 실제로 생긴다. 축 = workerId IN(파일럿 워커) OR agencyId=파일럿 기관
  · AuditEvent   ★FK가 없어 Cascade 로 안 지워진다(F21)
  · AccessLog    ★동일

[명시 삭제] ─ 부모보다 먼저 지워야 하는 것
  · TraineeSupervision   ★RESTRICT라 SiteAssignment·TraineePlacement보다 반드시 먼저
  · TraineeEvaluation    ★★신규 — trainee·writer **양쪽 RESTRICT** 이고 Cascade 체인에 없다.
                         `app/api/worker/evaluation/route.ts:79` 에 실제 생성 경로가 있어
                         직무지도원이 한 건이라도 저장하면 Trainee·Worker 삭제가 FK 오류로 막힌다.
                         조건은 **OR**: traineeId IN(파일럿 훈련생) OR writerId IN(파일럿 워커)
                         (AND 로 묶으면 교차 연결된 행이 남아 삭제를 막는다)
  · WorkerInvite         ★근거 정정 — siteId 는 optional 이라 **SetNull** 이다(Site 삭제를 막지 않는다).
                         실제 차단 지점은 **agencyId(required→RESTRICT)**. 결론(선행 삭제)은 그대로
  · AgencyAnnouncement   ★신규 — agencyId 가 **@relation 없는 스칼라**라 FK 도 Cascade 경로도 없다.
                         Manager 부재라 0건이 정상이지만, 있으면 영구 잔존한다
  · Cascade 대상이 아닌 그 밖의 종속 행(§10-5 preflight 가 찾아낸 것)

[부모 삭제] ─ Cascade가 딸린 것을 뒤에
  · SiteAssignment
      └ Cascade: DailyAttendance → TraineeLog · DocumentRun → DocumentVersion
                 SiteHoliday · SiteSignToken
  · TraineePlacement
  · Trainee
  · Worker
      └ Cascade: WorkerNotice 등
  · Site
  · Agency
```

★**Cascade 목록은 "안 지워도 되는 것"이지 "확인 안 해도 되는 것"이 아니다.**
Cascade 로 사라지는 자식이라도 **감사기록의 근거(id)와 Storage 경로의 근거(SiteSignToken.token)** 는
사라지기 전에 확보해야 한다.

### 10-2-1. ★★감사 축 재정의 — 구 문안의 1순위 축은 항상 0건이다

`lib/audit.ts` 의 `auditActorFrom` 은 **MANAGER scope 에서만 `agencyId` 를 채운다**(:21,:23).
ADMIN(:20)도 WORKER(:24)도 `agencyId` 가 없고, **파일럿은 Manager 를 만들지 않는다.**
→ 파일럿이 만드는 `AuditEvent`·`AccessLog` 의 `agencyId` 는 **예외 없이 null** 이다.
구 문안이 1순위로 적은 "파일럿 agencyId" 축은 **0건을 잡는다.**

**AuditEvent — 2축(+보험 1)**

| 축 | 조건 | 무엇을 잡는가 |
|---|---|---|
| ① 대상 | `(entityType, entityId)` **쌍**으로 IN — 아래 11종 | 운영자 행위 전량 |
| ② 행위자 | `actorType='WORKER' AND actorId IN(파일럿 워커)` | 워커 활동 전량 |
| ③ 기관 | `agencyId = 파일럿 기관` | 실효 0건 — 보험으로만 유지 |

★**`entityId` 단독 매칭 금지.** 테이블별 id 라 값이 겹친다 — 반드시 `entityType` 과 쌍으로 건다.

**entityType 11종**(코드가 실제로 쓰는 25종 중 파일럿 도달 가능한 것만 — 실측 확정):
· 레지스트리로 즉시 확보(6종) — `Pilot` `Agency` `Site` `Trainee` `Worker` `SiteAssignment`
· 사전 수집 필요(5종) — `DailyAttendance` `TraineeLog` `DocumentRun` `AttendanceEditRequest` `SiteHoliday`
★`TraineePlacement` 는 **감사기록에 쓰이지 않는다**(훈련생 라우트가 `Trainee` 로만 기록) — 축에 넣지 않는다.

**AccessLog — 1축(+보험 1)**

| 축 | 조건 |
|---|---|
| ① 대상 | `(subjectType, subjectId)` 쌍 — `Worker` · `Trainee` · `DocumentRun` (실측 3종) |
| ② 기관 | `agencyId = 파일럿 기관` — 보험 |

★`subjectId` 는 **String 컬럼**이라 id 를 문자열로 변환해 비교한다.
★`actorType`/`actorId` 는 열람 주체가 운영자라 축이 되지 않는다.

★**구조적 예외(인지 사항, 유일)**: `subjectId=null` 인 **요약형 접속기록**은 귀속 판별이 불가능하다
(예: `admin/sites/[id]/trainees:67` → subjectId=null, label `"현장 훈련생 목록 3명"` /
`admin/system/backup:129` → `"전체 백업(근태) N건"`). 파일럿 대상자의 성명·연락처가 들어가지 않으므로
삭제 대상에서 빠지는 것이 정상이다. **"흔적 0" 의 유일한 예외로 명시해 둔다.**

★★**문자열·날짜로 로그를 찾지 않는다.** `summary contains "pilot"` 같은 조건 금지 —
축은 **id 와 (entityType|subjectType) 쌍**뿐이다(§12-5 와 같은 규율).

### 10-2-2. ★초기화 실행 자체는 감사기록을 남기지 않는다

`AuditEvent` 는 Prisma 확장 자동기록이 **아니라** 라우트가 `audit()` 를 명시 호출하는 방식이다
(`lib/audit.ts:2-3` — 미들웨어/ALS 가 행위자를 잃어 명시 방식으로 전환).
→ **초기화 경로가 `audit()` 를 부르지 않으면 그 대량 삭제는 감사행을 한 줄도 만들지 않는다.**
규율만으로 "흔적 0" 이 달성되므로 별도 장치가 필요 없다.
남기면 삭제 직후 파일럿을 가리키는 행이 다시 1건 생겨 목적과 충돌한다.
**결과(종류별 삭제 건수·실패분)는 API 응답과 화면에 전량 표시한다.**

### 10-5. ★5단계 착수 전 필수 게이트 — FK 전수조사 ✅**완료(2026-08-14)**

전용 Agency라도 **cron과 사용자 활동이 예상 밖 종속 행을 만든다.** 삭제 구현 전에 반드시 전수조사한다.

**★조사 결과(실측 확정 — 재조사 불요)**

- `prisma/schema.prisma` 2,369줄 · `references: [id]` **총 107건**
  (지시서 초안의 106건 + 2단계에서 추가된 `PilotResource.pilotId` 1건 = 일치)
- 삭제 대상 부모 **6종**(Agency·Worker·Site·SiteAssignment·Trainee·**TraineePlacement**)을 참조하는 FK = **69건**
  (5종 기준으로 세면 68건 — `TraineePlacement` 는 레지스트리 `PLACEMENT` kind 로 삭제 대상이고
   `TraineeSupervision.placementId`(RESTRICT) 1건이 이를 참조하므로 **6종·69건이 기준값**이다)

| 부모 | FK | Cascade | SetNull | Restrict |
|---|---|---|---|---|
| Agency | 22 | 1 | 7 | 14 |
| Worker | 25 | 8 | 5 | 12 |
| Site | 12 | 2 | 6 | 4 |
| SiteAssignment | 5 | 4 | 0 | 1 |
| Trainee | 4 | 0 | 0 | 4 |
| TraineePlacement | 1 | 0 | 0 | 1 |
| **계** | **69** | **15** | **18** | **36** |

★**판정 규칙**: `onDelete` 가 없으면 Prisma 기본값이 적용된다 — **필수 관계=Restrict, 선택 관계=SetNull.**
이 기본값 차이가 아래 함정의 원인이다.

**★조사에서 드러난 함정 4건**

1. **SetNull 이라 순서 위반이 에러를 안 낸다** — `Site.agencyId`·`SiteAssignment.agencyId` 는 optional 이라
   Agency 를 먼저 지워도 오류 없이 **`agencyId=null` 고아**로 남는다. `Trainee.currentSiteId` 도 동일하다.
   → 레지스트리 기반 삭제라면 안전하지만, **"삭제가 성공했으니 정리됐다"는 착각**이 가능한 지점이다.
     §10-1 의 **잔여 0 재조회**가 그래서 필수다.
2. **스칼라 컬럼을 FK로 오인하지 말 것** — `WorkerNotice.agencyId`·`DocumentRun.agencyId`·
   `AgencyAnnouncement.agencyId`·`EmploymentContract.assignmentId`·`SatisfactionSurvey.assignmentId`·
   `WorkerInvite.assignmentId` 는 `@relation` 없는 **단순 스칼라**라 삭제를 막지 않는다.
   `WorkerNotice` 는 `user Worker` 의 Cascade 로 사라지고, `DocumentRun` 은 배정 Cascade 로 사라지지만,
   **`AgencyAnnouncement` 만은 어떤 Cascade 경로에도 없어 명시 삭제가 필요하다.**
3. **RESTRICT 36건 중 Cascade 체인에도 없고 파일럿에서 실제 생성 가능한 것 = `TraineeEvaluation` 하나**(§10-2).
4. **SetNull 로 조용히 잔존하는 것 = `ApiCallLog`**(§10-2). 그 외 `ManagerSignupRequest`·`RecruitPost`·
   `TalentOffer`·`WorkerReview`·`PayContract.siteId`·`Site.mergedToSiteId` 는 **외부 행이 파일럿 자원을
   가리키는 경우**라 preflight 에서 0을 확인하고, 0이 아니면 **삭제가 아니라 중단**한다(아래).

**★preflight — 실행 시점에 실제 건수를 조회한다**

0이 아니면 [명시 삭제 승격] 또는 [중단] 둘 중 하나로 분류한다. **추정으로 건너뛰지 않는다.**

| 대상 | 예상 | 0이 아니면 | 근거 |
|---|---|---|---|
| `TraineeEvaluation` | **0 아닐 수 있음** | 명시 삭제(§10-2) | 사용성 테스트 중 작성 가능 |
| `ApiCallLog` | **0 아닐 수 있음** | 명시 삭제(부모보다 먼저) | AI 음성일지 사용 시 |
| `WorkerInvite` | 0 | 명시 삭제 | 지시서 §10-5 요구 항목 |
| `AgencyAnnouncement` | 0 | 명시 삭제 | Manager 부재 |
| `Manager` | 0 | ★**중단** | 파일럿은 Manager 를 만들지 않는다 — 있으면 설계 위반이라 사람이 판단한다 |
| `AgencyContractClause` | 0 | ★**중단** | ★Agency 필수 FK(RESTRICT) 14종 중 **초안에서 유일하게 빠져 있던 모델**. 있으면 미리보기는 통과하고 트랜잭션이 원문 FK 오류로 터진다 |
| `EmploymentContract`·`PayContract`·`PayrollRun`·`AgencyDeduction` | 0 | ★**중단** | 계약·급여 미생성(F28·F5) |
| `AnnualLeaveEntry`·`AnnualLeaveRequest` | 0 | ★**중단** | 근로계약 없으면 적립 제외(F12) |
| `SatisfactionSurvey`·`NoticeGroup`·`ManagerInvite`·`SupportTicket` | 0 | ★**중단** | Manager 부재 |
| **레지스트리 밖 자원** — 전용 기관 소속인데 레지스트리에 없는 Site·SiteAssignment·TraineePlacement | 0 | ★★**중단** | **기록 누락**이라는 뜻이다. 레지스트리가 삭제의 유일한 근거이므로 사람이 확인해야 한다 |
| **외부 참조** — 파일럿 Site/Worker 를 가리키는 비파일럿 `RecruitPost`·`TalentOffer`·`Site.mergedToSiteId` 등 | 0 | ★★**중단** | 삭제하면 **외부 운영 행이 조용히 수정**된다(SetNull) |

★`WorkerInvite` 는 **"만들지 않는다"고만 적어두지 않는다.** preflight 에서 **0건을 확인**하고,
존재하면 전용 Agency 기준으로 **삭제한 뒤** Site·Agency 를 지운다.

### 10-3. 삭제 실패 처리

- Storage 삭제는 외부 호출이라 실패할 수 있다. 실패 시 `PilotResource.deleteError`에 사유를 기록하고 **행을 남긴다**
- ★실패분이 있으면 **`Pilot`을 지우지 않는다.** 지우면 Cascade로 `PilotResource`까지 사라져 **재시도 목록을 잃는다**
- 실패분이 있으면 **초기화를 "완료"로 보고하지 않는다.** 남은 목록을 출력하고 재시도 경로를 제공한다
- ★★**보존과 소멸을 같은 "0"으로 뭉개지 않는다.** 잔여 재조회는 `Pilot`·`PilotResource` 도 **실제 건수**를
  돌려주고, 화면은 "재시도를 위해 보존"으로 따로 표시한다. 초안 구현은 이 둘을 강제로 0으로 만들어
  **"일부 실패"와 "잔여 전부 0"이 동시에 표시**됐다 — 화면이 거짓말을 한다
- ★`.catch(() => {})`로 실패를 삼키지 않는다 — 과거에 정리 코드가 실패를 삼켜 dev DB에 계정이 누적된 사고가 있었다

### 10-3-1. ★Storage 삭제는 **자체 함수**로 한다 — 운영 함수를 재사용하지 않는다

`app/api/worker/signature/route.ts:135-141` 의 `deleteFromStorage` 는 **응답의 `ok` 를 검사하지 않는다** —
4xx/5xx 도 성공처럼 지나간다. §10-3 의 "실패를 삼키지 않는다" 와 정면으로 어긋난다.

- 초기화는 **응답 코드를 검사하는 자체 삭제 함수**를 파일럿 코드 안에 새로 쓴다
- ★그 운영 함수를 **고치지도 않는다**(파일럿 때문에 운영 코드를 수정하지 않는다) → §13 백로그로 이관
- 404(이미 없음)는 **성공으로 취급**한다 — 재시도 시 멱등이어야 한다

### 10-3-2. ★부분완료 상태에서 신규 자원 생성 차단

Storage 삭제가 실패하면 **DB 자원은 이미 지워졌는데 `Pilot`·레지스트리는 남는다**(재시도 목록).
이 상태에서 운영자가 자원을 더 만들면 재시도 목록과 실제가 다시 어긋난다.

- ★**뚫리는 자원은 `Worker` 하나뿐이다.** `Site`·`Trainee`·`Assignment` 생성은 이미 삭제된
  `agencyId`/`siteId` 를 참조해 **FK 위반으로 실패**한다. 반면 `Worker` 는 **기관 FK 가 없어** 그대로 성공한다.
- ★★**개정(2026-08-14) — `deleteError` 검사만으로는 못 막는다.**
  `deleteError` 는 **Storage 삭제가 실패한 뒤에야** 기록된다. DB 삭제 커밋 직후부터 첫 실패까지는 **0** 이라
  게이트가 열려 있다. 그 사이 만들어진 자원은 마지막 `pilotResource.deleteMany({ pilotId })` 가
  레지스트리 기록까지 지워 **추적 불가능한 운영 데이터**가 된다.
- → **자원 생성 4경로 전부**가 트랜잭션 첫 구문에서 `assertPilotWritable` 을 호출한다. 세 겹이다:
  ① `SELECT … FROM pilots … FOR UPDATE` — 초기화의 DB 삭제 트랜잭션과 **같은 행 잠금**(트랜잭션 구간을 덮는다)
  ② **전용 Agency 실물 존재 확인** — 잠금이 못 덮는 **Storage 삭제 구간**(기관은 없고 Pilot 은 있는 창)을 막는다
  ③ `deleteError` 잔존 검사 — 재시도 대기 상태
  ★①②는 **둘 다 필요하다.** 하나만으로는 각각 트랜잭션 밖·안의 창이 열린다.
- `deleteError`·기관 존재는 **파생 상태**이므로 §7의 "상태 머신 없음"을 깨지 않는다(새 필드·새 전이 없음).
- ★초기화가 자원 증가를 감지하면(`SCOPE_CHANGED`) **안전하게 중단**하고 재시도로 마무리한다 — 정상 동선이다.
- ★★**범위 지문에 서명 경로를 포함한다.** id 만 비교하면 "[1]나열 → 참여자가 서명을 새로 저장 → [2]통과 →
  Worker 삭제" 순서에서 **새 객체가 나열 결과에도 레지스트리에도 없어 영구 잔존**한다(파일럿이 지워지면
  prefix 를 나열할 근거조차 없다). 포함하면 이 경우가 `SCOPE_CHANGED` 로 중단되고 재실행이 잡는다.

### 10-4. 초기화 범위 밖 (인지 사항)

- **`backups/` JSON** — `reset-data-keep-admin.mts`를 별도로 돌린 적이 있으면 그 백업에 파일럿 데이터가 들어 있다. **로컬 파일이므로 해당 파일을 직접 삭제**한다
- 실운영 개시 전 **DB 전량 초기화**를 원하면 별도 판단으로 수행한다. 그 경우 F17 때문에 급여 참조 재시드가 필요하다:
  `seed-insurance-rates.mts` · `seed-income-tax.mts`

---

## 11. 파일럿 운영 절차

```
운영자: 파일럿 생성 → 사업체·훈련생 → 참여자 계정 발급(비번 1회 표시) → 배정(면제) 기간 설정
  → 직무지도원 로그인 → 출근부 일괄 작성 → 일지 작성
  → 파일럿 문서 경로에서 출근부·일지 미리보기/다운로드
  → 대면·전화로 의견 청취
  → 전체 초기화
```

**운영 환경이라 인지할 것**

| 항목 | 실제 동작 | 대응 |
|---|---|---|
| 외부 발송 | **켜져 있다**(F3) | **공단 이메일 발송 버튼을 누르지 않는다**(매니저 직접 발송은 F8로 어차피 400) |
| 일일 cron | 돈다 — 면제 배정에 근무일이 자동 생성된다(F6) | 파일럿에는 편리하다. 초기화로 함께 사라진다 |
| 급여 DRAFT cron | 기관 플랜 STANDARD면 걸러진다(F5) | 추가 조치 불필요 |
| 연차 자동적립 | 근로계약이 없으면 후보에서 빠진다(F12) | 근로계약을 만들지 않는다 |

---

## 12. 금지 사항

1. 이 문서의 범위를 넘는 개선·리팩터링·재설계 금지. 발견 사항은 `docs/TODO_2026_08_11.md`에 **한 줄로만** 적는다.
2. `lib/payroll/**`·`lib/leave/**`·`app/api/cron/**`·`app/api/admin/docs/**`·`app/api/worker/docs/**`·`lib/pdf/**` **편집 금지**(§2에서 (다)를 승인하면 그 범위만 예외).
3. 운영 테이블에 파일럿 컬럼 추가 금지. 레지스트리는 단방향 참조만 한다(§7).
4. **평문 비밀번호를 DB에 저장 금지**(§8-1).
5. 이름 접두어·생성 날짜 기반 삭제 금지(F16). 명시적 ID·경로만 쓴다.
6. `_prisma_migrations` 행 직접 삭제 금지(§6-3).
7. 삭제 실패를 `.catch(()=>{})`로 삼키기 금지(§10-3).
   ★**DB 트랜잭션 안에서 Storage 등 외부 API 호출 금지**(§10-1) — 3단계로 분리한다.
   ★**운영 Storage 함수 재사용 금지**(§10-3-1) — `deleteFromStorage`는 `ok`를 검사하지 않는다.
   ★**초기화 경로에서 `audit()` 호출 금지**(§10-2-2) — 삭제 직후 파일럿을 가리키는 감사행이 다시 생긴다.
   ★**감사·접속 기록을 문자열·날짜로 찾기 금지**(§10-2-1) — 축은 id와 (entityType|subjectType) 쌍뿐이다.
8. 파일럿에 **이메일 수신처 저장 금지**(§8-4). 기존 Worker의 `planType`·`status` **변경 금지**(§8-3).
8. 운영 DB 마이그레이션·`vercel --prod` 배포 금지(별도 승인 사항).
9. `git push --force`·이력 재작성 금지. 되돌림은 **새 커밋**으로 남긴다.

## 13. 백로그로 이관 (이번 작업에서 고치지 말 것)

- **F2 운영 버그**: 비파일럿에서도 문서 미리보기와 다운로드의 위탁기관 담당자명이 어긋난다.
- **F8 의존성**: 매니저 직접 PDF 이메일 차단이 기존 서명 게이트에 얹혀 있다. 그 라우트에 매니저 서명 주입이 추가되면 열린다.
- `admin/workers/invite/route.ts:33-35` 주석 허위(소비측 정원검사 호출 0건).
- `/worker/docs` 인라인 미리보기가 CSP `object-src 'none'`에 차단된다(`page.tsx:571`). `/worker/docs/view`는 정상.
- `.mts` 스크립트에서 `lib/*.ts` named import 런타임 실패(리포 전역 조건).
- **운영 버그**: `worker/signature/route.ts:135-141` `deleteFromStorage`가 응답 `ok`를 검사하지 않아
  Storage 삭제 실패가 조용히 성공 처리된다(서명=개인정보가 버킷에 잔존). 파일럿은 자체 함수로 우회(§10-3-1).
- **운영 갭**: 같은 파일 `:90` 의 DB 갱신이 실패하면 방금 올린 서명 객체가 고아로 남는다(보상 삭제 없음).
  `sign/[token]:121-129`는 같은 상황을 이미 보상 삭제한다 — 규율이 두 라우트에서 갈린다.

---

## 14. 착수 순서

**★§2(UI 격리 + 운영 통제) 확정 완료 — 착수 차단 조건 없음.**

```
1) §6 되돌림 + dev DB 정리 + §6-4 검증 → 커밋 (여기까지가 원복)   ✅ 2026-08-13 완료 `2303d7b`
2) §7 레지스트리 스키마 + 마이그레이션 → 커밋                     ✅ 2026-08-13 완료 `b866841`·`dc803b2`
3) §8 /admin/pilots 일괄 설정 화면 + 전용 자원 생성 API → 커밋     ✅ 2026-08-13 완료 `9cf0b57`·`1841901`
4) §9 파일럿 전용 문서 경로 → 커밋                                 ✅ 2026-08-13 구현·검증 완료
   ★남은 것 = 3종 실렌더 시각검증 → 통과 후 `--baseline` 기록
5) §10 초기화 → 커밋 (Storage·감사기록 포함)                       ← 진행 중
   ✅ 5-0 §10-5 FK 전수조사 게이트 완료(2026-08-14) — 결과는 §10-5에 확정 기록,
        그 결과로 §7·§10-2·§10-3·§12·§13 정정(보완 9건)
   ▸ 5-A 초기화 서비스 + API(미리보기·실행) + 검증 스크립트
   ▸ 5-B 화면(초기화 카드) + 시각검증
```

**★5단계 실행 순서(§10-2 개정 반영 최종판)**

```
[사전 수집]  레지스트리 id + 자식 5종 id + SiteSignToken.token + Storage prefix 나열 + preflight
[파생 삭제]  ApiCallLog → AuditEvent → AccessLog        ★ApiCallLog는 부모보다 먼저 필수
[명시 삭제]  TraineeSupervision → TraineeEvaluation → WorkerInvite → AgencyAnnouncement
[부모 삭제]  SiteAssignment → TraineePlacement → Trainee → Worker → Site → Agency
[Storage]    ★트랜잭션 밖에서 삭제(자체 함수·응답 검사·404는 성공)
[마무리]     전부 성공 → PilotResource·Pilot 삭제 / 실패분 있으면 보존 + deleteError
             ★어느 경우에도 audit() 호출 없음
```

각 단계는 **독립 커밋**으로 남긴다.

### 14-1. ★2단계 마이그레이션 검증 절차

새 마이그레이션이 **레지스트리 2테이블만** 만드는지 적용 **전에** 확인한다.

1. 생성된 SQL을 **적용 전에 육안 검토**한다
   · 허용: `CREATE TYPE`(enum) · `CREATE TABLE pilots` · `CREATE TABLE pilot_resources` ·
     **두 테이블 사이의** FK와 인덱스
   · ★**기존 테이블을 대상으로 한 `ALTER`/`DROP`이 한 줄이라도 있으면 즉시 중단**하고 보고한다
2. 적용 후 `prisma migrate status` 정상
3. `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --exit-code` **종료 코드 0**
4. `npx tsc --noEmit` 0 · `npx vitest run` 무감소
5. 독립 커밋 후 **push 없이** 보고
