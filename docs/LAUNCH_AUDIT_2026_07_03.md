# AbleLink 출시 전 외부 감사 보고서

- **감사일**: 2026-07-03
- **감사 방식**: 읽기 전용 코드 감사 (6개 영역 병렬). 수정은 미수행 — 지적·권고만.
- **감사 영역**: ① 인증·인가 ② 입력검증·시큐어코딩 ③ 데이터 정합성·비즈니스 로직 ④ 개인정보·컴플라이언스 ⑤ 인프라·설정·시크릿 ⑥ 기능·운영 견고성
- **대상**: Next.js(App Router) + Prisma + Supabase + Vercel, API 라우트 약 236개
- **주의**: 코드 밖(Vercel 대시보드 env·크론 실행 이력, Supabase 버킷 실정책, 운영 DB 실제 비밀번호)은 미확인 — 별도 체크리스트 필요.

---

## 요약 (심각도별 건수)

| 심각도 | 건수 | 성격 |
|---|---|---|
| **P0** | 0 | 즉시 차단급 (없음 — 스코핑·인증 골격은 견고) |
| **P1** | 12 | 출시 전 수정 강력 권고 |
| **P2** | 20 | 출시 직후 빠른 보완 |
| **P3** | 다수 | 인지 후 백로그 |

**총평**: 멀티테넌트 스코핑(agencyId), 세션/JWT 골격, 서명버킷 private 배선, AI 국외이전 동의 서버 강제 등 **보안 기반 구조는 이미 견고**하다(IDOR 표본 30여 개 통과). 남은 위험은 두 축에 집중된다 — **(A) 워커 일지·출근부 소급 입력이 검증 없이 급여·공단 제출 문서로 흘러드는 데이터 정합성 결함**, **(B) 외부 발송/결제 실패가 조용히 삼켜져 사용자가 잠기거나 돈만 나가는 운영 견고성 결함**. 컴플라이언스는 접속기록 커버리지와 위치정보 동의 게이트가 핵심 공백.

---

## P1 — 출시 전 수정 강력 권고

### [P1-1] 워커 일지 저장 API 크로스테넌트 IDOR (소유권 미검증) ★직접 검증 완료
- **파일**: `app/api/worker/logs/save/route.ts:35-37, 48-54, 65-66, 89-113`
- **증상**: 인증된 워커가 body로 넘긴 값을 소유권 검증 없이 그대로 사용.
  - `attendanceId`(L65-66)를 `workerId` 일치 확인 없이 `BigInt()`로 사용 → **타 워커 출근기록에 일지 부착**
  - `findOrCreateAttendance`(L48-54)가 body의 `siteId`/`assignmentId`가 본인 배정인지 확인 없이 `DailyAttendance` 생성
  - 신규 생성 경로에서 `traineeId`(L94)가 본인 배정 훈련생인지 미검증 → **타 기관 훈련생 일지 생성**
- **대비**: 수정 모드(`logId`, L77-86)는 writer 소유권을 검사함. `batch-save`(L41-47)는 `assignment.workerId` 검사, `docs/generate`는 훈련생 `agencyId` 검사 — **save 경로만 누락**.
- **영향**: 오염된 일지·출근기록이 출근부/훈련일지 PDF(공단 제출)와 급여 계산에 반영.
- **권고**: `traineeId`→본인 배정 현장(`site.agencyId`) 검증, `attendanceId`→`workerId` 일치 강제, 신규 경로도 `assignmentId.workerId === writerId` 확인.
- *(②·⑥ 에이전트 공통 지적, 본인 원문 재확인)*

### [P1-2] 일지 소급 저장이 "시각 없는 확정 출근부"를 만들어 급여에 산입
- **파일**: `app/api/worker/logs/batch-save/route.ts:63-81`, `app/api/worker/logs/save/route.ts:42-54`, `lib/attendance/payrollGate.ts:70-78`, `lib/payroll/computeRun.ts:161-171,257-265`
- **증상**: 과거 날짜에 출근기록이 없으면 `startTime/endTime=null, status:DONE, isFinalClosed:true`로 DailyAttendance 자동 생성(배정기간·status 검증 없음). payrollGate는 실측시각 null이면 보정대기로 안 잡으므로 이 합성 행이 `workedDays`로 집계 → **DAILY는 일급 전액, MONTHLY는 일할 비율 증가**(HOURLY만 0).
- **모순**: 출근부 PDF는 같은 날을 '보정대기(0h)'로 표기 → **문서와 급여가 서로 다름**. 매니저 승인 없이 워커가 일지 일괄작성만으로 급여·공단자료 소급 부풀리기 가능.
- **권고**: 소급 생성 행에 `syntheticBackfill` 플래그(또는 `isFinalClosed:false`), 급여·출근부 집계에서 매니저 확인 전 제외.
- *(③·⑥ 공통 지적)*

