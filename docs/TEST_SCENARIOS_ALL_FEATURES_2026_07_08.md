# Able-Link 전체 기능 QA 테스트 시나리오

작성일: 2026-07-08  
대상: 출시 전 수동 QA, 회귀 테스트, 권한/데이터 정합성 검증  
범위: 직무지도원, 위탁기관 관리자, 시스템 운영자, 공개/외부 토큰 사용자, 배치/외부 연동

> 이 문서는 "기능이 화면에 보이는지"가 아니라 실제 운영 데이터가 올바른 상태값과 결과값으로 남는지를 검증하기 위한 마스터 시나리오다. 운영 DB에서는 실행하지 말고 staging 또는 로컬 QA DB에서 실행한다.

---

## 1. 테스트 실행 원칙

| 원칙 | 기준 |
|---|---|
| 테스트 일자 | 2026-07-08 KST 기준. 월 단위 테스트는 `2026-07`을 사용한다. |
| 시간대 | 모든 화면 표시와 날짜 비교는 `Asia/Seoul` 기준으로 검증한다. |
| 성공 판정 | UI 메시지 + API 응답 + DB 상태값 중 최소 2개를 확인한다. |
| 권한 판정 | 다른 기관/다른 사용자의 ID를 직접 URL/API에 넣어 `401/403/404` 중 하나로 차단되는지 확인한다. |
| 외부 연동 | Kakao/SMS/SES/Toss/Groq/Gemini는 staging key 또는 mock/log 모드로 검증한다. 실제 과금/실발송 금지. |
| 파일 검증 | PDF/ZIP/CSV는 다운로드 후 파일명, 내용, 개인정보 마스킹, 열 수 있음까지 확인한다. |

---

## 2. 공통 테스트 데이터

### 2.1 기본 시드 데이터

`npm run seed` 기준으로 다음 데이터가 생성된다.

| 구분 | 값 | 용도 |
|---|---|---|
| 시스템 운영자 | `admin` / `admin1234!` | `/admin/login`, 전체 기관 운영 |
| 위탁기관 관리자 | `manager01` / `Manager1234!` | `/manager/login`, 기관 A 운영 |
| 직무지도원 | `worker01` / `worker1234!` | `/worker/login`, 현장 A 배정 |
| 위탁기관 A | `테스트 위탁기관`, 기본 `STANDARD` | 전체 기능 검증 시 `PRO` 또는 `TRIAL`로 변경 필요 |
| 현장 A | `테스트 사업장`, 반경 `300m`, 좌표 `37.549,126.913` | GPS 출퇴근 정상/범위외 검증 |
| 훈련생 A | `테스트 훈련생` | 일지, 문서, 평가 검증 |
| 출근기록 | 오늘/어제 각 1건 | 근태, 일지, 급여 기본 검증 |

### 2.2 추가로 준비할 QA 데이터

| ID | 데이터 | 상세 | 사용하는 테스트 |
|---|---|---|---|
| QA-AGENCY-B | 위탁기관 B | `비교 위탁기관`, plan `PRO`, manager `manager02` | 기관 스코프 격리 |
| QA-MANAGER-LOCK | 위탁기관 A 관리자 | plan `FREE`, `STARTER`, `STANDARD`, `PRO`를 순차 테스트할 계정 또는 기관 | 플랜 잠금 |
| QA-WORKER-B | 직무지도원 B | `worker02`, 현장 A 배정, `isTemporary=false` | 멀티 사용자 목록/검색 |
| QA-WORKER-TEMP | 임시 직무지도원 | `isTemporary=true`, 임시 비밀번호 보유 | 온보딩 강제 |
| QA-WORKER-MULTI | 멀티현장 직무지도원 | 현장 A `AM`, 현장 B `PM`, 둘 다 2026-07-01~2026-07-31 | 현장 선택, 문서/급여 분리 |
| QA-WORKER-NO-SITE | 미배정 직무지도원 | 활성 계정이나 활성 배정 없음 | 현장 등록/미배정 안내 |
| QA-SITE-B | 현장 B | `비교 사업장`, 좌표 A와 1km 이상 차이, 담당자 이메일 포함 | 멀티현장, 사업체 서명, 문서 발송 |
| QA-SITE-C | 출퇴근 버튼 면제 현장 | `attendanceButtonExempt=true` 배정 | 자동 출근부/급여 |
| QA-TRAINEE-B/C | 훈련생 B/C | 현장 A에 2026-07-01~2026-07-31 ACTIVE placement | 1:多 일지/급여 |
| QA-CONTRACT | 근로계약서 | worker01, 현장 A, 2026-07-01~2026-07-31, `HOURLY`, 09:00~12:00 | 계약/급여 |
| QA-PAY-HOURLY | 급여계약 | worker01, `HOURLY`, 1인 시급 12,000원, 2인 이상 시급 14,400원, `BUSINESS` | 급여 계산 고정값 |
| QA-PAY-EMP | 급여계약 | worker02, `HOURLY`, 12,000원, `EMPLOYMENT`, 근로계약 있음 | 4대보험/세액표 |
| QA-DEDUCTION | 기관 공제 | 고정 1,000원, 비율 1% 두 항목 | 공제 반영 |
| QA-DOC-RUN | 문서 실행 | worker01, `ATTENDANCE_SHEET`, 2026-07-01~2026-07-31 | 문서 상태 전이 |
| QA-SIGN | 서명 이미지 | worker/manager 각각 저장된 서명 | 문서/계약/PDF |
| QA-RECRUIT | 모집 공고 | JOB_COACH, 현장 B, 2026-08-01~2026-08-31, 정원 1 | 마켓/인재풀 |
| QA-SUPPORT | 지원 요청 | 첨부 없는 일반 문의 + 첨부 있는 데이터 오류 문의 | 지원 채널 |

