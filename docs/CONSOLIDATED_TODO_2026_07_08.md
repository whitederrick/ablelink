# 통합 코드리뷰 TO-DO (2026-07-08)

두 독립 리뷰를 교차 대조·중복 병합한 실행 목록. 기준: master `d8e75d1` (tsc0·vitest 통과).

- **출처 태그**: `[C]` codex · `[W]` claude(web, `docs/CODE_REVIEW_FULL_2026_07_08.md`) · `[C+W]` 양쪽 지목(고신뢰)
- **⚠️정책**: 노무사/사용자 확정 후 착수(임의 수정 금지)
- 미수정 상태. 착수 전 이 목록으로 순서 합의.

---

## P0 — 즉시 (데이터 유출 / 무결성)

- [ ] **P0-1 크로스테넌트 IDOR — 타 기관 훈련생 일지 열람** `[W]` `app/api/admin/logs/route.ts:33-34`
  - 객체 리터럴에 `writerId` 두 번 스프레드 → 뒤 값이 이겨 에이전시 필터 소멸. 매니저가 `?workerId=`로 타 기관 훈련생 PII(이름·성별·일지·점수·현장) 열람. workerId 순차라 열거 용이.
  - **수정**: 두 조건을 하나의 `writerId`로 병합 — `workerId`는 `allowedUserIds` 포함 검증 후 미포함이면 거부. (1줄급)
- [ ] **P0-2 AI 일괄 일지 날짜 −1일 오염** `[W]` `app/worker/worklog/batch/page.tsx:279-283,303-310`
  - `toISOString().slice(0,10)`가 KST 자정을 UTC로 변환 → 하루 앞. 월요일분이 일요일 날짜로 기록, 공휴일 제외도 오동작. 서버가 재검증 없이 전파.
  - **수정**: 로컬 성분 조립(`${y}-${pad2(m)}-${pad2(d)}`). (1함수)

---

## P1 — 돈 / 법 / 문서 무결성 / 온보딩

### 결제
- [ ] **P1-1 최초 결제 orderId 비결정적 → 이중청구/결제후 FREE** `[W]` `app/api/payments/billing/route.ts:87,91,123`
  - `Date.now()` orderId + 과금 성공 후 DB update. update 실패 시 돈 나갔는데 FREE, 재시도 시 토스가 중복 못 걸러 2회 청구. 크론은 이미 결정적 `{id}_{YYYYMM}` 사용.
  - **수정**: 빌링키→DB 선저장→결정적 orderId 과금→플랜반영. 과금후 DB실패 시 토스 취소 보상.
- [ ] **P1-2 charge 중복 orderId 오분류 → 결제고객 FREE 강등** `[W]` `app/api/payments/charge/route.ts:98-108`
  - 성공 후 크래시 재시도 시 토스가 중복 orderId를 4xx 거절→transient 아님→else에서 FREE 강등. **수정**: 토스 중복코드=성공 간주 or 결제조회 API 확인.

### 동시성 — 이중배정/이중생성 (클러스터)
- [ ] **P1-3 매칭 수락 더블탭 → 이중배정** `[C+W]` `app/api/worker/recruit/offers/route.ts:58,73,93`
  - 상태검사·중복검사가 tx 밖, `talentOffer.update`에 `status:"PENDING"` 조건 없음. 더블탭 시 ASSIGNED 2행→출근부/급여 이중. Site도 중복생성 가능.
  - **수정**: `updateMany({where:{id,status:"PENDING"}})` claim, count=0 중단. Site find-or-create=`recruitPost.updateMany({where:{id,siteId:null}})`.
- [ ] **P1-4 직접배정 findFirst 후 create 레이스** `[C]` `app/api/admin/assignments/route.ts:188,310` + partial unique 부재 `schema.prisma:314`
  - 동시 요청 둘 다 통과→중복 활성배정. **수정**: PG partial unique index or 워커단위 advisory lock/transactional claim.