### [P1-3] 면제(자동기록) 배정 cron이 배정기간 필터 없이 매일 출근부 생성 → 무기한 급여 발생
- **파일**: `app/api/cron/daily/route.ts:162-167`, `app/api/worker/attendance/bulk-generate/route.ts:85-175`
- **증상**: 조건이 `attendanceButtonExempt:true, status ∈ {ACTIVE,CONFIRMED,ASSIGNED}`뿐, `startDate ≤ 어제 ≤ endDate` 검사 없음. 배정은 endDate 경과해도 자동 ENDED 전이가 없음.
- **시나리오**: 8/1 시작 예정 면제 배정을 7/20 생성 → 7/21부터 매일 `isFinalClosed:true` 출근부 생성 → 7월 급여 산입. 종료 후 배정 정리 누락 시 무기한 지급.
- **권고**: 두 경로에 `assignment.startDate/endDate` 범위 필터 추가 + endDate 경과 배정 자동 ENDED 배치.

### [P1-4] 출근부 PDF의 1:1/1:多 판정이 급여 계산과 상충 (공단 문서 ↔ 급여 불일치)
- **파일**: `lib/docs/attendanceSheetPayload.ts:92-99` vs `lib/payroll/computeRun.ts:118-129`
- **증상**: 급여 엔진은 "기간 전체 count는 비동시 재적을 2로 세어 오판"이라며 **일자별 동시 재적**으로 판정하는데, 출근부 payload는 정확히 그 금지된 방식(기간 겹침 `count()`≥2 → 기간 전체 `isMulti`) 사용.
- **시나리오**: 훈련생 A(7/10 종료)·B(7/20 합류) → 7월 출근부는 전 일자 1:多로 공단 제출, 급여는 전 일자 1:1 단가.
- **권고**: 출근부도 computeRun과 동일한 일자별 `traineeCountOn` 로직으로 통일(단일 출처 함수라 1곳 수정으로 6개 라우트 전파).

### [P1-5] 급여계약(PayContract) 월중 변경 시 그 달 급여가 통째로 0원 (조용한 0)
- **파일**: `lib/payroll/computeRun.ts:101-108`, `app/api/admin/payroll/contracts/route.ts:85-90`
- **증상**: 계약 선택 조건이 `effectiveFrom ≤ 월초 AND (effectiveTo=null OR ≥ 월말)` — **월 전체 커버 계약만** 인정. 신규 계약 등록 시 구계약을 `effectiveTo=신규 effectiveFrom`으로 마감하므로, 7/15 시급 인상 시 구·신 계약 모두 탈락 → `note:"급여 계약 없음"`, grossPay 0으로 DRAFT 생성. 0원이라 놓치면 그대로 확정 가능.
- **권고**: 월내 계약 기간분할 적용, 또는 겹치는 계약 있는데 월 전체 미커버면 경고/에러 승격.

### [P1-6] 급여 재계산 POST가 동시 확정과 경합 시 확정 급여를 삭제
- **파일**: `app/api/admin/payroll/runs/route.ts:61-78`, `app/api/admin/payroll/runs/[runId]/route.ts:141-175`
- **증상**: FINALIZED 검사를 트랜잭션 **밖**에서 하고 트랜잭션 안에서 조건 없이 `delete`. 검사~삭제 사이 확정이 끼면 **확정본 삭제 + 새 DRAFT 대체**(이미 명세서 알림 발송된 상태).
- **권고**: 트랜잭션 내 `deleteMany({where:{id, status:"DRAFT"}})` CAS + count 검증. 확정 POST도 `updateMany({where:{id, status:"DRAFT"}})` 가드(중복 확정·중복 알림 방지).

