# 전수 심층 감사 종합 (2026-07-16, HEAD 7249f65)

12개 병렬 감사(인증·근태/문서·급여엔진·배정/정원/마켓/결제·전 API IDOR 247개·데이터정합성/cron/스토리지/PII + 연차·CSP·급여변경·횡단 스윕). 전부 읽기 전용. 수정 착수 전 사용자 확인 대기.

## 총평
- **P0 없음. 악용 가능한 라이브 P1(인증우회·크로스테넌트 유출·정원초과·금액조작) 없음.**
- IDOR 247개 라우트 결함 0, 정원 chokepoint 위반 0, 근태 소유권 위반 0, 노무사 판정 7건 전부 온전, 마이그 드리프트 0, 금액 Float 0, 외부발송 우회 0, service-role 클라 유입 0.
- 실질 조치 대상: **오늘 배포 코드의 정합성 결함 1건(연차 승인 동시성)** + 기존 코드 P2 다수 + **노무사 확인 필요 1건(월급제 휴일근로)**.

## 심각도순 발견

### [FIX-1·오늘코드·P2] 연차 승인/등록 동시성 — USE 원장 이중 차감
- `app/api/admin/leave/requests/[id]/route.ts:44,84` — 승인/반려 `update({where:{id}})`에 `status:"PENDING"` 가드 없음. 바깥 findFirst(36행) read-then-write가 동시요청 간 유지 안 됨.
- `app/api/admin/leave/[workerId]/route.ts:119` — use 잔여검사가 $transaction 밖 + 같은날 중복 무검사.
- **결과**: 더블클릭/매니저 2명 동시 승인 → USE −days 2행, ledgerEntryId(unique 아님) 나중것만 남아 앞행 고아. 잔여 음수 가능(READ COMMITTED에서 aggregate 미잠금).
- **완화**: 음수 잔여는 rose 배지 노출·ADJUST 정정 가능, 자금유출 없음(원장 신뢰성만). 3개 감사(①②F)+직접검증 수렴.
- **수정**: `updateMany({where:{id,agencyId,status:"PENDING"}})+count===0→409` (같은 저장소 계약서명 라우트 패턴). +선택: `AnnualLeaveRequest` PENDING·`AnnualLeaveEntry` (payrollItemId,PAYOUT)/(workerId,effectiveDate,USE) partial unique.

### [노무사확인·기존·P1후보] 월급제 휴일근로 기본임금 100% 누락
- `lib/payroll/computeRun.ts:376,384,386` — MONTHLY 분기에서 공휴일은 proRateDaySet 제외+schedDays 상한이라 기본급에 안 실림, 가산 0.5배만. 토요일(무급휴무) 근무는 가산조차 0.
- 예: 월급 209만(통상시급 1만) 광복절 8h 근무 → 현재 4만(0.5배)만, 법정 12만(100%+50%) → **8만 과소**.
- **주의**: 기존 엔진 동작·노무사 큐 7건에 미포함·월급제 휴일가산율은 해석여지. HOURLY/DAILY는 정상(paidHours/dayMulti에 포함). **확정 버그 아님 — 노무사 확인 후 조치.**

### [기존·P2] 급여 정합성 4건
- **휴일 8h초과가 연장으로 발생 시 0.5배 과소**: `computeRun.ts:434`·`nightHoliday.ts:37` — 휴일 span이 고정 endTime 기준(연장 미포함). 공휴일 FULL+2h연장=10h → 초과2h가 연장1.5로만, 법정 2.0 → 2만원 과소.
- **확정↔PATCH TOCTOU**: `runs/[runId]/route.ts` PATCH가 item update 트랜잭션에서 run status 재확인 없음 → FINALIZED run 항목 사후변경 가능(명세서 on-demand라 확정본과 불일치).
- **연차 PAYOUT 고아 이중정산**: 정산 후 급여 재계산(DRAFT 재생성→cascade 삭제)으로 수당라인 소실, 원장 −일수 잔존, 재정산 시 payrollItemId 새 id라 미탐 → 이중차감.
- **세액·고용보험 서버 미강제**: 세액 재계산이 클라이언트 저장 시에만, 지급라인 추가 시 고용보험(0.9%) 재계산 클라·서버 모두 없음.

### [기존·P2] 문서 PDF 스코핑 — 잠재 크로스테넌트
- `document-versions/route.ts:57,125`·`[id]/pdf:53`·`document-submission-logs:55,109`·`document-runs:226` — `assignment.site.agencyId`로 스코프(근태가 18차에 종결한 `assignment.agencyId` 단일소스 규율 미적용).
- **현재 잠재**: 생성경로에서 site.agencyId=assignment.agencyId 일치(감사D 확인)라 미악용. 공유현장 divergence 시 타기관 워커 제출본 PDF(PII) 열람+정당매니저 403. 근태와 동일하게 run.agencyId로 통일 권고.

### [기존·P1/P2] 대량 PII·민감정보 접속기록(제8조) 누락
- `admin/system/backup`(전기관 근태 성명+연락처 반출)·`admin/trainees` GET·`admin/sites/[id]/trainees`(생년월일·보호자연락처·**장애유형/정도**) 목록에 logAccess 없음. 상세 1건은 기록되는데 목록·대량 export가 빠짐 → 유출 시 소명 불가.

### [기존·P2] 인증·플랜
- **워커 로그인 레이트리밋 계정별 예산**(`worker/auth/login:30` `login:${ip}:${loginId}`) — admin/manager는 IP전역인데 워커만 계정포함 → 패스워드 스프레이 미차단.
- **Redis 폴백 서버리스 무력**(`lib/rateLimit.ts:104`) — Upstash 장애 시 인메모리 Map은 인스턴스별·휘발 → 브루트포스 창.
- **매니저측 공식문서 PDF·공단발송 무플랜게이트**(`admin/docs/generate:31`·`document-runs/send:39`) — FREE 기관 매니저 무제한(정책 의도 확인 필요).

### [오늘코드·P2] CSP 매처 우회
- `proxy.ts:146` — 확장자 제외가 경로 전체(`.*`)라 `/admin/sites/1.json`류 "동적세그먼트+점확장자"에서 인증게이트·CSP 동시 우회. 데이터유출 미확인(보호페이지는 자체 API 인증)이나 심층방어 구멍. 확장자 제외를 루트 세그먼트로 한정 권고.

### P3 (선택·위생) — 대표
- BigInt raw 파싱 400→500(worker/logs/[id]·document-runs/[id]/action·payslip·subscription/[agencyId] 등), 예외 message 노출 2곳(worker/docs/generate:281·system/promos/upload:45), 워커 연차신청 레이트리밋 부재, 날짜 정규식이 2026-99-99 통과, 연차 USE FIFO 소진순서(만기임박 우선 아님)·EXPIRE 재발화 불가·목록 산식 표시, admin/notices limit NaN, recruitVisibility '이력'에 미동의 status 포함, 마스킹 키(주소·loginId) 누락, cron 당월 캐치업 공백(기존 기록) 등.

## 권고 순서
1. **FIX-1**(오늘코드, 저비용·명확): 연차 승인/등록 조건부 updateMany 가드 + partial unique.
2. **접속기록**(법적): backup·trainees 목록 logAccess 배선.
3. **급여 P2 4건 + 문서 스코핑**: 영향도 큼, 개별 확인 후.
4. **월급제 휴일**: 노무사 확인 후.
5. P3: 일괄 위생 정리(원하면).
