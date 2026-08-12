# 작업 현황 — 직무지도원 문서서비스 파일럿 (2026-08-12 ~ 08-13)

> 구현 기준 문서 = `docs/PILOT_DESIGN_2026_08_12_v1_8.md` (v1.7은 검토 이력용)
> 이 문서 = **구현 세션 기록 + 남은 일**. 설계 근거는 v1.8, 제거 절차는 v1.8 §17을 본다.

**결론: v1.8 §12의 9단계 전량 구현 완료 · `82ca783..e29e702` 포함 전 커밋 push 완료 · 미푸시 0 · 작업트리 clean.**
**남은 일 = 시각검증 2건 + 운영 마이그레이션 + 운영 배포 (전부 별도 승인 사항).**

---

## 1. 커밋 이력 (구현 순서)

| 커밋 | 단계 | 내용 | 규모 |
|---|---|---|---|
| `8da3c30` | — | 설계 v1.8 확정(범위 재한정본) | 문서 |
| `073ce08` | 1 | `TraineeSupervision` 신설 + 기간 불변식 | 6파일 +891 |
| `7299f60` | 2 | `PilotSession`·`PilotParticipant`·`PilotParticipantTrainee` 스키마 | 3파일 +597 |
| `059a9c1` | 3 | 초대 발급 + 수락/연결 트랜잭션(신규·기존 Worker 양쪽) | 9파일 +1,124 |
| `3182762` | 4-A | 운영자 파일럿 관리 서버경로 | 13파일 +2,248 |
| `a8418db` | 4-B | 운영자 파일럿 관리 화면 | 14파일 +1,690 |
| `f8353a6` | 5·6 | 파일럿 기능 권한 + 문서 외부 유출 차단 | 9파일 +615 |
| `82ca783` | — | `[PILOT]` 마커 주석 + 설계문서 구현 반영 | 13파일 +210 |
| `c106595` | 7 선행 P0 | 출근부 페이지 분할 스윕 519케이스 + baseline | 2파일 +7,075 |
| `d40ec8f` | 7 | PDF 위탁기관 담당자명·수기 공란 | 4파일 +237 |
| `58a1deb` | 8-A | 운영자 근무일 확인·정정 서버경로 | 4파일 +644 |
| `48426c3` | 8-B | 운영자 근무일 확인·정정 화면 | 2파일 +256 |
| `6791d8b` | 9 | 파일럿 데이터 폐기 | 4파일 +695 |
| `e29e702` | — | 9단계 완료 반영 + 제거 가이드 갱신 | 문서 |

★ **고아 해시 참조 금지** — amend로 사라진 해시가 다수 있다(`64a6c70`·`237bf2f`·`f8c0f6b`·`715ca41`·`5d63be3`·`28211ff`·`aee9678`·`37bbb54`·`edc46ac`·`bf13ca7`·`6f4b864`·`34800f5`). 위 표의 해시만 실재한다.

---

## 2. 단계별 결과 요약

### 1단계 — `TraineeSupervision` (D-1 선행분)
직무지도원-훈련생 전담 관계 + 기간 불변식. `withTraineeLock`/`acquireTraineeLock(tx)` NS=4 추가.
`closeTraineeSupervision`은 판별 결과형 + 원자 CAS(락 불요 — 기간 축소만이라 겹침을 새로 만들지 않음),
`createTraineeSupervisionInTx(tx)`는 3단계 수락 트랜잭션 합류용.

### 2단계 — 파일럿 스키마
DB 방어선 2종을 실증했다: **전역 ACTIVE 회차 1개 partial unique**, **발급자 XOR CHECK**.
기존 데이터 영향은 `worker_invites.created_by_manager_id` NOT NULL 해제 1건뿐(운영자 발급 초대 때문).

### 3단계 — 초대 발급·수락·연결
`lib/pilot/issueInvite.ts`·`acceptInvite.ts`·`connectInvite.ts`. 라우트는 인증·입력·HTTP만 담당하고
검증 스크립트가 실서비스를 직접 호출한다(재현 코드 0).
★ **이 단계 결함 3건이 전부 같은 클래스 = "검사와 쓰기의 분리"**(수락 500·발급 고아초대·연결 부분커밋).