### [P1-7] 신규 직무지도원 온보딩 체인 침묵 실패 (임시비밀번호+배정연결 유실)
- **파일**: `app/api/worker/contracts/route.ts:242-281, 293-312`
- **증상**: 신규 워커 계약 서명 시 ①비밀번호를 임시비밀번호로 **먼저 덮어씀**(L304) ②알림톡 전달(L306) ③배정 connectedAt 기록. 전체가 하나의 try, 실패 시 `console.error`만 남기고 응답은 "서명 완료". 알리고 장애/잔액소진 시 워커는 **알 수 없는 비밀번호로 잠기고** connectedAt 미기록으로 출근이 `ASSIGNMENT_NOT_CONNECTED` 영구 차단. `KAKAO_SIGNUP_TEMPLATE_CODE` 미설정 시 임시비밀번호 발급 자체 스킵(L298-301).
- **권고**: 알림톡 성공 후 비밀번호 갱신으로 순서 역전, 또는 실패 시 ManagerNotice·응답 실패 플래그.

### [P1-8] 최초 구독결제: 과금 성공 후 DB 갱신 실패 시 '돈만 나감' + 결제 웹훅 부재
- **파일**: `app/api/payments/billing/route.ts:91-138`, `app/api/payments/charge/route.ts:58-131`
- **증상**: 토스 실과금 성공(L91) 후 agency 업데이트(L123)가 별도 실행 — DB 오류 시 카드는 결제됐는데 플랜 FREE·billingKey 미저장(authKey 일회성이라 재시도 불가). **웹훅 라우트 전무**해 토스 상태와 정합 검증 불가. 월 정기결제 크론은 3일 유예 후 **사전 통보 없이 FREE 강등**.
- **권고**: 과금 전 빌링키 선저장, 과금 성공→DB 실패 시 보상(환불)/재시도 큐, 토스 웹훅 수신, 강등 전 ManagerNotice.

### [P1-9] 결제 크론 메서드 불일치 — 매일 405, 자동결제 미실행 가능성 (매출 직결)
- **파일**: `vercel.json:9`, `app/api/payments/charge/route.ts:27`
- **증상**: vercel.json이 `/api/payments/charge`를 크론 등록했으나 라우트는 `POST`만 export. **Vercel Cron은 GET으로만 호출** → 매일 405, 월 자동결제·유예재시도·강등 로직 전부 미실행 가능. (`/api/cron/daily`는 GET이라 정상)
- **권고**: charge에 GET 핸들러 추가, Vercel 크론 실행 로그로 200 확인. 외부 스케줄러로 POST 호출 중이면 문서에 명시.
- *비고: 외부 스케줄러 사용 여부는 코드 밖 — 반드시 실행 이력 확인.*

### [P1-10] 개인정보 접속기록(안전성확보조치 제8조) 커버리지 공백 — 대량 열람·출력 미기록
- **파일**: `lib/accessLog.ts`(헬퍼는 적정), 호출부 5곳뿐 — `admin/workers/[id]`, `worker-accounts/[id]`, `payroll/items/[itemId]/payslip`, `trainee-report`, `contracts/[id]`
- **미기록 민감 경로**: `admin/trainees`(생년월일·전화·보호자연락처·장애유형·중증도 전체), `admin/export/csv`(성명+전화 전 행), `admin/document-runs/zip`·`document-versions/[id]/pdf`·`audit-package`(서명·PII 스냅샷 일괄 출력), `admin/system/backup`(전 기관 PII 일괄 다운로드), `admin/attendances`, `admin/logs`(훈련생 일지 열람)
- **근거**: 제8조는 취급자의 열람·**출력** 기록 요구. 특히 민감정보(장애)와 대량 출력(CSV/ZIP/백업)이 기록 밖.
- **권고**: 목록형=view 1건, 출력형=export/print 필수. 최소 `trainees`·`export/csv`·`document-runs/zip`·`audit-package`·`system/backup` 5곳 출시 전 배선.
- *(④·⑤ 공통 지적, backup은 ⑤에서도 별도)*

### [P1-11] 회원탈퇴 시 계좌정보·생년월일 미파기
- **파일**: `app/api/worker/profile/delete/route.ts:60-85`
- **증상**: 익명화 대상에서 `bankName`·`accountNumber`·`accountHolder`·`bankCode`·`birthDate`·`accountVerifiedAt`·`consentAiCrossBorderAt` **누락** → 탈퇴 후에도 계좌번호·생년월일 평문 무기한 잔존.(loginId·전화·ciKey·서명·주소는 정상 파기)
- **근거**: 개인정보보호법 제21조(파기). 법정 보존 필요분은 근거·기간 명시 후 분리보관, 아니면 즉시 null.

