# 전수 코드 리뷰 — 정확성·보안·성능 (2026-07-08)

대상: master `d8e75d1` 기준 최신 코드. 8개 영역별 리뷰(매니저/운영자 인가 · 워커/공개 인가 · 횡단 보안 · 급여/근태 · 문서/PDF/발송 · 성능 · 동시성 · 프론트엔드)를 병렬 수행하고, 아래 P0/P1은 리뷰어가 지목한 파일을 **직접 열어 재검증**함.

기준선: `tsc --noEmit` 오류 0, `vitest run` 전체 통과.

범례: 확신도 ✅=코드로 확정 / ⚠️=정책 확인 필요.

---

## 요약 — 우선순위 상위 항목

| # | 심각도 | 영역 | 한 줄 | 파일 |
|---|---|---|---|---|
| 1 | **P0** | 인가 | 매니저가 `?workerId=`로 타 기관 훈련생 일지 열람(IDOR) | `app/api/admin/logs/route.ts:33-34` |
| 2 | **P0** | 프론트 | AI 일괄 일지 날짜가 −1일(일요일 포함)로 기록 | `app/worker/worklog/batch/page.tsx:279-283` |
| 3 | **P1** | 급여 | 월 경계 주(週) 주휴수당 양쪽 달 모두 미지급 | `lib/payroll/computeRun.ts:410` |
| 4 | **P1** | 급여 | 주휴 고정액=시급×8h 시드 → 단시간 약 45% 과지급 | `app/api/worker/contracts/route.ts:263` |
| 5 | **P1** | 급여 | endTime 없는 행(퇴근미실행·근무중)도 확정 → 과지급·문서 불일치 | `app/api/worker/attendance/confirm-month/route.ts:27` |
| 6 | **P1** | 문서 | 재제출 시 매니저 서명 미초기화 → 미검토 문서에 구 서명 날인·공단 발송 | `app/api/worker/docs/submit/route.ts:120` |
| 7 | **P1** | 결제 | 최초 결제 orderId 비결정적 → 이중청구 / 결제 후 FREE | `app/api/payments/billing/route.ts:87` |
| 8 | **P1** | 동시성 | 매칭 수락 더블탭 → 이중배정(출근·급여 이중집계) | `app/api/worker/recruit/offers/route.ts:58,93` |

성능 체감 P1 3건 및 P2 다수는 아래 각 절 참조.

---

## P0 — 데이터 유출 / 무결성 (즉시)

### P0-1. 크로스테넌트 IDOR — 타 기관 훈련생 일지 열람 ✅
`app/api/admin/logs/route.ts:31-41`

```js
where: {
  ...(allowedUserIds ? { writerId: { in: allowedUserIds } } : {}),  // 내 기관 스코프
  ...(workerId       ? { writerId:  BigInt(workerId)     } : {}),   // ← 앞 조건을 덮어씀
```

객체 리터럴에서 같은 키 `writerId`를 두 번 스프레드하면 뒤 값이 이긴다. `requireManagerSession`은 매니저에게 `agencyId`를 **항상** 반환(`lib/managerScope.ts:13,28`)하므로 `allowedUserIds`는 늘 배열이고 주석의 "ADMIN=undefined" 분기는 이 라우트에선 죽은 코드. 따라서 매니저가 `GET /api/admin/logs?workerId=<타 기관 워커 id>` 호출 시 에이전시 필터가 사라지고, 타 기관 훈련생의 이름·성별·일지 내용(장애 훈련생 지도 자유기술)·과제 점수·현장명이 반환됨. workerId는 순차 BigInt라 열거 용이. 안전성확보조치 대상 민감 PII의 크로스테넌트 유출.

**수정**: 두 조건을 하나의 `writerId`로 병합 — `workerId`가 오면 `allowedUserIds ∩ {workerId}`(포함 여부 검증 후 미포함이면 거부). `traineeId` 파라미터는 writerId와 키가 달라 AND로 붙으므로 안전.

### P0-2. AI 일괄 일지 날짜 −1일 오염 ✅
`app/worker/worklog/batch/page.tsx:279-283`, `303-310`