### 4단계 — 운영자 관리 화면 (4-A 서버 / 4-B 화면)
`acquirePilotSessionLock` NS=5 신설, 전역 락 순서를 **회차 → [site|post] → worker → trainee**로 확장해
5경로(전이·발급·수락·연결·취소)를 같은 축에서 직렬화했다.
4-B는 **파일럿 전용 사업체 폼을 폐기하고 기존 `/admin/sites/new`를 재사용**하는 방향으로 전환했다
(`?pilotSessionId=&returnTo=`). 폼이 두 벌이면 한쪽에서 기능이 빠진다는 것이 주소검색 누락의 실제 원인이었다.

### 5·6단계 — 권한과 차단
- **권한(5) = 앱 코드 변경 0.** 파일럿 참여자는 기존 `worker.planType`(운영자 개인 부여) 경로로 통과한다.
  `planGuard.ts:123` 주석이 명시한 "초기 직무지도원 테스트/특례용" 경로가 정확히 이 용도로 이미 있었다.
- **차단(6)만 기존 파일 편집.** 제출 403 / `sendEmail` 요청만 403(생성·다운로드는 허용) /
  공단 발송은 파일럿 run이 1건이라도 섞이면 묶음 전체 403 / 화면 문구 대체.
- ★ **기존 Worker의 planType은 건드리지 않는다**(폐기 시 원래 등급 복원 누락 위험).

### 7단계 — PDF 담당자명·수기 공란 (+ 선행 P0)
- **P0 스윕**: 28~200일 × 시작요일 3종 = **519케이스**. pdfkit 프로토타입을 **스크립트에서만** 래핑해 관측
  (앱 무변경). baseline은 **전 항목 0 · 최대 4페이지** — `3792360` 서명부 가드가 전 구간 유지됨을 최초 실측.
  ★ 양성 대조가 감지기 결함을 잡았다(blockSplit이 `min(서명페이지)` 비교라 블록이 페이지를 걸쳐도 통과 →
  "구성요소 전체 페이지 집합 == 1"로 정의 수정).
- **구현**: 슬롯 매핑은 기존 코드가 이미 §9와 같아 무변경, 렌더러도 무변경.
  수기 공란은 ASCII `_`만 사용(전각은 HCR 글리프 누락 시 두부).
  ★ preview는 매니저 displayName, generate는 빈 값으로 **원래 어긋나 있었다** → 파일럿만 단일 함수로 통일.

### 8단계 — 운영자 근무일 확인·정정
`lib/pilot/workday.ts` + `/api/admin/pilots/[id]/workdays`(GET·POST)·`/[attendanceId]`(PATCH·DELETE) **전부 신규**.
기존 근태 경로는 무변경. 모든 쓰기가 `loadPilotAssignment`를 통과해 비파일럿·타 회차는 NOT_PILOT.
★ **삭제가 위험 지점**: `TraineeLog.attendanceId`가 Cascade라 일지가 조용히 동반 삭제된다
→ 기본 409 차단 + 건수 안내 + force 옵션, 목록이 `linkedLogs` 노출.

### 9단계 — 폐기
삭제 순서 = 참여자조인 → supervision(RESTRICT라 배정보다 먼저) → invite(site FK라 Site보다 먼저)
→ 배정(근태·일지·문서·서명토큰 Cascade) → 재적 → 훈련생 → 현장.
신규 Worker는 **PAUSED + sessionVersion**(hard delete 금지), 참여 이력은 보존 + FK null + `purgedAt`.
★ 검증이 분류기 결함 2건을 잡았다: ①같은 폐기로 함께 사라질 것을 "참조"로 세어 파일럿 훈련생이 영원히
안 지워지던 것 ②`TraineeEvaluation`에는 `assignmentId`가 아예 없다(가정 오류).

---

## 3. 검증 현황 (2026-08-13 기준)

| 항목 | 결과 |
|---|---|
| `npx tsc` | 0 |
| vitest | 436 |
| `next build` | 0 |
| PDF 스윕 | 519케이스 baseline 동일 |
| 라우트 HTTP 스모크 | 49/49 (`smoke-pilot-admin-api` + `smoke-pilot-capability-api`) |
| 단계별 dev 통합 | 1단계 25 · 2단계 20 · 3단계 42 · 4단계 69 · 5·6단계 15 · 7단계 12 · 8단계 24 · 9단계 32 |
| dev DB 잔여물 | 0 |

시각검증 완료분: 4-B 운영자 화면 전 흐름(회차 생성 → 사업체 → 훈련생 → 참여자 → 초대 발급),
비파일럿/파일럿 `/worker/docs` 문구 대조, 파일럿 워커 PDF 실렌더.