### [P1-12] GPS 위치정보 수집 동의 게이트 부재
- **파일**: `app/worker/invite/[id]/page.tsx:234`(위치동의 `required:false`), `app/api/recruit/auth/signup/route.ts:30`(약관·개인정보만 검증), `app/api/attendance/clock-in/route.ts:242-245`(`startLocLat/Lon`·거리 저장 시 `consentLocationAt` 미체크)
- **증상**: `consentLocationAt` 소비처 0 — 동의가 "선택"인데 GPS 출퇴근은 사실상 필수, 동의 없이 좌표가 DB 저장.
- **근거**: 위치정보법 제15조(동의 없는 개인위치정보 수집 금지).
- **권고**: 출퇴근(APP_GPS) 최초 사용 시 `consentLocationAt` 서버측 게이트(403, AI 국외이전 게이트와 동일 패턴).

---

## P2 — 출시 직후 빠른 보완

### 보안·인가
- **[P2] 레이트리밋이 스푸핑 가능한 `x-forwarded-for` 최좌측 값 사용 → 브루트포스 우회.** `worker/manager/admin` 로그인 3역할·OTP·비번초기화·upload/business-doc·geo 공통. `X-Forwarded-For` 무작위 변경 시 IP 카운터 매번 새 버킷. → 신뢰 IP(`x-real-ip`/`request.ip`) 사용. (`app/api/worker/auth/login/route.ts:27` 외 6곳)
- **[P2] 레이트리밋 인메모리 폴백 — 서버리스 다중 인스턴스에서 무효 + Redis 장애 시 fail-open.** Upstash env 미설정/장애 시 프로세스별 Map으로 조용히 폴백, 인스턴스 간 미공유. → 운영에서 Upstash 미설정 시 로그인 경로 차단/경고. (`lib/rateLimit.ts:56-103`)
- **[P2] 비밀번호 변경·초기화 시 기존 JWT 세션 무효화 안 됨.** 순수 stateless JWT, `passwordChangedAt`/`tokenVersion` 축 부재. 워커 토큰 90일(롤링)이라 탈취 후 비번 변경해도 공격자 세션 최장 90일 유지. → `sessionEpoch` 컬럼 도입, 변경 시 증가. (`app/worker/_lib/session.ts:63-71` 등)

### 데이터 정합성·급여
- **[P2] 주휴수당 월 경계 주 과소지급.** 개근 판정을 급여월 내 출근일만으로 함 → 월초·월말 걸친 주는 실제 개근이어도 부적격, 매달 1~2주 반복 누락. (`computeRun.ts:349-366`, `weeklyHoliday.ts:119-127`)
- **[P2] 4대보험 판정이 '실근무' 기준 → 월별 가입 플립.** 결근·보정대기로 60h/8일 경계 넘나들면 국민연금·건강 공제가 달마다 on/off. → 소정근로(계약) 기준 판정. (`computeRun.ts:419-437`, `insuranceEligibility.ts:87-94`)
- **[P2] 보험료 산정 = grossPay×요율 (기준소득월액·상하한 미적용).** 국민연금 기준소득월액 클램프 미구현 — '표준소득월액' 잔여. 출시 시 한계 고지 필요. (`computeRun.ts:466-472`)
- **[P2] 세액 계산 부양가족 하드코딩**(`dependents=1`). 워커별 부양가족 모델 없음, 수동 PATCH도 재계산 시 리셋. (`computeRun.ts:407-409`)
- **[P2] 세액표·보험요율 미설정 시 조용한 0 공제.** `IncomeTaxTable`/`InsuranceRates` 행 없으면 소득세 0·보험 skip인 채 확정 가능. → DRAFT 화면 경고. (`computeRun.ts:463-472`)
- **[P2] PayContract.incomeType 기본값 BUSINESS(3.3%).** 근로계약서 없는(미서명·소급) 근로자가 조용히 3.3% 사업소득 처리, `freelancerOverride`가 근태보다 우선. → 기본값 EMPLOYMENT로 뒤집거나 명시 입력 필수. (`schema.prisma:1018`, `contracts/route.ts:76`)
- **[P2] 프리랜서 3.3% 입력 경로 개념 혼재**(INTERNAL 직원 강제 BUSINESS). 메모리 감사잔여 ①과 일치. (`admin/payroll/contracts/route.ts:76`)