### 2.3 급여 숫자 검증용 고정 케이스

| 케이스 | 입력 데이터 | 예상 결과값 |
|---|---|---|
| PAY-CALC-1 | 2026-07-01, 09:00~12:00, 훈련생 1명, 사업소득, 시급 12,000원 | 지급시간 3h, 총지급 `36,000`, 사업소득세 `1,188`, 실지급 `34,812` |
| PAY-CALC-2 | 2026-07-02, 09:00~12:00, 훈련생 2명, 사업소득, 2인 이상 시급 14,400원 | 지급시간 3h, 총지급 `43,200`, 사업소득세 `1,426`, 실지급 `41,774` |
| PAY-CALC-3 | PAY-CALC-1 + 고정공제 1,000원 + 비율공제 1% | 추가공제 `1,360`, 총공제 `2,548`, 실지급 `33,452` |
| PAY-CALC-4 | 보정대기 근태 `isFinalClosed=true`, `payrollConfirmedAt=null`, 기준시각 30분 이상 이탈 | 해당 일자는 급여 제외, `pendingDays` 1 증가 |

---

## 3. 커버리지 매트릭스

| 사용자/영역 | 커버할 기능 |
|---|---|
| 공개/외부 사용자 | 랜딩, 약관/개인정보/환불/요금, 공개 계약 서명, 사업체 서명, 셀프 서명, 설문 토큰, 모집 공고 조회/지원 |
| 직무지도원 | 가입/초대/로그인/온보딩, 현장 선택/등록, 위치확정, 출퇴근, 근태 검토/수정 요청, 휴무 요청, 일지, AI 음성, 문서 제출, 계약 서명, 급여조회, 프로필/서명/직종/탈퇴, PWA |
| 위탁기관 관리자 | 로그인, 대시보드, 기관설정, 현장/훈련생/직무지도원/배정, 계약, 근태, 일지, 문서/공단발송, 급여, 공지/알림, 모집/인재풀, 구독, 지원요청 |
| 시스템 운영자 | 기관/관리자 승인, 전체 데이터 조회, 계약/근태/문서/급여 모니터링, 평가표/설문, 구독/사용량, 자격검증, 시스템 공지/광고, 설정/세액표/보험요율, 백업, 감사로그/접속기록 |
| 공통 보안 | 인증, 세션, 기관 스코프, IDOR, rate limit, CSV formula injection, 파일 업로드 검증, 서명/토큰 일회성, 개인정보 마스킹 |
| 배치/연동 | cron daily, 자동 출근부 생성/확정, 배정 만료, 계약 만료 알림, 자동 급여 DRAFT, 결제, 이메일/알림톡, PDF/ZIP |

---

## 4. 공개/외부 사용자 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| PUB-001 | 랜딩/공개 문서 | 없음 | `/`, `/terms`, `/privacy`, `/refund`, `/pricing` 직접 접속 | HTTP `200`, 본문 표시, 로그인 쿠키 없이 접근 가능 |
| PUB-002 | 인앱 법적 문서 모달 | 모바일 브라우저 또는 responsive viewport | 랜딩 푸터의 이용약관/개인정보/환불/요금 링크 탭 | 화면 전환 없이 모달 표시, 닫으면 원래 화면 유지 |
| PUB-003 | 존재하지 않는 URL | 없음 | `/not-existing-page` 접속 | 커스텀 404 표시, 홈 이동 버튼 동작 |
| PUB-004 | 공개 계약 서명 | `QA-CONTRACT`, 서명 토큰 | `/contract/[token]` 접속 후 서명 제출 | 계약 내용 표시, 제출 후 `EmploymentContract.status=SIGNED` 또는 worker 서명 완료 상태 |
| PUB-005 | 만료/사용완료 계약 토큰 | 만료 토큰, 이미 사용한 토큰 | 같은 `/contract/[token]` 재접속 | 재서명 불가, 오류 메시지, DB 중복 서명 없음 |
| PUB-006 | 사업체 담당자 서명 | `QA-DOC-RUN`, business contact sign token | `/sign/[token]` 서명 제출 | 최초 제출 `200 success:true`, token `usedAt` 기록, 재사용은 실패 또는 이미 사용 안내 |
| PUB-007 | 셀프 서명 토큰 | manager 모바일 서명 토큰 | `/sign-self/[token]`에서 서명 저장 | 관리자 서명 URL 갱신, 만료/재사용 차단 |
| PUB-008 | 설문 토큰 | survey token | `/survey/[token]` 응답 제출 | 응답 저장, 중복 제출 차단, 만료 토큰 오류 |
| PUB-009 | 공개 모집 공고 | `QA-RECRUIT` OPEN | `/recruit`, `/recruit/[id]` 조회 | OPEN 공고 표시, CLOSED 공고는 신청 불가 |

---