```js
const cur = new Date(from + "T00:00:00");   // 로컬(KST) 자정 파싱
const date = cur.toISOString().slice(0, 10); // UTC 변환 → 전날
if (dow !== 0 && dow !== 6 && !holidays[date]) result.push(date);
```

`getDay()`는 KST 요일(의도한 날짜)인데 `toISOString()` 날짜 문자열은 UTC라 하루 앞당겨짐. 월요일 선택분이 실제로는 일요일 날짜로 기록되고, 서버(`ai/batch-voice-to-log`)는 이 목록을 재검증 없이 그대로 초안→batch-save로 전파. `holidays[date]`도 밀린 키로 조회돼 공휴일 제외 오동작. 같은 파일 `todayStr()`(24행)은 `Date.now()+9h` 보정을 제대로 했으나 이 두 함수만 누락.

**수정**: `toISOString()` 대신 로컬 성분 조립(`${y}-${pad2(m)}-${pad2(d)}`).

---

## P1 — 돈 / 법적 / 문서 무결성

### P1-1. 월 경계 주휴수당 미지급 ✅ (리뷰어 vitest 실증)
`lib/payroll/computeRun.ts:410-411` · `lib/payroll/weeklyHoliday.ts:155`

computeRun은 급여월 출근만 로드(`periodStart:{YM}-01 ~ periodEnd:말일`)하고, 개근 판정 `workedDays >= requiredDays`가 월별로 쪼개진다. 6/29(월)~7/3(금) 개근 워커는 6월 런에서 2일·7월 런에서 3일만 보여 양쪽 모두 부적격 → 주휴 0원. 시급 10,000·주5일 5.5h 기준 경계주마다 약 55,000원 미지급, 월 경계가 평일을 가르는 주는 상시 발생.

**수정**: 경계주는 인접 월 출근·공휴일을 함께 로드해 판정하거나, 주의 귀속 월을 정해 한쪽 런에서 전체 주를 판정. (정책 결정 필요 — 어느 달에 귀속시킬지)

### P1-2. 주휴 고정액 시드 → 단시간 과지급 ✅
`app/api/worker/contracts/route.ts:263` · `admin/payroll/contracts/backfill/route.ts:59` · `app/manager/payroll/page.tsx`(폼 기본값)

```js
weeklyHolidayPay: wt === "HOURLY" ? Math.round(base * 8) : null,  // 계약 서명 시 자동 시드
```

`computeWeeklyHoliday`는 `flatWeeklyHolidayPay>0`이면 비례산식 `(주소정÷40)×8×시급`을 무시하고 고정액 지급(`weeklyHoliday.ts:146-148`). 시급×8h는 주40h 전일제 값인데 AM/PM 5.5h×5일(주27.5h) 워커의 법정 주휴는 ≈5.5h×시급. 즉 주당 약 45% 과지급. 이 플랫폼 주력 근무형태라 영향 광범위. (P1-1 과소지급과 부분 상쇄되나 서로 다른 주·워커라 상계 아님.)

**수정**: 시드를 `weeklyHolidayPay: null`(자동 산식)로 두거나, 계약 주 소정시간으로 비례 계산해 시드.

### P1-3. endTime 없는 행 확정 허용 ✅
`app/api/worker/attendance/confirm-month/route.ts:21-30` (+ `[id]/confirm`)

```js
where: { ..., isFinalClosed: false, isManagerFinalClosed: false, startTime: { not: null } },
data:  { isFinalClosed: true, finalizedAt: now, status: "DONE" },  // endTime·status 미검사
```

`startTime`만 있으면 퇴근 미실행(endTime null) 행·오늘 근무중(WORKING) 행도 급여 모집단에 진입. computeRun DAILY는 endTime 없어도 일급 전액 가산(과지급), HOURLY는 0분→0원(과소). 출근부는 `missedClockOut=!endTime`으로 여전히 '보정대기(0h)' 표기 → 공단 문서와 급여 불일치. WORKING 행이 DONE으로 바뀌면 이후 clock-out이 `status:WORKING` 행을 못 찾아 퇴근 영구 불가.

**수정**: `endTime: { not: null }` + `status: "DONE"`(또는 `workDate < todayKST`) 조건 추가.

### P1-4. 문서 재제출 시 매니저 서명 미초기화 → 무검토 발송 ✅
`app/api/worker/docs/submit/route.ts:120-123` · `admin/document-runs/send/route.ts:60,92,136`