### 트랜잭션·레이스
- **[P2] TraineeLog 중복 방지 유니크 제약 없음** — `@@unique([attendanceId, traineeId])` 부재 + findFirst→create. 더블탭 시 일지 2건 → 수정 시 409 교착, 훈련생 수/배율 판정 왜곡. 과제 저장도 트랜잭션 밖. → 유니크 + upsert + `$transaction`. (`schema.prisma:438-461`, `logs/save/route.ts:89-127`)
- **[P2] 근태 수정요청 승인이 비트랜잭션 2단계 쓰기.** APPROVED 커밋 후 출근부 update 실패 시 '승인됨+미반영'인데 워커엔 "반영됨" 알림. (`admin/attendance-edit-requests/[id]/route.ts:46-67`)
- **[P2] 문서 제출 DocumentRun 중복 생성 가능.** `@@unique(...traineeId)`에서 traineeId=null(출근부)은 Postgres NULL 중복 허용 → 동시 제출 시 run 2건. → advisory lock 또는 센티널 값. (`worker/docs/submit/route.ts:87-107`)
- **[P2] 급여 확정 더블클릭 레이스 → 명세서 알림 중복 발급.** 상태 확인·update 사이 가드 없음(`where:{id}`만), 결과는 멱등이나 WorkerNotice 전원 2회. (`admin/payroll/runs/[runId]/route.ts:145-157`)

### 상태머신·정합
- **[P2] 닫힌 배정 행 재사용 시 게이트 흔적 미초기화.** DROPPED/EXPIRED 재사용 시 `connectedAt/confirmedAt/baseConfirmedAt` 유지 → 재요청 배정이 연결·위치확정 게이트를 이전 이력으로 우회. 기존 DailyAttendance·DocumentRun도 assignmentId 공유. (`admin/assignments/route.ts:253-309`)
- **[P2] 현장 소프트삭제(isActive=false) 후에도 출근·급여 지속.** 활성 배정 그대로, clock-in·cron 모두 `site.isActive` 미검사. (`admin/sites/[id]/route.ts:343`)
- **[P2] 멀티현장 시간겹침 검증 부재(알려진 잔여).** 요청 흐름(REQUESTED→ASSIGNED)은 동시 복수현장 진입 가능, AM/AM 겹침 검증 없음. (`assignments/route.ts:224-235`)

### 운영 견고성·외부발송
- **[P2] 근태 인박스 요청·배정확정 알림이 본작업과 비원자적(침묵 유실).** 상태 변경 커밋 후 WorkerNotice/ManagerNotice가 `catch{/*비치명적*/}`. 수정·보완요청 미도달 시 급여 보정대기 미해소인 채 급여일 도래. (`admin/attendance-inbox/[id]/*`, `assignment-requests/route.ts:178-193`, `cron/daily`)
- **[P2] 기관 공지 fan-out 실패 무시 → 워커 전원 미수신인데 성공 응답.** URGENT 공지도 동일. (`admin/agency-announcements/route.ts:76-95`)
- **[P2] 공단 문서발송: 그룹 내 개별 PDF 렌더 실패분이 조용히 누락된 채 발송.** 실패분 `continue`로 첨부 제외(해당 run 정합은 유지), 매니저는 일부 미발송 인지 어려움. *(정합 핵심 — 발송 성공분만 SUBMITTED 마킹 — 은 올바르게 구현됨)*. (`admin/document-runs/send/route.ts:137-141,174-199`)
- **[P2] 오프라인/네트워크 오류 시 출퇴근 버튼 무피드백.** `doAttendance` catch 없음, fetch 예외 시 토스트 없이 버튼만 풀림. *(서버측 중복 방지는 `@@unique([assignmentId,workDate])`+자가치유로 견고)*. (`app/worker/home/HomeClient.tsx:437-571`)
- **[P2] AI 음성: 단건 호출 무제한 + 외부 API 타임아웃 없음.** 단건 STT 횟수 제한 없음(일괄만 월한도), Groq/Gemini fetch에 `AbortSignal.timeout` 미설정. (`worker/ai/voice-to-log/route.ts:96-100,172-182`)
- **[P2] cron/daily 부분 실패해도 항상 200 + success:true.** errors 배열 쌓여도 성공 응답 → 모니터링으로 누락 감지 불가. (`cron/daily/route.ts:434-438`)