## 5. 인증/권한 공통 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| AUTH-001 | 시스템 운영자 로그인 | `admin/admin1234!` | `/admin/login` 정상 로그인 | `/admin` 이동, admin 세션 쿠키 생성, `/api/admin/auth/me` success |
| AUTH-002 | 위탁기관 관리자 로그인 | `manager01/Manager1234!` | `/manager/login` 정상 로그인 | `/manager` 이동, manager 세션 쿠키 생성 |
| AUTH-003 | 직무지도원 로그인 | `worker01/worker1234!` | `/worker/login` 정상 로그인 | `/worker/home` 이동, worker 세션 쿠키 생성 |
| AUTH-004 | 잘못된 비밀번호 | 세 사용자 모두 | 틀린 비밀번호 입력 | 로그인 실패, 세션 미발급, 응답 `401` 또는 실패 메시지 |
| AUTH-005 | 미인증 보호 페이지 | 쿠키 삭제 | `/admin`, `/manager`, `/worker/home` 직접 접속 | 각각 로그인 페이지로 리다이렉트 또는 API `401` |
| AUTH-006 | 역할 교차 접근 | worker 세션, manager 세션 | worker 쿠키로 `/api/admin/workers`, manager 쿠키로 worker 전용 API 호출 | `401/403`, 데이터 노출 없음 |
| AUTH-007 | 기관 스코프 격리 | `QA-AGENCY-B` | manager01이 기관 B worker/site id로 상세/API 호출 | `403/404`, UI 목록에 기관 B 데이터 미표시 |
| AUTH-008 | Rate limit | 로그인/OTP/sign token | 동일 IP에서 제한 횟수 초과 요청 | `429`, 제한 메시지, 정상 사용자는 시간 경과 후 복구 |
| AUTH-009 | 로그아웃 | 각 사용자 세션 | 로그아웃 실행 후 보호 페이지 재접속 | 쿠키 삭제, 보호 페이지 접근 실패 |

---

## 6. 시스템 운영자 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| SYS-001 | 시스템 대시보드 | 기관 A/B, 근태/문서/지원요청 샘플 | `/admin` 접속 | 기관/직무지도원/근태/문서/지원요청 요약 표시, 집계 수가 DB와 일치 |
| SYS-002 | 위탁기관 등록/수정 | 신규 기관 C | `/admin/agencies`에서 생성 후 상세 수정 | Agency 생성, 수정값 반영, `isActive=true`, 감사로그 생성 |
| SYS-003 | 기관 비활성화 | 기관 C | 상세에서 비활성화 | `isActive=false`, 해당 기관 manager 로그인 또는 주요 기능 차단 |
| SYS-004 | 관리자 가입요청 승인 | `ManagerSignupRequest=PENDING` | `/admin/manager-signup-requests` 승인 | 상태 `APPROVED`, Agency/Manager 생성 또는 연결, 반려 시 `REJECTED` |
| SYS-005 | 시스템 관리자 관리 | 신규 admin 계정 | `/admin/admins` 생성/비활성화 | 활성 계정 로그인 가능, 비활성 계정 로그인 실패 |
| SYS-006 | 전체 직무지도원/현장 조회 | 기관 A/B 데이터 | `/admin/workers`, `/admin/sites` 검색/필터 | 전체 기관 데이터 조회 가능, 기관/상태/검색 필터 정확 |
| SYS-007 | 전체 근태 모니터링 | 정상/범위외/미퇴근 근태 | `/admin/attendances`, `/admin/review` 조회 | 상태별 집계 표시, 상세 위치/시간 확인 가능 |
| SYS-008 | 전체 계약 현황 | PENDING/SIGNED/COMPLETED 계약 | `/admin/contracts` 조회 | 계약 상태와 만료 예정 표시, 상세 PDF 접근 가능 |
| SYS-009 | 평가표 관리 | 활성 평가표 없음 | `/admin/eval-forms` 문항 100점 구성 저장 | 총점 100 검증, 활성 평가표는 1개만 유지 |
| SYS-010 | 설문/평가 요청 | worker01 대상 | `/admin/survey-requests` 생성/발송 | 설문 토큰 생성, worker notice 또는 발송 로그 생성 |
| SYS-011 | 결제/구독 현황 | FREE/TRIAL/PRO 기관 | `/admin/billing` 조회 및 플랜 변경 | 플랜 배지/연체 표시, 변경 시 Agency plan 반영 |
| SYS-012 | AI 사용량 | AI 호출 로그 | `/admin/usage` 월 이동 | 월별/기관별 서비스 합계가 로그 합계와 일치 |
| SYS-013 | 인재풀/자격 검증 | `WorkerProfession=PENDING` | `/admin/professions` 승인/반려 | `VERIFIED` 또는 `REJECTED`, worker 프로필 상태 반영 |
| SYS-014 | 시스템 공지 | 전체/기관별 공지 | `/admin/announcements` 발송 | 대상 manager/worker 알림 노출, 미읽음 count 증가 |
| SYS-015 | 대시보드 광고/티커 | TICKER/AD | `/admin/promos` 생성/비활성화 | 기간 내 활성 콘텐츠만 manager 대시보드 노출 |
| SYS-016 | 지원 요청 처리 | `QA-SUPPORT` | `/admin/support` 회신/종료 | 상태 `REPLIED` 후 manager notice 생성, 종료 시 `CLOSED` |
| SYS-017 | 운영 설정 | payrollAutoDay, lateThresholdMin 등 | `/admin/settings` 저장 | 설정값 저장, 관련 기능에서 새 값 사용 |
| SYS-018 | 세액표/보험요율 | 2026 세액표/요율 | `/admin/settings/income-tax`, `/insurance-rates` 업로드/수정 | 최신 연도 값이 급여 계산에 사용, 누락 시 경고 |
| SYS-019 | 데이터 백업 | QA DB | `/admin/backup` 실행 | 백업 파일 다운로드 가능, 감사로그/접속기록 생성 |
| SYS-020 | 감사로그/접속기록 | worker/trainee/계좌 조회 | `/admin/audit`, `/admin/access-log` 확인 | 누가/언제/무엇을 조회·변경했는지 기록, PII 마스킹 |

---