재제출 update가 서명 필드를 건드리지 않고, `managerSignatureUrl`은 어디서도 초기화되지 않음(전수 grep). send는 `signStage: { notIn: ["DRAFT","CHANGES_REQUESTED"] }`(SUBMITTED 포함)를 발송 대상으로 하고, 서명 게이트를 run의 스테일 `managerSignatureUrl`로 통과시킨 뒤 그 서명을 주입해 렌더. 흐름: v1 제출→매니저 서명(MANAGER_SIGNED)→워커가 내용 바꿔 v2 재제출(SUBMITTED)→발송 선택→**매니저가 본 적 없는 v2에 구 서명이 찍혀 공단 발송**. 반려(CHANGES_REQUESTED) 후 재제출도 재검토 없이 발송 가능.

**수정**: 재제출 update에 `managerSignatureUrl/managerSignedAt/managerSignerName: null` 추가. 근본적으로 서명을 DocumentVersion에 귀속하거나 send 게이트를 `signStage==="MANAGER_SIGNED"`로.

### P1-5. 최초 결제 orderId 비결정적 → 이중청구 / 결제 후 FREE ✅
`app/api/payments/billing/route.ts:87,91,123`

```js
const orderId = `ablelink_${agencyId}_${Date.now()}`;  // 재시도마다 새 orderId
const chargeRes = await fetch(.../billing/${billingKey}...);  // 실 과금
await prisma.agency.update({ ... planType, tossBillingKey ... });  // 과금 성공 후에야 DB
```

과금 성공 후 DB update가 예외/타임아웃이면 돈은 나갔는데 플랜 FREE·빌링키 미저장. 재시도 시 `Date.now()` orderId라 토스가 중복을 못 걸러 같은 달 2회 청구. **정기결제 크론(`charge/route.ts:71`)은 이미 결정적 `ablelink_{id}_{YYYYMM}`을 쓰고 있어** 이 패턴만 최초 결제에 누락.

**수정**: 빌링키 발급→DB 선저장→결정적 orderId로 과금→플랜 반영 순서로 재배열. 과금 성공 후 DB 실패 시 토스 취소 API 보상.

### P1-6. 매칭 수락 더블탭 → 이중배정 ✅
`app/api/worker/recruit/offers/route.ts:58,73,93` · `admin/recruit-applications/[id]/route.ts`

상태 검사(`status !== "PENDING"`)와 중복 검사가 트랜잭션 밖이고, tx 안 `talentOffer.update`에 `status:"PENDING"` 조건이 없음. 모바일 더블탭(요청 A/B 동시)이면 둘 다 통과→같은 현장·워커에 ASSIGNED 배정 2행 생성. SiteAssignment엔 unique 제약이 없어 DB가 안 막음. 출근부 unique가 `(assignmentId,workDate)`라 같은 날 배정별 2건→급여 이중 집계. 공고 첫 수락 시 Site도 2개 중복 생성 가능.

**수정**: `tx.talentOffer.updateMany({where:{id, status:"PENDING"}})` claim으로 전환, count=0이면 중단. Site find-or-create는 `recruitPost.updateMany({where:{id, siteId:null}})` claim.

---

## P2 — 중요

