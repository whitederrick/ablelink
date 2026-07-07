# 출시 전 ultra 코드리뷰 — 2026-07-06

- **범위:** `git diff 9dadc7c..HEAD` (오늘 커밋 8개: 다시급 override, 국민연금 등급표, 배정 시간겹침, 문서 워크플로 리파인, Tier1/Tier2 보안수정)
- **방법:** 10개 파인더 각도(라인스캔·제거된가드·크로스파일·언어함정·가드레이어·재사용·단순화·효율·설계고도·컨벤션) → 파일별 클러스터 검증(1-vote, CONFIRMED/PLAUSIBLE/REFUTED) → gap sweep
- **결과:** CONFIRMED 정확성 버그 **34건**, PLAUSIBLE 1, REFUTED/경미 2, 품질(비버그) 9. 급여(다시급)·공식문서·배정 세 영역에 회귀 집중.
- **검증 계정:** worker `worker1234!` · manager01~03 `Manager1234!` · admin `admin1234!`

범례: 🔴 출시 차단급 · 🟠 높음 · 🟡 중간 · ⚪ 낮음/경미 · 🔵 품질(비버그)

---

## A. 급여 — 현장별 다시급 override (커밋 1feb9a7)

### A1 🔴 override 생성이 자기 UI로는 항상 400 — 기능 사용 불가
- **위치:** `app/api/admin/payroll/contracts/route.ts:89`
- **메커니즘:** 현장 override 생성이 `findFirst({ siteId: null, effectiveTo: null })` 기본계약을 요구. 그러나 폼(makeInitialForm 종료일=+1년)·계약프리필(contractEnd)·자동시딩(worker/contracts:233, backfill:60) 모두 종료일을 **non-null**로 저장.
- **트리거:** 매니저가 기본계약 등록 후 '적용 현장' 선택·저장 → 400 `"먼저 기관 기본 급여 기준을 등록한 뒤…"`. computeRun은 기간제 기본계약을 정상 사용하므로 유효한 계약이 있어도 거부.
- **수정 방향:** 게이트를 `effectiveTo: null OR effectiveTo >= 기준일`로 완화(computeRun의 계약선택 조건과 일치시킬 것).

### A2 🔴 payType 무언 교체 → 약 8배 과지급
- **위치:** `app/api/admin/payroll/contracts/route.ts:102`
- **메커니즘:** 현장 override는 `resolvedPayType = baseForSite.payType`로 제출 payType을 덮어씀. 폼은 site 선택 시에도 payType 셀렉트를 비활성화하지 않음(:549-551, 안내문구만).
- **트리거:** 기본계약 HOURLY인 워커에 일급 100,000 입력·저장 → HOURLY/100,000으로 저장 → computeRun HOURLY 분기가 시간당 100,000원 지급.
- **수정 방향:** override의 payType은 base와 동일해야 하므로, 폼에서 payType 잠금 + 서버는 불일치 시 400(무언 교체 금지).

### A3 🔴 기본계약 삭제 → override가 전 현장 급여·세금·보험 지배 (고아 override)
- **위치:** `app/api/admin/payroll/contracts/[id]/route.ts:25` (DELETE 무가드) · `lib/payroll/computeRun.ts:155` (promotion) · `app/api/worker/contracts/route.ts:213` + `app/api/admin/payroll/contracts/backfill/route.ts:38` (시딩 존재확인)
- **메커니즘:** DELETE가 존재+기관소유만 확인해 base(siteId=null) 삭제 허용. computeRun은 `find(siteId==null) ?? payContracts[0]`로 남은 override를 base로 승격 → 그 override의 금액·incomeType·payType이 모든 현장 근무일에 적용. 계약서명 시딩/백필의 존재확인 where에 `siteId: null`이 없어 고아 override를 "이미 계약 있음"으로 보고 기본계약 재생성도 안 함.
- **트리거:** 기본계약+현장 override 보유 워커 → 매니저가 기본계약 행 삭제(일반 confirm 1클릭) → 이후 모든 급여런이 override 금액으로 계산, 복구 경로 없음.
- **수정 방향:** override가 남아있으면 base 삭제 거부(또는 cascade). 시딩 존재확인에 `siteId: null` 추가. `?? payContracts[0]` 폴백 제거하고 base 없으면 명시 에러.