## 7. 위탁기관 관리자 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| MGR-001 | 대시보드 | 기관 A 근태/문서/공지 데이터 | `/manager` 접속 | 오늘 근태, 문서 대기, 종료 임박, 공지/광고가 기관 A 데이터만 표시 |
| MGR-002 | 플랜 잠금 | 기관 plan FREE/STARTER/STANDARD/PRO | PRO 메뉴와 STARTER/STANDARD 메뉴 접근 | 미달 플랜은 잠금/업그레이드 유도, PRO/TRIAL은 접근 가능 |
| MGR-003 | 기관 정보 | 기관 A | `/manager/settings` 수정 저장 | 기관명/대표/이메일/자동급여일 등 저장, 문서/계약에 반영 |
| MGR-004 | 관리자 서명 | `QA-SIGN` | `/manager/signature` 저장/모바일 토큰 저장 | 서명 이미지 표시, PDF 삽입 가능, 기존 서명 교체 |
| MGR-005 | 현장 생성 | `QA-SITE-B` | `/manager/sites/new` 필수값/좌표/담당자 저장 | Site 생성, 기본 반경 저장, 목록/상세 노출 |
| MGR-006 | 현장 수정/비활성 | 현장 B | 주소/반경/근무형태/담당자 수정 후 비활성화 | 수정값 반영, 비활성 현장은 기본 목록 제외 |
| MGR-007 | 현장 기준점 제안 승인 | worker 위치 제안 | 기준점 승인/반려/보정요청 | `BasePointApprovalStatus=APPROVED/REJECTED/CORRECTION_REQUESTED`, 승인 시 출근 판정 기준 변경 |
| MGR-008 | 훈련생 관리 | `QA-TRAINEE-B/C` | `/manager/trainees` 생성/수정/상태 변경 | placement 기간/상태 반영, 문서/일지 대상 기간과 일치 |
| MGR-009 | 직무지도원 계정 목록 | worker01/B/TEMP | `/manager/worker-accounts` 검색/상세 | 이름/전화/상태/본인·계좌 인증 표시, 기관 A worker만 표시 |
| MGR-010 | 직무지도원 초대 | 신규 전화번호 | 초대 생성, 링크/코드 확인 | `WorkerInvite` 생성, code 6자리, 만료 24시간, site 지정 시 배정 연결 |
| MGR-011 | 임시 비밀번호 | `QA-WORKER-TEMP` | 비밀번호 초기화 후 로그인 | 임시 비밀번호로 로그인 가능, `/worker/onboarding` 강제 |
| MGR-012 | 본인/계좌 인증 | worker01 | 신원확인/계좌확인 승인/반려 | `identityVerifiedAt`/`accountVerifiedAt` 기록, 민감값 마스킹 |
| MGR-013 | 배정 생성 | worker02 + 현장 B | AM/PM/FULL_DAY/CUSTOM 배정 저장 | `SiteAssignment.status=ASSIGNED` 또는 ACTIVE 정책값, 시간/기간 저장 |
| MGR-014 | 배정 시간 겹침 | `QA-WORKER-MULTI` | 같은 시간대 다른 현장 배정 시도 | 충돌이면 `409`, 기존 배정 오염 없음 |
| MGR-015 | 배정 확정 파이프라인 | REQUESTED/ACCEPTED 배정 | 후보 수락, 최종 확정, 취소/복원 | 상태가 `REQUESTED -> ACCEPTED -> ASSIGNED`, 취소 시 `ENDED/DROPPED` 정책값 |
| MGR-016 | 근로계약 생성 | `QA-CONTRACT` | `/manager/contracts` 생성/발송 | `EmploymentContract.status=PENDING`, 서명 링크 생성, worker 알림/발송 로그 |
| MGR-017 | 계약 쌍방 서명 | worker 서명 후 manager 서명 | 관리자 서명 적용 | `SIGNED -> COMPLETED`, PDF 생성, 배정 `ASSIGNED -> CONFIRMED` |
| MGR-018 | 근태 현황 | 정상/범위외/미퇴근/보정대기 | `/manager/attendances`, `/manager/calendar` 필터 | 날짜/worker/site 필터 정확, 지도 마커/반경 표시 |
| MGR-019 | 근태 이슈 수신함 | `AttendanceIssueStatus=OPEN` | 소명요청, 메모, 해결 | `REQUESTED -> REPLIED -> RESOLVED`, 이벤트 로그 누적 |
| MGR-020 | 출근부 수정 요청 | worker 수정 요청 PENDING | 승인/반려 | 승인 시 attendance 시간 변경 및 `APPROVED`, 반려 시 원본 유지 및 `REJECTED` |
| MGR-021 | 커스텀 휴무 협의 | worker 휴무일 + 변경 요청 | 삭제/근무인정 변경 요청 후 worker 수락/거절 | 수락 시 holiday 변경, 거절 시 원본 유지, 상태 `ACCEPTED/REJECTED` |
| MGR-022 | 일지 열람 | worker01 일지 DONE/DRAFT | `/manager/logs` 기간/worker/site 필터 | 1:1/1:多 완료율 정확, 미완료 대상 표시 |
| MGR-023 | 문서 인박스 | `QA-DOC-RUN`, worker 제출 | `/manager/documents` 확정/수정요청/서명 | `SUBMITTED -> CONFIRMED -> MANAGER_SIGNED`, 수정요청 시 `CHANGES_REQUESTED` |
| MGR-024 | 문서 미제출 보드 | CONFIRMED/ACTIVE/ENDED 배정 | `/api/admin/document-runs/missing` 또는 UI 조회 | 근무일 있는 미제출만 표시, `CHANGES_REQUESTED`는 제출로 카운트하지 않음 |
| MGR-025 | 공단 발송 | MANAGER_SIGNED 문서 + 수신 이메일 | `/manager/gov-submissions` 또는 발송 액션 | 이메일 성공분만 `govStatus=SUBMITTED`, 실패분은 미제출 유지 |
| MGR-026 | 문서 ZIP | worker01 7월 문서 | 감사패키지 다운로드 | ZIP 열림, 5종 문서 포함, 타 현장/타 기관 정보 없음 |
| MGR-027 | 급여 계약 | `QA-PAY-HOURLY`, `QA-PAY-EMP` | 급여계약 등록/수정/삭제 | base 계약 저장, 월중 단가 변경 제한 메시지 또는 정책대로 처리 |
| MGR-028 | 급여 계산 DRAFT | PAY-CALC-1/2/3 데이터 | 2026-07 급여 계산 실행 | `PayrollRun.status=DRAFT`, 금액이 2.3 표와 일치 |
| MGR-029 | 급여 확정/재계산 | DRAFT run | 확정 후 재계산/삭제 시도 | 확정 시 `FINALIZED`, FINALIZED 재계산/삭제 차단 |
| MGR-030 | 급여명세서 | FINALIZED item | 명세서 PDF 열기 | 총지급/공제/실지급, payLines 합계가 item 금액과 일치 |
| MGR-031 | 기관 공지 | worker 대상 | `/manager/announcements` 작성/수정/비활성 | 대상 worker 알림 노출, 비활성/기간외 미노출 |
| MGR-032 | 알림 목록 | 문서/지원/공지 알림 50건 이상 | `/manager/notices` 조회/읽음 | 미읽음 count 정확, 50건 이상이어도 누락 없음 |
| MGR-033 | 모집 공고 | `QA-RECRUIT` | `/manager/recruit` 생성/수정/마감 | OPEN/CLOSED 상태 반영, 신청자 목록 표시 |
| MGR-034 | 인재풀 제안 | `openToOffers=true` worker | `/manager/talent` 제안 발송 | `TalentOffer.status=PENDING`, worker offers에 노출 |
| MGR-035 | 구독 관리 | Toss test billing key | `/manager/subscription` 업그레이드/해지 | 결제 성공 시 plan 변경, 해지 시 다음 결제/상태 반영 |
| MGR-036 | 지원 요청 | `QA-SUPPORT` | 문의 작성/첨부/종료 | `OPEN -> REPLIED -> CLOSED`, 첨부 다운로드 권한 기관 제한 |