### 개인정보
- **[P2] 계좌번호·훈련생 민감정보 평문 저장 + 방침 "저장 시 암호화" 문구 불일치.** 컬럼 암호화 코드 전무, 방침(`PrivacyPolicyContent.tsx:34`)은 "저장 시 암호화" 명시. *(주민번호 미수집·비번 bcrypt는 양호)*. → 계좌번호 컬럼 암호화 또는 방침 문구 수정. (`schema.prisma:44-46,328-334`)
- **[P2] 목록·CSV 마스킹 부재.** worker-accounts 목록에 계좌번호 전체, trainees에 보호자연락처·생년월일 전체, CSV에 전화 전체. → 목록=마스킹, 상세=전체+접속기록. (`admin/worker-accounts/route.ts:70-83` 등)
- **[P2] 감사로그(AuditEvent) 마스킹 화이트리스트 누락.** `SENSITIVE_KEYS`에 `disabilityType`·`severity`·`note`·훈련생 `name`·`loginId` 부재 → 장애정보가 /admin/audit로 2차 노출. (`lib/audit.ts:31-36`, `admin/trainees/route.ts:102`)
- **[P2] SMS 스텁이 전화번호+본문 원문 콘솔 출력.** env 누락 시 Vercel 로그에 번호·인증코드성 본문. (`lib/sms.ts:15`)
- **[P2] AI 배치 파싱 실패 시 일지 원문(훈련생 성명 포함) 로그 출력.** (`worker/ai/batch-voice-to-log/route.ts:273`)
- **[P2] 훈련생 정보 국외이전 동의 주체가 워커뿐.** 국외이전 정보주체는 훈련생(장애인)인데 훈련생·보호자 동의 장치 없음(방침 고지는 충실). → 위탁계약 명문화 + 훈련생 등록 시 보호자 동의 확인란. 개보법 제28조의8. (`worker/ai/voice-to-log/route.ts:92`)

### 인프라
- **[P2] 운영자 전체 백업(대량 PII export)에 AccessLog 미기록.** *(P1-10에 통합)*. 인증·즉시응답·해시 미포함은 양호. (`admin/system/backup/route.ts:38-117`)
- **[P2] DB 쓰기 스크립트 다수가 dbGuard 없이 DATABASE_URL 직결.** `fix-worker-loginid`·`fix-site-coords`·`fix-attendance-sheet-snapshots`·`backfill-*`·`create-admin` 등. 복구 절차상 `.env.prod.bak`→`.env` 복사 시 운영 DB 무경고 쓰기. → 전 스크립트 `assertWritableDb()` 추가.
- **[P2] API catch가 error.message 원문을 클라이언트 반환(7곳).** Prisma 에러 메시지에 테이블/컬럼명 포함 가능. → 고정 문구 통일. (`worker/holidays`·`logs/save`·`logs/batch-save`·`docs/generate`·`docs/inperson-sign`)

---

## P3 — 인지 후 백로그

### 보안·암호
- CRON/payments 시크릿 비교가 비상수시간(`!==`) — `crypto.timingSafeEqual` 권고. *(단, CRON_SECRET 미설정 시 fail-closed는 올바름)*. (`cron/daily:30`, `payments/charge:31`)
- 로그인 타이밍공격 방지용 더미 bcrypt 해시가 형식 오류(`$2b$12$invalidhash...`) → salt 규격 불일치로 즉시 false 반환, 사용자 열거 타이밍 차이 재발생 우려. → 유효한 bcrypt 상수 사용. (`worker/manager/admin auth/login`)
- bcrypt 코스트 불일치(10 vs 12) — 전역 상수(12)로 통일. (`lib/password.ts:4`)
- 워커 로그인 레이트리밋 키에 loginId 포함 → IP 단위 패스워드 스프레이 미제한. (`worker/auth/login/route.ts:28`)
- CSP 헤더 부재 — 심층방어로 추가 권고. *(HSTS·X-Frame·nosniff·Referrer·Permissions는 적용됨)*.
- 서명 이미지 파일명 `Date.now()`만 사용(버킷 private 시 저위험), DB에 'public' 형식 URL 문자열 잔존 — 경로 저장 방식 전환 권고. `imageToDataUri` 리다이렉트 미차단(허용 호스트 제한은 됨).