- [ ] **P1-5 배정 상호배제 TOCTOU — 6경로 공통** `[W]` respond/finalize/직접배정/서명 write-back/offers/recruit-applications
  - 겹침검사와 승격 사이 직렬화 없음, SiteAssignment 배제제약 없음. **수정**: 워커단위 `pg_advisory_xact_lock`으로 6경로 일괄 방어(P1-3/P1-4 상위 해법).
- [ ] **P1-6 관리자 초대 토큰 동시요청 → 여러 활성 Manager** `[C]` `app/api/manager/invite/[code]/route.ts:65,131,143`
  - `usedAt:null` 조건 없이 id로만 update. 동일 링크 동시 POST 시 Manager 다수 생성. **수정**: `updateMany({id, usedAt:null, expiresAt:{gt:now}})`로 원자적 선claim 후 생성.

### 온보딩/프록시
- [ ] **P1-7 `/manager/invite/[code]` 프록시 차단 가능** `[C]` `proxy.ts:77,113`
  - `/manager/login`만 예외, matcher `/manager/:path*`라 초대 온보딩 링크가 로그인 리다이렉트될 수 있음. **수정**: `/manager/invite/`를 공개 예외에 추가.

### 급여/근태 무결성
- [ ] **P1-8 endTime 없는 행 확정 허용 → 과지급·문서 불일치** `[W]` `app/api/worker/attendance/confirm-month/route.ts:21-30` (+`[id]/confirm`)
  - `startTime`만으로 확정 → 퇴근미실행·WORKING 행이 급여 모집단 진입. DAILY 일급 전액 과지급, 출근부는 '보정대기(0h)'로 불일치, WORKING→DONE 시 퇴근 영구 불가. **수정**: `endTime:{not:null}` + `status:"DONE"`(또는 `workDate<todayKST`).
- [ ] **P1-9 급여 재계산 delete가 FINALIZED 삭제 창** `[W]` `app/api/admin/payroll/runs/route.ts:82`
  - `delete({where:{id}})` status 무조건. 재계산↔확정 동시 시 확정급여+명세서 소실. **수정**: `deleteMany({where:{id, status:{not:"FINALIZED"}}})`.

### 문서 무결성
- [ ] **P1-10 재제출 시 매니저 서명 미초기화 → 무검토 발송** `[W]` `app/api/worker/docs/submit/route.ts:120-123`
  - 재제출이 서명 필드 미초기화, send 게이트가 스테일 `managerSignatureUrl`로 통과→매니저가 본 적 없는 v2에 구 서명 날인·공단 발송. 반려 후 재제출도 재검토 없이 발송.
  - **수정**: 재제출 update에 `managerSignatureUrl/managerSignedAt/managerSignerName:null`. 근본=서명을 DocumentVersion 귀속 또는 send 게이트를 `signStage==="MANAGER_SIGNED"`로.

### ⚠️ 급여 정책 클러스터 (노무사/사용자 확정 후 일괄)
- [ ] **P1-11 월 경계 주(週) 주휴수당 양쪽 달 미지급** `[W]⚠️` `lib/payroll/computeRun.ts:410` · `weeklyHoliday.ts:155`
  - 급여월 출근만 로드해 개근판정이 월별로 쪼개짐. 경계주 상시 미지급(주≈55,000원). **결정**: 주의 귀속 월 정책 → 경계주 인접월 함께 로드 or 한쪽 런서 전체 주 판정.
- [ ] **P1-12 주휴 고정액=시급×8h 시드 → 단시간 ~45% 과지급** `[W]⚠️` `app/api/worker/contracts/route.ts:263` · `payroll/contracts/backfill:59` · 매니저 폼 기본값
  - `flatWeeklyHolidayPay>0`이면 비례산식 무시·고정액. AM/PM 5.5h 워커에 주40h값 지급. **수정**: 시드를 `null`(자동산식) 또는 계약 주소정시간 비례. (P1-11 과소와 상계 아님)