---

## 8. 직무지도원 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| WRK-001 | 셀프 가입 OTP | 신규 전화번호 | `/worker/signup` OTP 요청/확인/약관 동의 | OTP 5분 유효, 가입 성공 후 로그인, 배정 없으면 `/worker/site/register` |
| WRK-002 | 초대 링크 가입 | `MGR-010` 초대 | 링크 접속, code 입력, 가입 | code 일치 시 가입, site 지정 초대는 배정 생성/연결 후 홈 이동 |
| WRK-003 | 초대 오류 | 만료/사용완료/틀린 code | 동일 플로우 시도 | 가입 차단, `usedAt` 중복 기록 없음 |
| WRK-004 | 기존 계정 배정 연결 | CONNECT_EXISTING invite | `/worker/connect` code 입력 | assignment `connectedAt` 기록, worker 홈에 새 배정 표시 |
| WRK-005 | 임시계정 온보딩 | `QA-WORKER-TEMP` | 임시 비밀번호 로그인 후 비밀번호 변경 | `/worker/onboarding` 강제, 완료 후 `isTemporary=false` |
| WRK-006 | 비밀번호 재설정 | worker01 전화번호 | `/worker/reset-password` 요청 | 임시 비밀번호 발급/발송, 기존 비밀번호 실패, 임시 로그인 가능 |
| WRK-007 | 현장 선택 | `QA-WORKER-MULTI` | `/worker/select-site`에서 현장 A/B 전환 | active assignment cookie 저장, 홈/문서/일지 대상 현장 변경 |
| WRK-008 | 현장 등록 | `QA-WORKER-NO-SITE` | `/worker/site/register` 주소/좌표 저장 | WORKER_ENTRY site 또는 등록 요청 생성, 홈 이동 정책대로 처리 |
| WRK-009 | 위치확정 게이트 | assignment `CONFIRMED`, `baseConfirmedAt=null` | 출근 전 위치확정 CTA 실행 | 기준점 확정 후 `baseConfirmedAt` 기록, `CONFIRMED -> ACTIVE` |
| WRK-010 | 출근 정상 | 현장 A 좌표 반경 내 | `/worker/home` 출근 | DailyAttendance 생성, `withinRange=true`, `status=WORKING`, 중복 출근 차단 |
| WRK-011 | 출근 범위외 | 현장 A에서 300m 밖 좌표 | 출근 실행 | attendance 생성, `withinRange=false`, `AttendanceIssue.type=OUT_OF_RANGE` |
| WRK-012 | 퇴근 정상 | WRK-010 출근건 | 퇴근 실행 | `status=DONE`, endTime/actualEndTime 기록, 일지 작성 CTA 표시 |
| WRK-013 | 퇴근 미실행/늦은퇴근 | 전일 출근 후 퇴근 없음 | cron 후 늦은퇴근 사유 제출 | `clockOutMissedAt` 기록, 사유 제출 시 `lateClockOutAt` 기록 |
| WRK-014 | 근태 월 확인 | 2026-07 근태 | `/worker/review/attendance`, `/worker/calendar` 조회 | 정상/지각/조퇴/범위외/미퇴근 상태 표시 |
| WRK-015 | 출근부 수정 요청 | 보정 필요한 날짜 | 요청 시각/사유 제출 | `AttendanceEditReqStatus=PENDING`, manager 처리 결과 worker에 표시 |
| WRK-016 | 휴무 요청 | 2026-07-15 | `/worker/holiday-requests` 또는 캘린더 등록 | SiteHoliday 생성, 변경요청 수락/거절 가능 |
| WRK-017 | 수동 일지 저장 | 훈련생 A/B, 출근 완료 | `/worker/worklog` 임시저장/완료 | DRAFT 저장 가능, 완료 시 `TraineeLog.isCompleted=true` |
| WRK-018 | 1:多 일지 완료율 | 훈련생 A/B/C | 훈련생 일부만 작성 후 전체 작성 | 일부 작성 시 미완료, 전원 완료 시 완료 상태 |
| WRK-019 | 이전 일지 불러오기 | 전일 DONE 일지 | `/api/worker/logs/prev` 또는 UI 버튼 | 이전 내용 로드, 저장 전 원본 변경 없음 |
| WRK-020 | AI 음성 동의 | `consentAiCrossBorderAt=null` | 녹음 시작 | 동의 모달 표시, 취소 시 STT 호출 없음, 동의 시 timestamp 저장 |
| WRK-021 | AI 음성 일지 | 동의 완료, AI keys/mock | 녹음 후 생성 | STT 텍스트와 일지 초안 생성, 저장 전 수정 가능 |
| WRK-022 | AI 일괄 일지 | 미작성 일지 2건 이상 | `/worker/worklog/batch` 녹음/저장 | 각 대상별 초안 생성, 제외 대상이 있으면 명시적으로 표시 |
| WRK-023 | 문서 조회 5종 | 7월 근태/일지/평가 | `/worker/docs/view` 각 탭 조회 | 5종 데이터 표시, 다른 현장/기간 데이터 섞이지 않음 |
| WRK-024 | 문서 미리보기/PDF 생성 | `QA-SIGN`, 일지 완료 | `/worker/docs/preview`, generate | PDF 열림, 서명/기간/현장/훈련생 정확 |
| WRK-025 | 문서 제출 | 생성된 PDF | 제출 액션 | `DocumentRun.signStage=SUBMITTED`, manager notice 생성 |
| WRK-026 | 수정요청 재제출 | `CHANGES_REQUESTED` run | 알림 딥링크로 수정 후 재제출 | 원본 run이 갱신 또는 정책대로 버전 추가, 날짜/assignmentId 유지 |
| WRK-027 | 사업체 인퍼슨 서명 | 사업체 담당자 옆에서 서명 | `/worker/docs/inperson-sign` | 서명 저장, token/권한 검증, 다른 문서에는 적용 안 됨 |
| WRK-028 | 평가 작성 | 훈련생 A/B | `/worker/evaluation` 점수/의견 저장 | `TraineeEvaluation` 저장, manager report 반영 |
| WRK-029 | 계약서 목록/서명 | PENDING 계약 | `/worker/contracts` 서명 | `EmploymentContract.status=SIGNED`, 중복 서명 차단 |
| WRK-030 | 급여 조회 | FINALIZED payroll item | `/worker/payroll` 월 선택 | gross/deduction/net 표시, payslip PDF 다운로드 가능 |
| WRK-031 | 공지/알림 | 시스템/기관/개별 공지 | `/worker/notices` 읽음 처리 | 미읽음 count 감소, readAt 기록 |
| WRK-032 | 프로필 수정 | worker01 | 이름/전화/비밀번호 수정 | 필수 검증, 변경 후 새 정보 표시, 비밀번호 변경 후 재로그인 |
| WRK-033 | 이메일 loginId 변경 | 이메일 인증 코드 | 요청/확인 후 로그인 | `pendingLoginId` cleared, 새 loginId로 로그인 가능 |
| WRK-034 | 서명 등록 | 서명패드 | `/worker/signature` 저장 | 서명 미리보기 표시, PDF에 반영 |
| WRK-035 | 직종/자격 등록 | JOB_COACH cert | `/worker/profile/professions` 등록 | `WorkerProfession.verifyStatus=PENDING`, admin 승인 후 VERIFIED |
| WRK-036 | 데이터 내보내기 | worker01 데이터 | `/worker/export` 다운로드 | 본인 데이터만 CSV/파일 제공, 다른 worker 정보 없음 |
| WRK-037 | 회원 탈퇴 | 테스트 전용 worker | 올바른 비밀번호로 탈퇴 | `Worker.status=RESIGNED`, PII 익명화, 로그인 실패 |
| WRK-038 | PWA 설치 | 모바일 Chrome/Safari | 홈 화면 추가, standalone 실행 | manifest/icon 표시, 위치/세션 유지, worker layout 정상 |