### 데이터·급여 (정밀 이슈)
- 공휴일 정적 데이터 2027년까지 — 2028+ 미인식 시한폭탄. (`lib/krHolidays.ts`)
- payLines 합계 ≠ grossPay ±1원(라인별 vs 총액 반올림). (`computeRun.ts:379-386`)
- cron 계약만료 D-알림 중복 방어 없음(2회 실행=중복 알림). 만족도 dup 체크 레이스.
- cron 시간대 기준 혼재(만족도 UTC창 vs 만료알림 KST창) — 하루 어긋남 가능.
- UTC 날짜 슬립(`worker/docs/preview:28`, `generate:64-65`, `computeRun:413`) — KST 00~09시 하루 밀림.
- ENDED 배정 endDate 미기록 → 매월 0원 행 노이즈. (`admin/assignments/[id]/route.ts:38`)
- 주휴 개근 판정에 주말·휴일 출근 산입(평일 결근을 일요일 근무로 상쇄). (`weeklyHoliday.ts:119-125`)
- clock-out 배정 미지정 시 임의 선택(멀티현장 오전·오후 둘 다 WORKING). (`clock-out/route.ts:100-119`)
- 배정 최종확정 정원 검사 TOCTOU(동시 확정 시 초과). (`assignment-requests/route.ts:160-180`)
- clock-in 레이스 시 P2002가 일반 500 "서버 오류"로 노출. (`clock-in/route.ts:268-274`)
- `DocumentRunStatus.CLOSED` 미사용(죽은 상태값), 출근부 totalDays에 보정대기 0h 행 포함(일수·시간 합계 불일치). (`attendanceSheetPayload.ts:161`)
- bulk-generate 행 `isFinalClosed` 미설정 → 과거 일괄생성분 confirm-month 전까지 급여 누락 위험.

### 개인정보·운영
- Kakao Local(주소검색) 수탁 미고지 + 무인증 프록시(키 남용) — 수탁표 추가+세션 인증. (`geo/search-address`, `coord2address`)
- AI 국외이전 동의 철회 셀프서비스 부재(DELETE 없음) — 프로필 내 철회 버튼. (`worker/ai/consent/route.ts`)
- 로그 보유기간 미정의(AccessLog·AuditEvent 파기 크론 없음), 방침 제3조에 항목별 보유기간(접속기록·위치·급여) 미기재.
- Gemini API 키를 URL 쿼리스트링 전달(로그 노출) — 헤더 전환. (`voice-to-log/route.ts:173`)
- 구독 해지 시 토스 빌링키 로컬 삭제만, 토스측 파기 미호출(추가 과금은 없음, 키 위생). (`payments/cancel/route.ts:18-30`)
- 계약서 알림톡 실패는 표면화되나 재발송 버튼·재시도·tokenSentAt 미기록. (`admin/contracts/route.ts:334-344`)
- 워커 초대 SMS 실패 warn만(화면 코드 표시로 완화). (`admin/workers/invite/route.ts:66-72`)
- CSV/XLSX 수식 인젝션 미방어(`=`,`+`,`-`,`@` 시작 셀 미중화, 일지 content 사용자 입력). (`admin/system/backup/route.ts:19-26`)
- 전역 에러 바운더리(`app/global-error.tsx`) 부재 — 런타임 오류 시 흰 화면.
- 루트 잔재 파일 git 추적(`test_*.mjs` 4종, 0바이트 `git`, 빈 `app/api/logs/`) — 자격증명 없음·미배포, 위생만.
- 시드 기본 비밀번호(`admin1234!` 등)가 저장소·문서 공개 — 운영 계정이 기본값과 다른지 출시 전 확인 필요(코드 밖).
- 문의 첨부 업로드가 확장자만 검증(magic-byte 없음) + Content-Type 클라 값 신뢰. (`lib/supportStorage.ts:60-72`)
- business-doc 업로드가 완전 미인증(IP 레이트리밋만) — orphan 청소·TTL 정책. (`upload/business-doc/route.ts`)
- 워커 프로필 문자열 필드 길이 상한 없음(데이터 팽창). (`worker/profile/route.ts:44-86`)
- 의존성: Prisma `^5.19.0`(구세대), `@aws-sdk/client-ses`+`resend` 이중 메일 스택 — 출시 후 정리 권고.