### A4 🟠 시급 급여명세 라인 ≠ 지급총액
- **위치:** `lib/payroll/computeRun.ts:424` (payLines) vs `:266-271` (grossPay)
- **메커니즘:** grossPay 기본급은 `rateForSite(siteId)`(override 단가)로 누적하나, payLines(1인지원/2인이상지원)는 `contract.baseAmount`(base 단가)로 계산. support2 method 텍스트도 `× 120%` 하드코딩.
- **트리거:** base 10,000/h + override 12,000/h, override 현장 20h → grossPay 240,000 vs payLines 200,000 → 명세 40,000원 불일치. 매니저 명세 편집기(payroll/page.tsx:1116)가 payLines 합으로 gross 재계산·저장하여 저장값까지 오염.
- **수정 방향:** payLines도 rateForSite 결과(dBase/dRate2)로 계산. 기본급 가중평균 분기(`usesSiteRates` :275-276)처럼 처리.

### A5 🟠 MONTHLY 워커는 override 완전 무시 (무음 no-op)
- **위치:** `lib/payroll/computeRun.ts:303` (else/MONTHLY 분기)
- **메커니즘:** MONTHLY 분기가 rateForSite/rateBySite를 전혀 참조하지 않고 base contract.baseAmount만 사용. API/UI는 MONTHLY override를 수락·표시(📍 뱃지, "이 현장 출근일에만 적용" 문구).
- **트리거:** base 월급 2,000,000 + override 2,400,000 생성 → 급여런은 2,000,000 지급. UI 표시액과 실제 지급액 상이.
- **수정 방향:** MONTHLY도 override 반영하거나, MONTHLY에 대해 override 생성 자체를 막고 문구 정정.

### A6 🟠 partial override → 1:多 단가·주휴수당 소실
- **위치:** `lib/payroll/computeRun.ts:169` (rateForSite rate2) · `:393` (weeklyHolidayPay)
- **메커니즘:** `src = sc ?? contract` 후 rate2를 override에서만 취함(base 폴백 없음). override에 `hourlyRate2Plus`가 null이면 `isMulti` false가 되어 2인+ 날이 1:1 단가로 지급. `weeklyHolidayPay`는 반대로 base에서만 읽어 override의 주휴 flat이 dead.
- **트리거:** base 시급 12,000/2인+ 14,400, override는 baseAmount 13,000만 입력(rate2 미입력, 폼에서 클리어 가능) → 2인 훈련생 날이 13,000(1:1)으로 지급. 스키마 주석 "금액만 override"와 배치.
- **수정 방향:** override 필드가 null이면 base 값으로 폴백.

### A7 ⚪ BigInt(siteId) 비정수 입력 → 400 대신 500
- **위치:** `app/api/admin/payroll/contracts/route.ts:76`
- **메커니즘:** `BigInt(siteId)`에 로컬 try/catch 없음. `'abc'`/`'12.5'` → SyntaxError → 함수레벨 catch가 status 없는 에러라 500. (workerId도 :89/:114/:122에서 truthy만 체크)
- **트리거:** 관리자 인증 상태의 직접 API 호출만(셀렉트 값은 실제 id라 UI로는 미도달). 심각도 낮음.
- **수정 방향:** 형제 경로(buildDocPayload)처럼 parseBigInt/try-catch로 400 반환.

### A8 ⚪ 새 Prisma 컬럼 `as any` 접근 → 오타 무음화
- **위치:** `lib/payroll/computeRun.ts:155,159,512-513` · `app/api/admin/payroll/contracts/route.ts:34-35,133` · `app/api/admin/payroll/insurance-rates/route.ts:30-31`
- **메커니즘:** `(c as any).siteId`, `(insuranceRates as any).pensionBaseMin/Max` — 생성된 Prisma 클라이언트는 이미 타입 보유(같은 파일 :114는 uncast `siteId` 사용). 캐스트가 타입체크를 무력화.
- **트리거:** `pensionBaseMim` 같은 오타가 컴파일 통과 → undefined → "bounds 미설정" 취급 → 근사 폴백 무음. 이 프로젝트가 감사해온 silent-zero 부류.
- **수정 방향:** `as any` 제거, 일반 속성 접근.

### A9 🟡 close+create 비트랜잭션·유니크 부재 → 이중 open 계약
- **위치:** `app/api/admin/payroll/contracts/route.ts:114`
- **메커니즘:** 이전계약 마감 updateMany(siteId 스코프)와 create가 순차 실행, `$transaction` 없음. PayContract에 `@@unique` 없음(@@index만).
- **트리거:** 폼 이중제출(두 탭/재시도, disabled는 단일 탭만 보호) → effectiveTo:null 2행 공존 → computeRun `orderBy effectiveFrom desc`만, tiebreaker 없어 비결정 선택. create가 updateMany 후 실패하면 유효계약 0개.
- **수정 방향:** `$transaction`으로 감싸고 (workerId, siteId, effectiveTo=null) 부분유니크 인덱스 추가.