---

## 9. 문서/PDF/서명 집중 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| DOC-001 | 출근부 | 7월 정상/지각/결근/휴무 근태 | `ATTENDANCE_SHEET` preview/generate | 날짜별 상태, 출퇴근, 1:1/1:多, 서명 표시 |
| DOC-002 | 훈련일지 | PRE/FIELD 일지 | `TRAINING_DAILY_LOG` 생성 | 훈련생별 일지 내용 표시, 기간 밖 placement 제외 |
| DOC-003 | 훈련생 종합평가 | 평가 점수/의견 | `TRAINEE_COMPREHENSIVE_EVAL` 생성 | 점수/의견/훈련생 정보 표시 |
| DOC-004 | 적응지도 일지 | ADAPTATION 배정/일지 | `POST_EMPLOY_ADAPT_LOG` 생성 | ADAPTATION 기간 데이터만 포함 |
| DOC-005 | 적응지도 종합평가 | ADAPTATION 평가 | `ADAPTATION_COMPREHENSIVE_EVAL` 생성 | 적응지도 평가 점수/의견 표시 |
| DOC-006 | 권한 없는 훈련생 | 기관 B traineeId | 기관 A manager/worker로 preview 요청 | `403/404`, 빈 PDF 생성 금지 |
| DOC-007 | 다른 현장 혼입 방지 | `QA-WORKER-MULTI` | 현장 A 문서 생성 후 현장 B 데이터 확인 | 현장 A 기간/훈련생/근태만 포함 |
| DOC-008 | 서명 이미지 접근제어 | 저장된 서명 URL | 직접 URL 접근 + 앱 내 PDF 표시 | 직접 공개 접근 차단, 앱/PDF에서는 정상 표시 |
| DOC-009 | 공단 발송 실패 처리 | 수신자 1명 정상, 1명 실패 mock | 발송 실행 | 성공분만 `govStatus=SUBMITTED`, 실패분은 오류 표시 |
| DOC-010 | ZIP 정합성 | 5종 문서 생성 완료 | 감사패키지 ZIP 다운로드 | ZIP 내 파일 수/파일명/열람 가능, 개인정보 타기관 혼입 없음 |