- [ ] **P1-13 MONTHLY 개근월 휴일근로 1.0 미가산 / 209h 고정** `[W]⚠️` `computeRun.ts:316-371`
- [ ] **P1-14 같은날 2배정 workedDays=2** `[W]⚠️` `computeRun.ts:224` — 명세서 (N)일·DAILY 일급·보험 8일판정 인플레. `new Set(workDate).size`. (반일 2건=1일급? 정책)
- [ ] **P1-15 주휴 게이트 incomeType 불일치** `[W]` `computeRun.ts:396` — 공제는 `elig.incomeType` 전환되나 주휴는 `contract.incomeType` → 계약有+BUSINESS 워커 주휴 미지급. `elig.incomeType`으로 통일. (정책 아님, 확정 수정 가능)

---

## P2 — 동시성 / 멱등 / 문서·발송 / 보안

### 토큰/멱등
- [ ] **P2-1 sign-self 토큰 조회 후 삭제 레이스** `[C]` `lib/selfSignToken.ts:36,47` · `app/api/sign-self/[token]/route.ts:37` — Redis GETDEL/Lua로 소비-반환 원자화 + 토큰/IP 레이트리밋.
- [ ] **P2-2 만족도 조사 토큰 비원자 + 레이트리밋 부재** `[C+W]` `app/api/survey/[token]/route.ts:48,90` — 동시 POST 중복응답/중복알림. `updateMany({id,status:"PENDING"})` count확인 + 공개토큰 레이트리밋.
- [ ] **P2-3 cron 만족도 중복 발송** `[W]` `cron/daily:231-258` — `SatisfactionSurvey.contractId` unique 없음. partial unique or 배치 advisory lock. (SURVEY_AUTO_SEND 기본 OFF)
- [ ] **P2-4 워커 배정 응답 updateMany.count 무시 → 유령 성공** `[C]` `app/api/worker/assignment/respond/route.ts:76,127,141` — count 확인 없이 audit/notice/성공. 경합 시 0건인데 성공. **수정**: count 검사 후 분기.
- [ ] **P2-5 cron 사용완료 서명토큰 삭제** `[W]` `cron/daily/route.ts:107` — `usedAt` 조건 없어 서명완료 토큰도 7일 후 삭제→재제출 데드엔드. `usedAt:null` 추가.
- [ ] **P2-6 공단 발송 동시 클릭 이중 발송** `[W]` `document-runs/send/route.ts` — 잠금·멱등키 없음, 이메일↔DB 비원자. soft-claim or UI 가드.
- [ ] **P2-7 attendance-edit-request 비원자 승인/반려** `[W]` `admin/attendance-edit-requests/[id]/route.ts:34-67` — read-check 후 무조건 update. 조건부 updateMany + $transaction.

### 급여 정합(확정 수정 가능)
- [ ] **P2-8 payslip 지급일 UTC 하루 밀림** `[W]` `worker|admin/payroll/.../payslip/route.ts:40` — `finalizedAt.toISOString().slice(0,10)`. `getKstDateString`로.
- [ ] **P2-9 0원 달 FIXED 공제 → net 음수** `[W]` `computeRun.ts:540-543` — `grossPay>0`일 때만 커스텀 공제.

### 문서/발송
- [ ] **P2-10 발송 파일명·기간 KST 하루 밀림** `[W]` `send:90,154`·`zip:93`·`inbox:94` — `getKstDateString` 미적용(공단 첨부 파일명 어긋남).
- [ ] **P2-11 임시비번 선저장 후 알림톡 실패 삼킴** `[W]` `worker/contracts/route.ts:325-344` — 실패 시 신규 워커 로그인 불가 조용히 발생. 발송성공 후 저장 or ManagerNotice 폴백.
- [ ] **P2-12 레거시 워커 가입 API 레이트리밋 부재** `[C]` `app/api/worker/auth/register/route.ts:13,39` — 6자리 초대코드 무제한 검증 노출. UI 미사용으로 보임. **제거** or phone/IP 제한.
- [ ] **P2-13 sign-token CD1 / admin/docs/sign 상태머신 밖** `[W]`(UI 미사용) — 둘 다 현재 UI 미호출. resolveDocAssignment 통일 or **제거**(직전 세션 논의된 고아 라우트와 동일선상).