### A10 🟡 매니저 급여폼 워커 전환 race → 엉뚱한 현장 override 무음 무시
- **위치:** `app/manager/payroll/page.tsx:205` (onPickWorker)
- **메커니즘:** 현장옵션 fetch가 await/stale-guard 없이 발사. 워커 A(느림)→B(빠름) 전환 시 A 응답이 나중 도착 → A의 현장목록이 form.workerId=B에 적용.
- **트리거:** 저장 시 B가 근무하지 않는 현장의 siteId override 생성(서버는 기관소속만 검증). computeRun은 실제 출근행 siteId로만 조회하므로 override 영구 무음 무시.
- **수정 방향:** 요청 id/AbortController로 stale 응답 폐기.

---

## B. 급여 — 국민연금 (커밋 43f436d)

### B1 🔴 '재적용' 버튼이 의도적 null bounds를 잠정 고시값으로 되살림 → 무단 clamp 전환
- **위치:** `app/admin/settings/_sections.tsx:330`
- **메커니즘:** `keepMin = saved?.pensionBaseMin ?? bnd?.min ?? null`. 운영자가 근사 모드 유지를 위해 하한/상한을 의도적으로 null 저장했는데, `??`가 null을 "누락"으로 간주해 `PENSION_BASE_BOUND_DEFAULTS`(2026: 400,000/6,370,000, "잠정 — 고시 미정")로 fall-through·영구 저장.
- **트리거:** 연금 bounds 공란 저장 → 이후 해당 행 '저장·적용' 클릭 → clamp 모드로 무음 전환 → 저소득 파트타이머 국민연금이 하한 400,000으로 clamp되어 공제액 급증(예 100,000 소득자 ~4,750→19,000원).
- **주의:** 메모리상 **국민연금 자동공제는 노무사 확정 후** 조건. 미확정 잠정값의 무단 적용은 특히 위험.
- **수정 방향:** null 보존(근사 유지) — `saved.pensionBaseMin`이 명시적으로 존재할 때만 사용, 없으면 null 유지.

### B2 🔴 시드 스크립트가 pensionBaseMin/Max 누락 → 신규 환경 clamp 비활성화
- **위치:** `scripts/seed-insurance-rates.mts:50` (create/update 블록)
- **메커니즘:** upsert가 bounds를 안 씀(같은 모듈에 `PENSION_BASE_BOUND_DEFAULTS` 존재하나 미import). 신규 환경/시드 재실행 시 전 연도 NULL → pensionBase.ts null 반환 → 근사(지급액×요율) 모드로 폴백.
- **트리거:** 새 환경 구축·런북대로 시드 재실행 → 연금 하한 미만 워커 과소공제, null-bounds 폴백이 설계상 무음이라 감지 불가.
- **수정 방향:** 시드가 `pensionBaseBoundDefaultForYear`로 bounds도 기록.

---

## C. 공식문서 (커밋 50b1e3d, fcd995b)

### C1 🔴 admin 문서 라우트가 가드 null에도 진행 → 빈 공식 PDF를 공단에 이메일 발송
- **위치:** `app/api/admin/docs/generate/route.ts:113` (preview:107, sign:103)
- **메커니즘:** `findTraineeAtSiteInPeriod`가 null이어도 early-return 없이 `traineeName:''`·`logs:[]`로 진행. 워커 라우트는 이번 diff에서 400 가드를 얻었으나 admin 3개는 누락. `requiredSignatures`상 사업체담당자 서명이 불필요한 문서유형(적응지도일지·훈련생/적응 종합평가)은 워커 서명만 있으면 `toEmail`로 공단 발송(success:true).
- **트리거:** 매니저가 드롭다운(currentSiteId/ACTIVE만, 기간필터 없음)에서 훈련생 선택하되 TraineePlacement.startDate 이전 기간 요청 → 가드 null → 빈 PDF 생성·발송.
- **수정 방향:** admin 라우트도 워커처럼 null 시 400. 발송 게이트에 trainee 매칭 포함.