---

## 4. 남은 일

### 4-1. 시각검증 2건 (구현은 끝났고 화면 확인만 남음)
- [ ] **8-B 근무일 확인·정정 카드** — 목록·추가·수정·삭제(일지 연결 시 409 → force)
- [ ] **9단계 폐기 카드** — 미리보기 건수 → 실행 → 보존 항목 표시

★ **선행 필요**: 확인용 dev 픽스처를 정리했으므로 **재생성해야 한다**.
카드가 활성화되려면 **ACTIVE 회차 + 수락 완료 참여자 + `createdAssignmentId`** 가 있어야 한다.
★ **전역 ACTIVE 1개 제약** 때문에 확인 후 픽스처를 반드시 정리한다 — 남기면 다른 verify 스크립트가 줄줄이 실패한다.

### 4-2. 운영 반영 (별도 승인)
- [ ] **운영 DB 마이그레이션 미적용** — `20260812120000_add_trainee_supervision`,
      `20260812130000_add_pilot_session`. 단계 완료와 분리해 별도 승인으로 진행(v1.8 §12 말미 규칙).
- [ ] **운영 배포 미실행** — master push는 자동배포가 없다. `vercel --prod` 수동(CLI 56.4.1 핀).

### 4-3. 백로그로 이관한 것 (파일럿 범위 밖)
- `/worker/docs` 인라인 미리보기가 **CSP `object-src 'none'`에 차단**된다
  (`page.tsx:571`의 `<object data:application/pdf;base64,…>`). 서버 로그 `[csp-report]` 실측.
  별도 화면 `/worker/docs/view`는 iframe+same-origin이라 정상이므로 §1-5 요구는 충족.
  CSP enforce 전환(`721423e`, 07-14) 이후 계속 죽어 있던 것으로 추정.
- **비파일럿** preview/generate 담당자명 불일치(7단계에서 파일럿만 통일).
- `admin/workers/invite/route.ts:33-35` **주석 허위** — "소비측도 checkSiteCapacity 이중방어"라 주장하나 호출 0건.
- 파일럿 권한 조이기(§7 3기능 한정) — planType 채택으로 불필요해져 드롭.
- `.mts` 스크립트에서 `lib/*.ts` named import 런타임 실패(리포 전역 조건).

---

## 5. 제거 용이성 (실측)

- **신규 파일 39개** = 삭제로 끝(`app/admin/pilots`·`app/api/admin/pilots`·`lib/pilot`·`lib/trainee/supervision.ts`·verify/smoke 스크립트).
  단 **PDF 스윕과 baseline은 파일럿 전용이 아니므로 남긴다**(회귀 감시 자산).
- **기존 파일 편집 12개** 중 9개가 순수 가산 — `if (pilot…)` 블록 + import만 제거하면 원복.
  손대야 하는 것은 3개: `worker/docs/page.tsx`(문구 복원) · `admin/sites/new/page.tsx`(Suspense 구조 분리) ·
  `worker/assignment/connect`(분기 블록).
- 전 편집 지점이 **`pilot|파일럿` grep으로 100% 회수**되고, `★[PILOT] ~ ★[PILOT] 끝` 마커 주석이 붙어 있다.
- DB는 신규 테이블 4개 + **nullable** FK 7컬럼이라 DROP만으로 원복, 기존 행 영향 0.
  유일한 제약 = `worker_invites.created_by_manager_id` NOT NULL 복구는 **운영자 발급 초대(NULL 행)를 지운 뒤**에만 가능
  (9단계 폐기가 그 순서를 만든다). 컬럼을 그냥 남겨도 nullable이라 무해.

---

## 6. 이 세션에서 확립된 규율 (재발 방지)

1. ★★★ **파일럿 때문에 기존 운영 코드를 고치지 않는다.** 착수 전 "기능 추가냐 차단이냐"를 먼저 분류한다 —
   **추가는 기존 메커니즘으로 우회 가능**(planType), **차단만 불가피**하다.
   ★ "새 라우트를 파면 되지 않나"가 안 되는 이유 = **새 라우트는 기존 라우트를 막을 수 없다.**
2. **파일럿은 기존 운영 화면을 그대로 쓰고 프로세스만 바뀐다.** 4-B가 길어진 원인은 기존 화면을 안 보고
   새로 짜서 두 번 만든 것(사업체 폼·`window.prompt`).