**결제/급여 정합**
- **charge 중복 orderId 오분류** ✅ `payments/charge/route.ts:98-108` — 성공 후 크래시 재시도 시 토스가 중복 orderId를 4xx로 거절→`transient` 아님→else 분기에서 결제 완료 고객을 FREE로 강등. 토스 중복 코드는 성공 간주하거나 결제조회 API로 확인.
- **급여 재계산 delete가 FINALIZED 삭제 창** ✅ `admin/payroll/runs/route.ts:82` — `delete({where:{id}})`가 status 무조건. 재계산과 확정 동시 진행 시 확정 급여+명세서 소실 가능. `deleteMany({where:{id, status:{not:"FINALIZED"}}})`.
- **attendance-edit-request 비원자 승인/반려** ✅ `admin/attendance-edit-requests/[id]/route.ts:34-67` — read-check 후 무조건 update, 트랜잭션 없음. 반려됐는데 출근부는 승인값 반영되는 모순 가능. 조건부 updateMany + $transaction.
- **MONTHLY 개근월 휴일근로 1.0 미가산 / 209h 고정** ⚠️ `computeRun.ts:316-371` — 개근 월급자 휴일근로가 0.5만 가산(1.0 누락), 통상시급 `rate/209` 고정이라 단시간 월급제 가산 과소. 법 해석·"MONTHLY=전일제" 전제 확인 필요.
- **같은날 2배정 workedDays=2** ⚠️ `computeRun.ts:224` — `workedDays=행 수`라 멀티현장 AM/PM 워커는 하루가 2일. 명세서 "(N)일"·DAILY 일급·보험 8일판정 인플레. `new Set(workDate).size`로. (반일 2건=1일급인지 정책 확정 필요)
- **주휴 게이트 incomeType 불일치** ✅ `computeRun.ts:396` — 공제는 `elig.incomeType`로 자동전환되나 주휴는 `contract.incomeType` 기준이라, 계약有+기준 BUSINESS 워커는 "근로소득 자동계산" 안내와 달리 주휴 미지급. `elig.incomeType`으로 통일.
- **payslip 지급일 UTC 밀림** ✅ `worker|admin/payroll/.../payslip/route.ts:40` — `finalizedAt.toISOString().slice(0,10)`. KST 00~09시 확정 시 지급일 하루 전. `getKstDateString`.
- **0원 달 FIXED 공제 → net 음수** ✅ `computeRun.ts:540-543` — gross 0인데 커스텀 공제 부과. `grossPay>0`일 때만.

**동시성/멱등성**
- **배정 상호배제 TOCTOU** ✅ respond/finalize/직접배정/서명 write-back/offers 6경로 — 겹침검사와 승격 사이 직렬화 없음, SiteAssignment에 배제 제약 없음. 서로 다른 매니저가 같은 워커 동시 배정 시 이중배정→계약·급여 이중. 워커 단위 `pg_advisory_xact_lock`으로 6경로 일괄 방어 권장.
- **cron 사용완료 서명토큰 삭제** ✅ `cron/daily/route.ts:107` — `deleteMany({where:{expiresAt:{lt:now}}})`에 `usedAt` 조건 없어 서명 완료 토큰도 7일 후 삭제→재제출 시 "서명 필요" 데드엔드+서명 근거 소실. `usedAt: null` 추가.
- **cron 만족도 중복 발송** ✅ `cron/daily:231-258` — `SatisfactionSurvey.contractId` unique 없음, 겹침 실행 시 조사 2건+알림톡 2건(유료). partial unique 또는 배치 advisory lock. (SURVEY_AUTO_SEND 기본 OFF라 현재 노출 낮음)
- **공단 발송 동시 클릭 이중 발송** ✅ `document-runs/send/route.ts` — 잠금·멱등키 없어 같은 PDF 2통 가능 + 이메일 성공↔DB기록 비원자. soft-claim 또는 UI 가드.

**문서/발송**
- **발송 파일명·기간 KST 하루 밀림** ✅ `send/route.ts:90,154` · `zip:93` · `inbox:94` — `periodStart.toISOString().slice(0,10)`. `[id]/action`은 C4로 `getKstDateString` 고쳤으나 이 경로들엔 미적용 → 공단 첨부 파일명이 하루 어긋남.
- **임시비번 선저장 후 알림톡** ✅ `worker/contracts/route.ts:325-344` — 비번 교체→알림톡 발송, 실패 시 catch가 삼켜 신규 워커 로그인 불가 상태가 조용히 발생. 발송 성공 후 저장 또는 ManagerNotice 폴백.
- **sign-token CD1 미적용** ✅(UI 미사용) `worker/docs/sign-token/route.ts:53` — 멀티현장에서 최신 배정에 무조건 귀속. 현재 호출 UI 없음. resolveDocAssignment로 통일 또는 제거.
- **admin/docs/sign 상태머신 밖 발송** ⚠️(UI 미사용) — 스냅샷 아닌 현재 DB로 재조립·임의 수신자 발송·기록 없음. 미사용이면 제거.