### C2 🟠 admin 문서는 newest 배정 고정·assignmentId 무 → 멀티현장 워커 타현장 문서 공백
- **위치:** `app/api/admin/docs/generate/route.ts:50` (preview:40, sign:57)
- **메커니즘:** `findFirst(orderBy assignedAt desc)`로 최신 배정 site만 사용, assignmentId 파라미터 없음. 가드는 그 site에 정확히 소속된 훈련생을 요구.
- **트리거:** 워커가 현장 A(구)·B(신) 활성. 매니저가 A 소속 훈련생 일지 생성 → 가드가 B로 조회 → null → 빈 문서(C1 경로). 워커측은 이번 diff에서 assignmentId 배선을 얻었으나 admin측은 미배선(회귀).
- **수정 방향:** admin 문서 라우트에 site/assignment 선택 파라미터 추가.

### C3 🟠 ENDED 배정 가리키는 90일 쿠키 → 워커 문서 전면 차단
- **위치:** `lib/docs/buildDocPayload.ts:89` · `app/worker/_lib/activeAssignmentCookie.ts:9`
- **메커니즘:** 쿠키 assignmentId가 `status in [ASSIGNED,CONFIRMED,ACTIVE]`와 AND되고 폴백 없음. 쿠키는 90일 TTL이며 배정종료·로그아웃 시 삭제 안 됨. home은 폴백(`?? todayActive[0] ?? all[0]`)이 있어 회복하나 docs는 하드 실패.
- **트리거:** 활성 2개 워커가 A 선택(쿠키=A) 후 A가 ENDED → 모든 문서 화면 `"배정된 현장이 없습니다"`. 현장전환 UI는 활성 2+일 때만 떠서 수정 경로 없음(최대 90일).
- **수정 방향:** id 매칭 실패 시 최신 활성 배정으로 폴백. 배정종료 시 쿠키 무효화.

### C4 🟠 수정요청 딥링크 KST -1일 → 재제출 시 중복 DocumentRun, 원본 고착
- **위치:** `app/api/admin/document-runs/[id]/action/route.ts:45`
- **메커니즘:** periodStart는 KST 자정(`2026-07-01T00:00:00+09:00` = `2026-06-30T15:00Z`)으로 저장(submit:45, 스키마는 `DateTime` full timestamp). 딥링크가 `toISOString().slice(0,10)` → `'2026-06-30'`(하루 이름).
- **트리거:** 워커가 수정요청 알림 탭 → 06-30~07-31 프리필(잘못된 창) → 재제출 시 pStart=06-29T15:00Z, submit:87의 정확일치 매칭이 원본(06-30T15:00Z)을 놓침 → 중복 create, 원본은 CHANGES_REQUESTED 영구 고착. 모든 수정요청 플로우에서 발생.
- **수정 방향:** KST 기준 날짜 포맷(예 +09:00 오프셋 적용 후 slice) 사용.

### C5 🟠 수정요청 딥링크 assignmentId 누락 → 멀티현장 워커가 엉뚱한 현장으로 재제출
- **위치:** `app/api/admin/document-runs/[id]/action/route.ts:50`
- **메커니즘:** 딥링크 URLSearchParams에 assignmentId 없음. 워커 페이지의 activeAssignmentId는 쿠키에서만 옴.
- **트리거:** 현장 A 출근부 수정요청, 워커 쿠키가 B일 때 탭 → submit이 B 배정으로 전송 → 출근부(traineeId null)는 무검증 통과해 B 현장 문서 생성·B 키로 새 run, A는 CHANGES_REQUESTED 유지. (훈련생 문서는 submit:71 403으로 막히나 이 또한 막다른 길)
- **수정 방향:** 딥링크에 원본 run의 assignmentId 포함.

### C6 🟡 문서 상태가드 TOCTOU (read-then-update 비원자적)
- **위치:** `app/api/admin/document-runs/[id]/action/route.ts:60`
- **메커니즘:** signStage를 앞선 findUnique(:29)에서 읽고 각 분기(:59,80,99)가 그 값을 검사 후 무조건 `update({ where: { id } })`. 조건부 where·트랜잭션 없음.
- **트리거:** 동시 confirm+confirm → 이중 승인 알림. confirm+request-changes(후자는 SUBMITTED 또는 CONFIRMED 수락) → 둘 다 통과, last-write-wins. 대체로 경미.
- **수정 방향:** `updateMany({ where: { id, signStage: 'SUBMITTED' } })` + count 확인.