---

## 양호 확인 항목 (감사 통과 — 회귀 방지용 기록)

- **멀티테넌트 스코핑**: `requireManagerSession`이 토큰·DB agencyId 재대조, `resolveScopeAgencyId`가 요청 agencyId 무시하고 본인 것 강제. 동적 라우트 30여 개 IDOR 표본 전부 통과.
- **세션/쿠키**: 3역할 모두 httpOnly·sameSite=lax·secure(운영)·path=/, 로그아웃 maxAge:0. 역할별 분리 JWT 시크릿·audience, 매 요청 DB 재검증(isActive/status).
- **공개 토큰 엔드포인트**: sign/sign-self/survey/invite 토큰 randomUUID(128bit)·만료·1회성(원자적 updateMany claim). selfSignToken Redis 10분 TTL.
- **SQL 인젝션 없음**: `$queryRaw*`/`$executeRaw*` 앱코드 전무(scripts만). XSS: `dangerouslySetInnerHTML` 전무, React 자동 이스케이프, PDF는 pdfkit(HTML 미사용). SSRF: 사용자 URL 직접 fetch 없음, 외부 fetch 호스트 고정.
- **토큰/암호**: OTP·임시비번·리셋코드 전부 CSPRNG(`crypto.randomInt`/`randomUUID`). phone OTP SHA-256 해시+레이트리밋. `Math.random` 보안 용도 없음.
- **AI 국외이전 동의 서버 강제**: 처리 엔드포인트 2개 모두 STT 호출 전 DB 재조회 403 차단, UI 우회 불가.
- **필수 동의 서버 강제**: 약관·개인정보 400 강제 + 타임스탬프. 방침 국외이전 조항 법정 기재사항 충족, /privacy·/terms + 인앱 모달 존재.
- **주민번호 미수집·신분증/통장 원본 비보관** 코드 확인. 비밀번호 bcrypt. 서명버킷 private+signed URL 소비 11곳 일관(B3 배선).
- **출퇴근 중복 방지**: `@@unique([assignmentId,workDate])`+자가치유. 급여 run 중복 `@@unique([agencyId,yearMonth])`+크론 존재검사. 문서 제출(worker/docs/submit) `$transaction`+훈련생 소속검증+레이트리밋.
- **결제 월과금 크론**: 결정적 orderId+optimistic lock으로 이중과금 방지. 공단 발송 SUBMITTED 마킹은 이메일 성공분만(정합 올바름).
- **환경분리**: `outboundGuard`(dev 외부발송 차단), `_dbGuard`(파괴적 스크립트 CONFIRM 강제), 보험/세액 시드 이중방어. health 엔드포인트 정보 무유출. 시크릿 git 히스토리 0건, .gitignore 적정.
- **보안 헤더**: HSTS(preload)·X-Frame-Options·nosniff·Referrer-Policy·Permissions-Policy 적용. next.config에 `ignoreBuildErrors` 없음.

---

## 출시 전 코드 밖 확인 체크리스트 (코드로 검증 불가 — 운영자 직접 확인)

1. **결제 크론(P1-9)**: Vercel 크론 실행 로그에서 `/api/payments/charge` 200 여부, 또는 외부 스케줄러 POST 사용 여부.
2. **운영 계정 비밀번호**: admin/manager 실제 비번이 시드 기본값(`admin1234!` 등)과 다른지.
3. **Supabase 버킷 정책**: `signatures`·`business-docs`·`support` 버킷 실제 private 여부(코드는 private 전제).
4. **Upstash Redis(P2 레이트리밋)**: 운영 env `UPSTASH_REDIS_REST_URL/TOKEN` 설정 여부 — 미설정 시 브루트포스 방어 무력.
5. **알림톡 템플릿 코드**: `KAKAO_SIGNUP_TEMPLATE_CODE` 등 env 설정 여부(P1-7 연동).
6. **로그 보유기간**: Vercel 런타임 로그에 PII(전화·일지 원문) 잔존 기간.