**보안(횡단)**
- **XFF 레이트리밋 스푸핑** ✅ `lib/clientIp.ts:8` — `xff.split(",")[0]`이 클라이언트 조작 가능. 로그인·OTP·업로드·서명·비번초기화 브루트포스 방어 무력화. Vercel `x-real-ip` 우선 또는 XFF 마지막 엔트리 사용. 접속기록용/레이트리밋용 IP 분리.
- **CSP 헤더 부재** ✅ `next.config.ts` — X-Frame-Options·HSTS는 있으나 CSP 없음. 심층방어 갭. `default-src 'self'` + 필요 출처(supabase·카카오·toss) 명시.
- **JWT 무효화 부재 + 워커 90일** ✅ — stateless JWT, 로그아웃은 쿠키만 삭제. 토큰 탈취 시 만료 전까지 유효(워커 90일). `sessionVersion` 클레임+DB 대조로 즉시 무효화, 비번 변경 시 전 세션 무효화.

**성능(체감)**
- **워커 홈 순차 쿼리** ✅ P1 `lib/worker/homeSummary.ts:147-233` — 독립 쿼리 6개+설정 4개가 순차 await, 플랜 판정(`checkPlanAccess`)이 동일 조회를 2회. Promise.all 병합 + 플랜 판정 1회 로드. 홈 TTFB 직결(가장 많이 열리는 화면).
- **일지 일괄저장 N+1** ✅ P1 `worker/logs/batch-save/route.ts:96-172` — 날짜별·로그별 순차. 한 달 66로그≈160+ 쿼리, 5명·31일이면 300+. findMany+createMany(skipDuplicates)로 배치화.
- **감사/접속기록 무한테이블 풀스캔** ✅ P1 `admin/audit/route.ts:101-102` · `access-log:92-102` — 페이지뷰마다 DISTINCT 2회+무필터 count(entityType/action 인덱스 없음). 어휘 상수화 또는 60초 캐시. CSV(`:67`)는 payload 포함 1만 행 적재 → select 축소.
- **문서 서명 재다운로드** ✅ P2 `document-runs/zip·send` — run마다 같은 매니저 서명을 Storage에서 재다운로드. 요청 스코프 `Map<url,dataUri>` 캐시.
- **cron 순차 + maxDuration 부재** ✅ P2 `cron/daily:181-213` — 면제 출근부 건별 3N 순차, `export const maxDuration` 0건. 실패 시 출근 자동확정·급여초안 통째 누락 위험. findMany/createMany 배치 + maxDuration 명시.
- **DailyAttendance workDate 인덱스 부재** ✅ P2 `schema.prisma:369-435` — cron·CSV·운영자 조회가 workDate만으로 필터→풀스캔. `@@index([workDate])`.

---

## P3 — 요약 (사용자 피해 소·트레이드오프·위생)