### C7 🟠 batch 음성일지 — 일부 훈련생 조용히 드롭 후 success
- **위치:** `app/api/worker/ai/batch-voice-to-log/route.ts:153`
- **메커니즘:** `trainees.filter(allowed.has(...))`로 매칭 안 되는 훈련생 무음 제거, 전원 드롭일 때만 403.
- **트리거:** 3명 선택 중 1명의 placement가 dateFrom 직전 종료 → 2명분만 생성·success:true. 워커는 3명 다 됐다고 오인, 3번째 일지 누락.
- **수정 방향:** 부분 드롭 시 어떤 훈련생이 제외됐는지 응답에 명시.

### C8 ⚪ (PLAUSIBLE, 경미) untrimmed `BigInt(' ')=0n` → `{id:0}` 폴백 없음
- **위치:** `app/api/worker/docs/generate/route.ts:52` (preview:38, context:22, view:45)
- **메커니즘:** `raw ? BigInt(raw) : null`(trim 없음). `BigInt(' ')===0n`(throw 안 함) → `{id:0n}` → 매칭 없음 → 폴백 없이 "배정 없음". (buildDocPayload:86은 `.trim()` 가드 있어 안전 → 후보 원문 부분 REFUTED)
- **트리거:** 실 클라이언트는 encodeURIComponent·쿠키 실 id라 whitespace 미전송. 수기 요청만, 영향 미미.
- **수정 방향:** `lib/adminScope.ts`의 `parseBigInt`로 통일.

---

## D. 미제출 보드 (커밋 fcd995b, sweep)

### D1 🟠 status:ACTIVE만 스캔 → 미제출 과소집계
- **위치:** `app/api/admin/document-runs/missing/route.ts:29`
- **메커니즘:** 후보 배정을 `status:'ACTIVE'`로만 조회. 그러나 출근부는 ASSIGNED/CONFIRMED 배정도 생성·제출 가능(worker/docs/generate 허용 상태집합).
- **트리거:** 계약서명됐으나 아직 ACTIVE 아닌 워커가 출근부 미제출 → 후보에서 제외 → missingCount 0, "모든 활성 배정이 출근부를 제출했습니다" 오신호.
- **수정 방향:** 스캔 상태집합을 문서생성 허용집합과 일치.

### D2 🟠 CHANGES_REQUESTED를 '제출됨'으로 카운트 → 허위 준수
- **위치:** `app/api/admin/document-runs/missing/route.ts:47`
- **메커니즘:** submitted 집합을 `signStage:{not:'DRAFT'}`로 구성 → 반려(CHANGES_REQUESTED) run도 제출로 카운트.
- **트리거:** 출근부 제출→반려→미재제출 → 여전히 제출 처리 → 워커가 준수한 것으로 표시, 실제 미제출.
- **수정 방향:** submitted 판정에서 CHANGES_REQUESTED 제외.

---

## E. 배정 시간겹침 (커밋 7f4cf49)

### E1 🔴 계약서명 경로가 겹침가드 우회 + workType 덮어쓰기·CONFIRMED 승격
- **위치:** `app/api/worker/contracts/route.ts:192`
- **메커니즘:** 서명 시 updateMany가 `workType: contract.workType`, `startDate/endDate: 계약값`, `status: 'CONFIRMED'`로 갱신하나 `findTimeConflict` 미호출(미import). admin/contracts는 workType/기간을 무검증 저장(:283).
- **트리거:** 워커 A에 AM(ASSIGNED)+B에 PM(ASSIGNED). 매니저가 assignmentId=B로 FULL_DAY 계약 작성 → 워커 서명 → B가 FULL_DAY·CONFIRMED로 전환 → AM+FULL_DAY 이중배정. respond/PATCH/offers의 409를 통째로 우회. 날짜 덮어쓰기만으로도 별개 트리거.
- **수정 방향:** 서명 전 공유 겹침가드 호출.

### E2 🔴 마켓 지원 수락이 이미 배정된 워커를 하드블록(409)
- **위치:** `app/api/admin/recruit-applications/[id]/route.ts:72`
- **메커니즘:** auto-assign 후보를 `{workType:'FULL_DAY', startDate: new Date(), endDate: null}`로 만들어 겹침검사(endDate null→Infinity). 기존 배정과 항상 겹쳐 커밋 전 409. 형제 경로 `worker/recruit/offers`(:84)는 auto-assign만 soft-skip하고 수락은 기록 → 정반대 동작.
- **트리거:** AM 배정 보유 워커가 마켓 공고 지원 → 매니저 수락 클릭 → 409, RecruitApplication은 PENDING 고착. 마켓 수락 불가.
- **수정 방향:** offers처럼 후보 기간을 공고 service 기간으로 설정하거나 겹침 시 soft-skip.