---

## 10. 급여/정산 집중 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| PAY-001 | 기본 시급 계산 | PAY-CALC-1 | 2026-07 run 생성 | 총지급 `36,000`, 공제 `1,188`, 실지급 `34,812` |
| PAY-002 | 1:多 시급 계산 | PAY-CALC-2 | 2026-07 run 생성 | 총지급 `43,200`, 공제 `1,426`, 실지급 `41,774` |
| PAY-003 | 기관 공제 | PAY-CALC-3 | 공제 활성 후 run 재생성 | 총공제 `2,548`, 실지급 `33,452` |
| PAY-004 | 근로소득/보험 | `QA-PAY-EMP`, 보험요율/세액표 | run 생성 | 소득세/주민세/보험 공제 라인 생성, 요율 연도 표시 |
| PAY-005 | 보정대기 제외 | PAY-CALC-4 | run 생성 | 해당 날짜 제외, `pendingDays=1`, 급여 확정 전 경고 |
| PAY-006 | 월급 일할 | 월급 2,000,000원, 소정근로일 23일 중 10일 근무 | run 생성 | 기본급 `round(2,000,000*10/23)=869,565` |
| PAY-007 | 연장/야간/휴일 | actualEndTime 20:00, 야간/공휴일 샘플 | run 생성 | breakdown에 overtime/night/holiday 라인과 계산식 표시 |
| PAY-008 | FINALIZED 보호 | FINALIZED run | 재계산/삭제/수정 시도 | 차단, 기존 item 유지, API `400/409` |
| PAY-009 | 임금명세서 PDF | FINALIZED item | worker/manager에서 PDF 열기 | 법정 항목 표시, 지급/공제 합계가 DB item과 일치 |
| PAY-010 | CSV 내보내기 | 근태/일지 데이터 | `/api/admin/export/csv` 다운로드 | 한글 깨짐 없음, 수식형 값은 안전하게 이스케이프 |

---

## 11. 모집/인재풀 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| REC-001 | 공고 생성 | `QA-RECRUIT` | manager/admin에서 공고 생성 | `RecruitPost.status=OPEN`, 공개 목록 노출 |
| REC-002 | worker 지원 | worker01 | `/recruit/[id]` 또는 worker recruit apply | `RecruitApplication.status=PENDING`, 중복 지원 차단 |
| REC-003 | 지원 수락 | PENDING application | manager가 수락 | `ACCEPTED`, 정원 차감, 필요 시 `SiteAssignment=ASSIGNED` |
| REC-004 | 지원 반려/철회 | PENDING application | 반려 또는 worker 철회 | `REJECTED/WITHDRAWN`, 배정 생성 없음 |
| REC-005 | 인재풀 제안 | openToOffers worker | manager/admin 제안 발송 | `TalentOffer.status=PENDING`, worker offers 표시 |
| REC-006 | 제안 수락/거절 | PENDING offer | worker 수락/거절 | `ACCEPTED`면 배정 생성/연결, `DECLINED`면 원본 유지 |
| REC-007 | 일정 겹침 | 기존 ACTIVE/ASSIGNED 배정 | 겹치는 공고 수락/제안 수락 | `409` 또는 soft-skip 정책대로 처리, 이중 배정 없음 |

---