### 보안(횡단)
- [ ] **P2-14 XFF 레이트리밋 스푸핑** `[W]` `lib/clientIp.ts:8` — `xff.split(",")[0]` 조작 가능→브루트포스 방어 무력화. Vercel `x-real-ip` 우선/XFF 마지막. 접속기록용↔레이트리밋용 IP 분리.
- [ ] **P2-15 CSP 헤더 부재** `[W]` `next.config.ts` — `default-src 'self'` + supabase·카카오·toss 명시.
- [ ] **P2-16 JWT 무효화 부재(워커 90일)** `[W]` — `sessionVersion` 클레임+DB 대조, 비번 변경 시 전 세션 무효화.

---

## 성능

- [ ] **PERF-1 워커 홈 순차 쿼리 (P1 체감)** `[W]` `lib/worker/homeSummary.ts:147-233` — 독립쿼리 10개 순차 + 플랜판정 2회 동일조회. Promise.all 병합 + 플랜 1회. (홈 TTFB 직결)
- [ ] **PERF-2 일지 일괄저장 N+1 (P1 체감)** `[W]` `worker/logs/batch-save/route.ts:96-172` — 한달 160+쿼리. findMany+createMany(skipDuplicates) 배치화.
- [ ] **PERF-3 감사/접속기록 풀스캔 + CSV 1만행 메모리 (P1 체감)** `[C+W]` `admin/audit/route.ts:101` · `access-log:92,67` — DISTINCT 2회+무필터 count(인덱스 없음), CSV payload 포함 1만행 적재. 어휘 상수화/60초 캐시 + CSV select 축소/streaming.
- [ ] **PERF-4 DailyAttendance `workDate` 인덱스 부재** `[W]` `schema.prisma:369-435` — cron·CSV·조회 풀스캔. `@@index([workDate])`.
- [ ] **PERF-5 DocumentRun 정렬용 복합 인덱스 부재** `[C]` `document-runs/inbox:38`·`zip:35`·`dashboard:70` — `agencyId+signStage/govStatus+updatedAt desc` 조회인데 인덱스는 `agencyId,docType,periodStart` 중심.
- [ ] **PERF-6 급여 동기 계산 request/cron timeout 위험** `[C]` `admin/payroll/runs:66` · `cron/daily:323` — 기관 규모↑ 시 타임아웃. 큐/작업테이블화 or duration·userCount 계측·상한.
- [ ] **PERF-7 cron 순차 + maxDuration 부재** `[W]` `cron/daily:181-213` — 면제 출근부 3N 순차, `maxDuration` 0건. 배치화 + `export const maxDuration`.
- [ ] **PERF-8 문서 서명 재다운로드 (P2)** `[W]` `document-runs/zip·send` — run마다 같은 매니저 서명 재다운로드. 요청스코프 `Map<url,dataUri>` 캐시.

---

## P3 — 위생/소피해/트레이드오프 (일괄 정리)