### E3 🟠 finalize/restore가 겹침검사 누락 + status 배열 불일치(ACCEPTED 불가시)
- **위치:** `app/api/admin/assignment-requests/route.ts:179` (finalize), `:140` (restore) · `app/api/admin/assignments/[id]/route.ts:116` (recruit-applications:69, offers:77도 동일)
- **메커니즘:** finalize(ACCEPTED/DROPPED→ASSIGNED)·restore가 겹침가드 미호출(모듈에 import 없음). 겹침 스캔 status 배열이 respond는 `[ACCEPTED,ASSIGNED,CONFIRMED,ACTIVE]`인데 admin/PATCH·recruit-applications·offers는 `[ASSIGNED,CONFIRMED,ACTIVE]`로 ACCEPTED 누락.
- **트리거:** 워커 다중후보 AM 수락→ACCEPTED. 매니저가 다른 배정 PATCH FULL_DAY(ACCEPTED 불가시→충돌 미검출→성공) → 이후 finalize가 ACCEPTED→ASSIGNED 무검사 승격 → FULL_DAY+AM 이중배정.
- **수정 방향:** finalize/restore에 겹침가드 추가, status 배열을 전 경로 통일(ACCEPTED 포함).

### E4 🟡 apply↔accept 겹침 정의 이원화
- **위치:** `lib/recruitSchedule.ts:19` (hasScheduleConflict, apply) vs `lib/assignmentOverlap.ts` (findTimeConflict, accept)
- **메커니즘:** apply는 `status:'ACTIVE'`만·null 기간이면 false. accept는 ASSIGNED/CONFIRMED/ACTIVE 포함·null 기간을 ±∞·후보를 `new Date()/null`(공고 기간 무시).
- **트리거:** ACTIVE 배정 7/31 종료, 공고 8/1~. 7/10 지원(미충돌 통과) → 매니저 수락 시 후보 today→∞가 7/31 종료 배정과 겹쳐 409. 미래 시작 지원건 수락 불가.
- **수정 방향:** 수락 후보를 공고 service 기간으로 설정, 두 게이트의 status/null 의미 통일.

### E5 ⚪ (cleanup) occupiedHalves CUSTOM 분기 도달불가 폴백
- **위치:** `lib/assignmentOverlap.ts:42`
- **메커니즘:** `:39`에서 `e<=s`면 이미 return, 이후 `e>s`. `s>=NOON_MIN`이면 `e>s>=NOON_MIN`이라 PM 항상 존재 → `out` 항상 비어있지 않음. `: new Set(["AM","PM"])` 폴백 도달불가.
- **수정 방향:** `return out;`로 단순화.

---

## F. 알림 피드 (커밋 816324f)

### F1 🟠 미읽음 count 회귀 → 뱃지 0·미읽음 사라짐
- **위치:** `app/api/manager/notices/route.ts:66`
- **메커니즘:** 전용 `prisma.managerNotice.count({readAt:null})`(제거된 코드에 "take:50로 잘리지 않도록 별도 count" 주석)를 take:50 결과창 필터로 회귀. `orderBy [{readAt:'asc'},...]`가 Postgres NULLS LAST라 미읽음(readAt=null)이 뒤로 밀려 50창에서 잘림(dev DB 쿼리로그로 `ORDER BY read_at ASC ... LIMIT` 실증).
- **트리거:** 읽음 55+미읽음 5 → 창이 읽음행으로 채워짐 → unreadNotice=0, 미읽음 5건(예: 문서 재제출 요청)이 목록에서도 누락.
- **수정 방향:** 미읽음 개수는 별도 count 쿼리로 복원.

### F2 🟡 시스템공지 unread도 take:50 창 파생 → 오래된 미읽음 미집계
- **위치:** `app/api/manager/notices/route.ts:25`
- **메커니즘:** unreadSys를 `systemAnnouncement.findMany(take:50, createdAt desc)` 기반으로 계산. 50번째 밖 미읽음 공지는 미집계.
- **트리거:** 공지 50+개 시 오래된 미읽음(예 안 연 유지보수/긴급)이 창 밖 → 벨 count 과소, 영영 미노출.
- **수정 방향:** 미읽음 시스템공지 count도 별도 정확 집계.