- **worker/evaluation 저장 시 traineeId 재적 미검증** ✅ `worker/evaluation/route.ts:38` — 형제 라우트와 달리 `findTraineeAtSiteInPeriod` 없음. 다운스트림은 봉쇄돼 무효 레코드 적재에 국한. + unique 없어 중복 평가행 가능.
- **worker-reviews GET 익명화 불일치** ⚠️ `admin/worker-reviews/route.ts:39` — POST엔 `hasEngagement` 게이트, GET엔 없음. `talent/[id]`의 익명화와 상충(작성 기관명 노출). + unique 없어 더블탭 리뷰 2행.
- **onboarding set-password 현재비번 무검증** ✅ `worker/onboarding/route.ts:131` — isTemporary 아닌 계정도 세션만으로 비번 변경. `isTemporary===true`로 제한.
- **email-change confirm 레이트리밋 부재 + 코드 평문** ✅ `profile/email-change/confirm` — request엔 있으나 confirm엔 없음. phone-verify는 해시+제한. 미사용 이메일 선점 수준. phone-verify 패턴 준용.
- **사용자 열거** ✅ `phone-verify:49` · `email-change/request:34` — 409로 가입 여부 노출. reset-password 패턴(균일 응답) 준용.
- **cron 미대상일 영구 미확정** ✅ `cron/daily:58` — 자동확정이 어제만 대상, 크론 결측 시 그날 DONE-미확정 영구 제외(워커 월확정이 유일 복구).
- **krHolidays 2028+ 공백** ✅ `lib/krHolidays.ts` — 2024~2027만. 2028부터 조용히 공휴일 0(일할 분모·휴일가산·주휴 오판). 시한부 silent-zero.
- **문서 재제출 periodEnd 미갱신** ✅ `submit/route.ts` — unique가 periodStart까지라 기간만 늘려 재제출 시 run 메타·파일명·안내가 실제와 어긋남.
- **request-changes 알림 try/catch 밖** ✅ `document-runs/[id]/action:114` — 상태전이 후 알림 실패 시 재시도가 409로 막혀 알림 재발송 불가.
- **sms.ts 조용한 스텁 성공** ✅ `lib/sms.ts:13` — env 미설정 시 콘솔 출력 후 성공 반환(kakao는 throw). 호출부가 발송 성공 오인.
- **sign/[token] 고아 서명 파일** ✅ — claim 실패 시 업로드한 서명 PNG(PII) 무참조 잔류. claim 실패 시 즉시 삭제.
- **워커 unreadCount 창 내 계산** ✅ `worker/notices/route.ts:36` — take:50 창 밖 미읽음 과소집계. 별도 count.
- **submit 매니저 fan-out isActive 미필터** ✅ `submit/route.ts:163` — 비활성 매니저에게도 알림.
- **프론트 try/finally-무-catch 무통보** ✅ — `manager/payroll`(저장/계산/확정), `worker/review/*`(확정/사유), `attendance-edit-requests`(승인), `manager/subscription`(해지) 등: 비정상 응답 시 실패가 조용. 이중클릭 가드는 대체로 양호.
- **대면 서명 후 컨텍스트 유실** ✅ P1급이나 조건부 `worker/docs/manager-sign/page.tsx:42` — 서명 후 리다이렉트에 ps/pe/aid 미포함→기간 리셋→서명 빠진 문서 제출 가능. URL 왕복 또는 서버 기간 불일치 에러.
- **inbox 가짜 성공** ✅ `AttendanceInboxClient.tsx:498` — resolve 실패도 로컬 ADMIN_RESOLVED 표시.
- **워커 목록 화면 오류=빈 상태 위장** ✅ `worker/payroll·contracts·docs` — res.ok 미확인+catch 무시로 서버 오류가 "명세서 없음" 등 정상 빈 상태로 표시.
- **매니저 workers '오늘' UTC** ✅ `manager/workers/page.tsx:74` — 아침 시간대 하루 오차.
- **subscribe/success 재-POST** ✅ — 성공 페이지 새로고침 시 billing 재요청(서버 멱등 의존). 처리 후 `router.replace`로 쿼리 제거.
- **페이지 크기 규칙 위반** — `manager/documents:15`(12)·`support:91`(12)·`recruit:19`(20)·`gov-submissions:13`(20). 확정 규칙은 5/10.

---

## 정상 확인 (오탐 방지)

인가 자세 전반 견고(resolveDocAssignment 단일화·findTraineeAtSiteInPeriod·중첩 리소스 재검증·body agencyId 미신뢰·dual-session 스코핑). 서명 토큰 원자적 1회 사용·문서 상태전이 조건부 updateMany(C6)·급여 게이트 단일소스·국민연금 플래그만(자동공제 없음)·CSV 수식 인젝션 방어·비밀정보 하드코딩 0·외부 발송 가드 전 채널 배선·업로드 magic-byte 검증·트랜잭션 내 외부호출 없음·computeRun 배치 조회로 N+1 해소·클라이언트 무거운 라이브러리 동적 import.

---

## 착수 권고

1. **즉시(유출·법적)**: P0-1 IDOR(1줄), P0-2 날짜(1함수), P1-5 결제 orderId 결정화, P1-6 매칭 수락 claim(1줄) — 범위 작고 확실.
2. **급여(법적 정확성)**: P1-1~3 + P2 주휴/휴일/일수 정책 — **월 경계 귀속·MONTHLY 휴일가산·반일 2건 일수는 노무사/사용자 확정 후** 일괄 수정.
3. **문서 무결성**: P1-4 재제출 서명 초기화, P2 cron 토큰·발송 날짜.
4. **성능**: homeSummary 병합 → batch-save 배치화 → 감사 테이블 인덱스/캐시.
5. **보안 하드닝**: XFF IP 소스 → CSP → JWT 무효화.