## 12. 배치/외부 연동 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| BATCH-001 | health check | 없음 | `/api/health` 호출 | HTTP `200`, success 응답 |
| BATCH-002 | cron 인증 | `CRON_SECRET` | secret 없이/있이 `/api/cron/daily` 호출 | secret 없음 `401`, secret 있음 success |
| BATCH-003 | 자동 출근부 생성 | attendanceButtonExempt 배정 | cron 실행 | 해당 일자 DailyAttendance 자동 생성, 이슈 미생성 |
| BATCH-004 | 자동 확정 | 퇴근 후 기준분 경과 기록 | cron 실행 | `isFinalClosed=true`, finalizedAt 기록 |
| BATCH-005 | 배정 만료 | endDate 지난 ASSIGNED/CONFIRMED/ACTIVE | cron 실행 | `status=ENDED`, 종료 후 과거 문서/급여 재계산 가능 |
| BATCH-006 | 자동 급여 DRAFT | Agency.payrollAutoDay=8 | 2026-07-08 cron | 전월 또는 정책 월 DRAFT 생성, 중복 실행 idempotent |
| BATCH-007 | 계약 만료 알림 | D-30/D-7/D-1 계약 | cron 실행 | worker/manager 알림 또는 Kakao mock 로그 생성 |
| BATCH-008 | 이메일 발송 | SES mock/staging | 문서 발송 | 성공/실패 로그와 DocumentSubmissionLog 일치 |
| BATCH-009 | 알림톡/SMS | Kakao/SMS mock | 초대/계약/만료 발송 | 템플릿 변수 정상, 실패 시 재시도/오류 표시 |
| BATCH-010 | Toss 결제 | test billing key | 결제/자동과금/해지 | 성공 시 plan/nextBillingAt 갱신, 실패 시 연체 상태 |
| BATCH-011 | 주소/좌표 | Kakao geo key/mock | 주소검색, 좌표->주소 | 유효 주소 좌표 반환, 실패 시 사용자 메시지 |

---

## 13. 보안/개인정보/데이터 정합성 테스트

| ID | 기능 | 필요 데이터 | 절차 | 예상 결과값 |
|---|---|---|---|---|
| SEC-001 | IDOR 방지 | 기관 A/B worker/site/trainee/doc ids | URL/API id를 타기관 값으로 바꿔 호출 | `403/404`, 데이터 본문 미노출 |
| SEC-002 | worker 소유권 | worker01/worker02 | worker01 쿠키로 worker02 logs/docs/payroll 호출 | `403/404`, worker02 데이터 미노출 |
| SEC-003 | 공개 토큰 일회성 | sign/contract/survey token | 동시 제출 2회 | 한 번만 성공, 나머지는 실패/이미 사용 처리 |
| SEC-004 | CSV formula injection | 값 `=1+1`, `-2+3+cmd|' /C calc'!A0`, `+821012345678` | CSV 다운로드 후 원문 확인 | 위험 수식은 `'` 등으로 보호, 정상 국제전화는 정책대로 보존 |
| SEC-005 | XSS 입력 | `<script>alert(1)</script>` | 공지/일지/지원요청/메모 입력 | 실행되지 않고 텍스트 이스케이프 |
| SEC-006 | 파일 업로드 검증 | jpg/png/pdf 정상, exe/js 위장파일 | business doc/support upload | 정상 파일만 저장, 위장/초과용량 차단 |
| SEC-007 | 개인정보 마스킹 | 계좌/전화/서명/감사로그 | 목록/CSV/로그 조회 | 계좌/전화 일부 마스킹, 감사로그 민감값 원문 없음 |
| SEC-008 | 접속기록 | trainee 상세, payroll, account 조회 | manager/admin이 민감정보 조회 | `AccessLog` 생성, actor/ip/path/subject 기록 |
| SEC-009 | 세션 만료 | 만료 쿠키 조작 | API 호출 | `401`, 새 로그인 필요 |
| SEC-010 | 동시성 | 급여 확정/문서 확정/서명 제출 동시 실행 | 두 탭에서 같은 액션 | 하나만 성공, 나머지 상태 불일치 메시지 |
| SEC-011 | 멀티현장 혼입 | `QA-WORKER-MULTI` | 문서/급여/일지/API assignmentId 바꿔 호출 | 선택 현장 기준만 포함, 다른 현장 데이터 분리 |
| SEC-012 | 삭제/탈퇴 개인정보 | 탈퇴 worker, 삭제 서명 | 탈퇴 후 storage/DB 확인 | 법정 보존 대상 제외 PII 익명화, 서명 이미지 고아 없음 |

---

## 14. 테스트 완료 기준

| 등급 | 완료 기준 |
|---|---|
| P0 출시 차단 | 로그인/권한, 출퇴근, 문서 제출/발송, 계약 서명, 급여 DRAFT/FINALIZED, 개인정보 스코프 테스트 모두 통과 |
| P1 출시 전 필수 | 관리자/운영자 설정, 알림, 지원요청, PDF/ZIP/CSV, cron, 외부 연동 mock 통과 |
| P2 회귀 권장 | PWA, 광고/프로모션, 사용량 통계, 상세 필터/검색, 파일명/문구 polish |

테스트 완료 시 다음 산출물을 남긴다.

| 산출물 | 내용 |
|---|---|
| 결과표 | 각 ID별 `PASS/FAIL/BLOCKED`, 실행자, 실행일, 환경 |
| 증거 | 실패 화면 캡처, API 응답, 관련 DB row id |
| 결함 티켓 | 재현 절차, 기대값, 실제값, 영향 사용자, 우선순위 |
| 회귀 메모 | 수정 후 반드시 재실행할 시나리오 ID |

---

## 15. 권장 실행 순서

1. `AUTH-*`, `SEC-001~003`으로 권한 경계를 먼저 확인한다.
2. `MGR-003~017`로 기관/현장/직무지도원/배정/계약 기본 데이터를 완성한다.
3. `WRK-007~019`로 현장 선택, 위치확정, 출퇴근, 일지까지 일일 흐름을 끝낸다.
4. `DOC-*`, `MGR-023~026`, `WRK-023~027`로 월말 문서 흐름을 검증한다.
5. `PAY-*`, `MGR-027~030`, `WRK-030`으로 정산을 검증한다.
6. `SYS-*`, `REC-*`, `BATCH-*`, `SEC-*` 나머지 항목으로 운영/확장/보안 회귀를 마감한다.