- [ ] worker/evaluation traineeId 재적 미검증 `[W]` `worker/evaluation/route.ts:38` (+ unique 없어 중복)
- [ ] worker-reviews GET 익명화 불일치 `[W]⚠️` `admin/worker-reviews/route.ts:39`
- [ ] onboarding set-password 현재비번 무검증 `[W]` `worker/onboarding/route.ts:131` — `isTemporary===true` 제한
- [ ] email-change confirm 레이트리밋 부재 + 코드 평문 `[W]` — phone-verify 패턴 준용
- [ ] 사용자 열거(409) `[W]` `phone-verify:49`·`email-change/request:34` — 균일 응답
- [ ] cron 미대상일 영구 미확정 `[W]` `cron/daily:58`
- [ ] krHolidays 2028+ 공백 → silent-zero `[W]` `lib/krHolidays.ts`
- [ ] 문서 재제출 periodEnd 미갱신 `[W]` `submit/route.ts`
- [ ] request-changes 알림 try/catch 밖 `[W]` `document-runs/[id]/action:114`
- [ ] sms.ts 조용한 스텁 성공 `[W]` `lib/sms.ts:13`
- [ ] sign/[token] claim 실패 시 고아 서명 PNG(PII) 잔류 `[W]`
- [ ] 워커 unreadCount 창 내 계산 `[W]` `worker/notices/route.ts:36`
- [ ] submit 매니저 fan-out isActive 미필터 `[W]` `submit/route.ts:163`
- [ ] 대면 서명 후 컨텍스트(ps/pe/aid) 유실 `[W]` `worker/docs/manager-sign/page.tsx:42`
- [ ] 프론트 try/finally-무-catch 무통보 다수 `[W]` `manager/payroll`·`worker/review/*`·`attendance-edit-requests`·`manager/subscription`
- [ ] inbox 가짜 성공(로컬 ADMIN_RESOLVED) `[W]` `AttendanceInboxClient.tsx:498`
- [ ] 워커 목록 오류=빈상태 위장 `[W]` `worker/payroll·contracts·docs`(res.ok 미확인)
- [ ] 매니저 workers '오늘' UTC `[W]` `manager/workers/page.tsx:74`
- [ ] subscribe/success 재-POST `[W]` — `router.replace`로 쿼리 제거
- [ ] 페이지 크기 규칙 위반(5/10) `[W]` `manager/documents:15`·`support:91`·`recruit:19`·`gov-submissions:13`

---

## 착수 권고 순서

1. **즉시(1줄급·확실)**: P0-1 IDOR · P0-2 날짜 · P1-3 매칭 claim · P1-6 초대 토큰 claim · P1-7 프록시 예외.
2. **결제**: P1-1(orderId 결정화)+P1-2(중복 오분류) 함께.
3. **급여 무결성(정책 무관·확정 가능)**: P1-8 endTime · P1-9 delete가드 · P1-15 주휴 incomeType · P2-8 지급일 · P2-9 net음수.
4. **⚠️급여 정책(노무사/사용자 확정 후 일괄)**: P1-11 월경계귀속 · P1-12 주휴시드 · P1-13 MONTHLY휴일 · P1-14 반일일수.
5. **문서 무결성**: P1-10 재제출 서명초기화 · P2-5 cron토큰 · P2-6 발송이중 · P2-10 파일명KST.
6. **동시성 잔여**: P1-4/P1-5 배정 advisory lock(6경로 일괄) · P2-1/2/4/7 토큰·응답 claim.
7. **성능**: PERF-1 homeSummary → PERF-2 batch-save → PERF-3/4/5 인덱스·캐시 → PERF-6/7 cron/maxDuration.
8. **보안 하드닝**: P2-14 XFF → P2-15 CSP → P2-16 JWT 무효화.
9. **P3 위생**: 묶어서 배치 정리(만지는 파일 우선).

## 이미 반영 확인(양 리뷰 공통, 재작업 금지)
문서 서명토큰 assignment/period 스코프 · 계약서명 updateMany(PENDING) 원자화 · DocumentRun null-trainee partial unique · TraineeLog unique · 급여 월중단가 차단 · **payroll N+1 배치화** · PDF send/zip concurrency 제한 · CHANGES_REQUESTED 발송 제외 · 인가 자세(resolveDocAssignment·findTraineeAtSiteInPeriod·body agencyId 미신뢰·dual-session) · CSV 인젝션 방어 · 업로드 magic-byte · 외부발송 가드.