### F3 🟡 긴급 전체공지 fan-out 제거 → aging out
- **위치:** `app/api/admin/system/announcements/route.ts:92`
- **메커니즘:** 긴급(전체) 시 per-manager ManagerNotice fan-out 제거. 대체 가상병합은 최근 50개 SystemAnnouncement만 읽고, SystemAnnouncementRead는 '읽음'만 기록(미읽음 영속 레코드 없음).
- **트리거:** 운영자 긴급공지 후 부재 매니저, 이후 일반공지 50+ → 복귀 시 긴급공지가 take:50 밖 → 벨·count·목록 어디에도 안 뜸. 슬로우번(공지 저빈도)이나 구 fan-out엔 없던 만료.
- **수정 방향:** 긴급공지는 per-manager 영속 미읽음 레코드 유지(중복표시는 dedup으로 해결).

### F4 🟡 (efficiency) 읽음행 무제한 fetch — 60초 폴링 핫패스
- **위치:** `app/api/manager/notices/route.ts:28`
- **메커니즘:** `systemAnnouncementRead.findMany({where:{managerId}})` — take·announcementId 필터 없음. AdminTopbar가 60초마다 폴링(:47), mark-all은 클릭당 최대 200행 생성.
- **트리거:** 1년치 공지 후 매 폴링마다 매니저별 수백 읽음행 전송. 자매 엔드포인트(admin/announcements:19)는 `announcementId:{in:...}` 패턴 사용.
- **수정 방향:** `announcementId:{in: 조회한 공지 id들}`로 제약.

### F5 ⚪ (cleanup) mark-all redundant diff
- **위치:** `app/api/manager/notices/route.ts:93`
- **메커니즘:** 읽음행 전량 fetch·메모리 diff 후 `createMany(skipDuplicates:true)`. `@@unique([announcementId, managerId])`(:1239)+skipDuplicates가 이미 dedupe하므로 read+diff 불필요.
- **수정 방향:** diff 제거, 200 id 그대로 createMany.

---

## G. CSV 내보내기 (커밋 50b1e3d)

### G1 🔴 CSV 수식 인젝션 우회 — `-숫자` DDE 페이로드
- **위치:** `lib/csv.ts:13`
- **메커니즘:** `if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s))` — 숫자면제 `/^-?\d/`가 문자열 **시작**만 검사. `-2+3+cmd|...`는 트리거 정규식 매칭+면제도 매칭 → 어포스트로피 미부착.
- **트리거:** 워커가 일지 내용을 `-2+3+cmd|' /C calc'!A0`로 저장 → 매니저 `/api/admin/export/csv?type=logs` 다운로드 → Excel이 수식으로 평가(명령실행 프롬프트). 저장형 인젝션. 관련 sink: 일지 content·evaluation·trainee.name·workerName·audit/access-log 라벨.
- **수정 방향:** 전체 셀이 숫자일 때만 면제(예 `/^-?\d+(\.\d+)?$/`).

### G2 🟠 정상 `+` 시작 값(국제전화) 손상
- **위치:** `lib/csv.ts:13`
- **메커니즘:** 면제가 `-`만 허용, `+`는 트리거만 매칭 → `+821012345678` 앞에 어포스트로피 부착.
- **트리거:** 전화 `+8210...` → `'+8210...`으로 내보내져 공단제출/급여import/DB 문자열 비교 실패.
- **수정 방향:** 전체 숫자/전화 형식 면제 개선(G1과 함께).

### G3 ⚪ csvBody 데드코드 + 로컬 복사본 헤더 미이스케이프
- **위치:** `lib/csv.ts:19` (import 0) · `app/api/worker/export/route.ts:24` · `app/api/admin/system/backup/route.ts:20`
- **메커니즘:** 이번 diff는 셀 이스케이퍼만 교체, 로컬 csvBody(헤더 `join(",")` 무이스케이프)는 유지. "CSV 단일 출처" 헤더 주석과 배치. 헤더가 한글 리터럴이라 실질 영향은 낮음.
- **수정 방향:** 두 라우트가 lib csvBody import, 로컬 복사본 삭제.

---

## H. Rate limit (커밋 17e7af7)