3. **테스트 코드도 변경분 전량 정독 + "주장 대 증명" 대조** — 동시성 주장이 정말 병렬인지, 테스트 이름과
   검증 대상이 일치하는지, 실패해야 할 때 실제로 깨지는 설계인지, 양성 대조가 있는지.
4. **상태 왕복 짝짓기** — 만든 것↔되돌리는 것 / 잠근 것↔그 락을 쓰는 다른 경로 / 터미널 상태↔그 상태를 만드는 작업 /
   DB 최종방어선↔패자 경험(409인가 500인가).
5. **성공 경로에서만 도는 정리 코드는 정리 코드가 아니다** — 픽스처 생성을 `try` 안으로, 정리는 null-safe.
6. ★ **Prisma `startsWith`는 `_`를 LIKE 와일드카드로 넘긴다** — `"__"` 패턴이 한글 기관명까지 매칭한다.
   이름 패턴 일괄 삭제 금지, **전량 조회 후 JS 판정 · 생성 시 보관한 id로만 삭제**(`scripts/_cleanupGuard.mts`).

### 도구·환경 함정
- **dev 서버가 Prisma 엔진 DLL을 잠가 `next build`가 EPERM으로 실패** → 빌드 전 dev 종료.
- **BigInt 리터럴(`123n`)은 `next build`에서 막힌다**(`npx tsc`는 통과 — 게이트가 다르다).
- **Chrome 내장 PDF 뷰어가 뜨면 CDP `Page.captureScreenshot`이 30초 타임아웃**(렌더러 프리즈로 오인).
  복구는 페이지 이동. 서버 로그로 200을 먼저 확인하면 오판을 피한다.
- **`window.prompt`는 렌더러를 30초 완전 정지**시킨다(Escape 무효) — 인라인 입력으로 대체했다.
- grep 시 **`**/*.ts` glob은 `.mts`를 놓친다**(tsconfig include에 `**/*.mts`가 있어 tsc 게이트가 깨진다).
- 로컬 `.env`의 Upstash가 **운영과 동일 인스턴스**라 dev 로그인 반복 실패가 운영 계정 예산을 깎는다.

### 코드 실측 사실 (재조사 불필요)
- `SiteAssignment` → Worker 관계명은 `worker`가 아니라 **`user`**.
- `Trainee` 필수 = name·gender·disabilityType·severity이고 **`agencyId`가 없다**(site 경유).
- `TraineeLog` = attendanceId·traineeId·**writerId**·trainingType (assignmentId·logDate 없음).
- `DailyAttendance` → TraineeLog 관계명은 **`logs`**.
- `TraineeEvaluation`에는 **`assignmentId`가 없다**.
- `WorkerStatus`에 **INACTIVE가 없다**(ACTIVE/RESIGNED/PAUSED).
- 급여명세서(`pdfkitRenderer:643-780`)에는 **서명란 자체가 없다**.
- `resolveDocAssignment`는 소유하지 않은 명시 배정 id를 **거부가 아니라 본인 활성 배정으로 폴백**한다.
- worker축 `checkPlanAccess` 호출부는 preview·generate·signature·inperson-sign·ai×2·export **7곳**이 전부.
  `TRAINEE_REPORT`·`AUDIT_PACKAGE`·`DOC_INBOX`는 기관축(`checkAgencyPlanAccess`)이라 `worker.planType`과 무관.

---

## 7. 재개 절차

```
1) dev 서버 기동 (build 돌릴 때는 반드시 종료)
2) 파일럿 픽스처 생성 — ACTIVE 회차 + 수락 참여자 + createdAssignmentId
   (scripts/verify-pilot-workday.mts · verify-pilot-purge.mts의 셋업 로직 참고)
3) /admin/pilots/[id] 진입 → 근무일 카드 · 폐기 카드 시각 확인
   (운영자 콘솔은 데스크톱 전제 — 360px 기능 동등성 확인 불필요, 레이아웃 붕괴만 본다)
4) 픽스처 정리 (전역 ACTIVE 1개 제약 때문에 필수)
5) 운영 마이그레이션 · 운영 배포는 사용자 승인 후
```

관련 문서: `docs/PILOT_DESIGN_2026_08_12_v1_8.md`(§12 단계·§16 시각검증 기록·§17 제거 가이드) ·
`docs/TODO_2026_08_11.md`(전체 백로그) · `docs/ui-guidelines.md`