### H1 🔴 공개 서명 GET이 로그인용 리미터 공유 → 공유 IP 30분 락아웃
- **위치:** `app/api/sign/[token]/route.ts:23` · `lib/rateLimit.ts` (MAX 10/WINDOW 15분/BLOCK 30분)
- **메커니즘:** GET이 `checkRateLimit('sign-get:<ip>')`로 로그인 브루트포스용 정책을 IP만으로 공유. Upstash env 없으면 폴백은 인스턴스별 인메모리 Map(교차인스턴스 무보호).
- **트리거:** 사무실 NAT/모바일 CGNAT 뒤 사업체담당자들이 월말 서명링크를 15분 내 11회 열면(각 페이지로드=1 GET) 429·IP 30분 차단. 페이지는 429 분기 없어 일반 오류 표시. 서명 불가.
- **수정 방향:** `checkRateLimit`에 정책 옵션(`{max, windowSec, blockSec}`) 추가, 서명 조회는 느슨한 예산 사용.

---

## I. 클라이언트 상태 — 정정

### I1 ⚪ (REFUTED, 잠재) 워커 docs 딥링크 useEffect 빈 deps
- **위치:** `app/worker/docs/page.tsx:119`
- **판정:** 심층검증 결과 REFUTED(현재 트리거 불가). effect가 searchParams를 읽고 deps `[]`라 param 변경 시 재실행 안 하는 것은 사실이나, `/worker/docs?A→?B`를 리마운트 없이 도달할 경로가 없음(알림 링크는 `/worker/notices` 모달에서만 렌더→항상 리마운트, sw.js는 딥링크 미전달).
- **수정 방향:** 인페이지 딥링크 추가 시 대비해 deps에 searchParams 추가 또는 주석. 현재는 비차단.

---

## J. 품질 (비버그) — 재사용·설계고도·단순화·효율 🔵

- **서명 스토리지 경로 파서 3벌 drift → 삭제 시 PII 잔존 가능** — `app/api/worker/signature/route.ts:131`·`app/api/worker/profile/delete/route.ts:16`이 `lib/signatureImage.ts:22`의 `signaturePathFromStored`를 재구현. lib만 `decodeURIComponent`. URL 인코딩 경로 서명은 PDF엔 뜨지만 삭제 플로우에서 조용히 실패 → 스토리지에 PII 고아. **개인정보 앱이라 확인 권장.**
- **문서 payload 로직 6파일 30회 복붙** — generate/preview/sign(admin·worker)+buildDocPayload. 가드/로그/payload가 한 곳에 없어 C1·C2·C3 같은 drift 유발. `buildDocPayload`로 일원화 권장.
- **assignmentId 파싱 5~6회 중복** — `try{BigInt}catch` 인라인. `parseBigInt`(lib/adminScope) 또는 공유 헬퍼로.
- **1:多 판정 2벌** — `attendanceSheetPayload.ts:101`(출근부) vs `computeRun.ts:175 traineeCountOn`(급여). 경계 의미 drift 시 공식문서와 급여 불일치. `lib/traineePlacement`로 단일화.
- **traineeSiteGuard 인라인 3벌째** — `batch-voice-to-log:141`이 KST 경계 overlap 절 재인라인. 가드 일반화 후 호출.
- **sysLabel 3벌 + prefix 라우팅** — `notices:44`·`system-notices/page:15`·`manager/page:537`. AdminTopbar가 `[긴급 공지]` 리터럴 prefix로 라우팅해 라벨 변경 시 딥링크 파손.
- **rateLimit 단일 하드코딩 정책** — 라우트별 튜닝 불가(H1 근본원인).
- **다수 순차 await 병렬화 여지** — offers:76, respond:100, admin/assignments:115, docs preview/generate의 logAccess, contracts:78, batch-voice:132. 독립 쿼리 `Promise.all`로.
- **CSV writer 미일원화** — 이스케이프가 라우트별 조립에 의존(G1의 설계고도 근원).

---

## 권장 착수 순서

1. **급여 다시급 override 전면 재점검** — A1·A2·A3·A4·A5·A6·A9 (기능이 안 되거나 과지급/오지급). 이 기능은 사실상 재작업 필요.
2. **admin 문서 빈-PDF 공단발송 가드** — C1(+C2). 공식문서가 공단에 빈 채 나감.
3. **국민연금 clamp 무단전환** — B1·B2. 노무사 확정 전 잠정값 적용 방지.
4. **배정 겹침 우회** — E1·E2·E3. 새 가드가 핵심 경로에서 뚫림.
5. **CSV 인젝션·서명 rate-limit** — G1·H1. 보안/가용성.
6. **알림 미읽음 회귀·수정요청 딥링크** — F1·C4·C5. 사용자 도달 높음.
