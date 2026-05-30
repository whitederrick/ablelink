# API 명세서

> 모든 API는 `/api/` 하위에 위치합니다.
> 인증 실패 시 `401`, 권한 없음 시 `403`, 공통 응답 형식: `{ success: boolean, message?: string, ... }`

---

## 인증 방식

| 구분 | 쿠키명 | 시크릿 | 유효기간 |
|------|--------|--------|----------|
| 관리자 | `admlink_admin_session` | `ADMIN_SESSION_SECRET` | 8시간 |
| 직무지도원 | `ablelink_worker_session` | `WORKER_SESSION_SECRET` | 7일 |

---

## 관리자 API `/api/admin/`

### 인증
| Method | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/login` | 로그인 → 세션 쿠키 발급 |
| POST | `/auth/logout` | 로그아웃 → 쿠키 삭제 |
| GET | `/auth/me` | 현재 세션 정보 조회 |

### 대시보드
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/dashboard` | 오늘 출근·미확인근태·보고서·배정종료임박·미배정현장 종합 현황 | ✅ |

### 직무지도원 관리
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/workers` | 직무지도원 목록 (검색, 페이지네이션) | ✅ |
| PATCH | `/workers/:id` | 이름·전화번호 수정, 임시 비밀번호 발급 | ✅ |
| POST | `/workers/invite` | 직무지도원 초대 링크 생성 + SMS 발송 | ✅ |

### 현장 관리
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/sites` | 현장 목록 (검색, 페이지네이션) | ✅ |
| POST | `/sites` | 현장 등록 | ✅ |
| GET | `/sites/:id` | 현장 상세 | ✅ |
| PATCH | `/sites/:id` | 현장 수정 | ✅ |
| DELETE | `/sites/:id` | 현장 비활성화 | ✅ |
| GET | `/sites/options` | 현장 선택용 간략 목록 | ✅ |
| GET | `/sites/:id/trainees` | 현장 훈련생 목록 | ✅ |

### 배정 관리
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/assignments` | 배정 목록 | ✅ |
| POST | `/assignments` | 배정 등록 | ✅ |
| PATCH | `/assignments/:id` | 근무형태·기간 수정 | ✅ |

### 출퇴근 관리
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/attendances` | 출퇴근 기록 목록 (필터: 날짜, 직무지도원) | ✅ |
| GET | `/attendance-inbox` | 근태 이슈 수신함 | ✅ |
| PATCH | `/attendance-inbox/:id/resolve` | 이슈 해결 처리 | ✅ |
| PATCH | `/attendance-inbox/:id/request-reason` | 소명 요청 | ✅ |
| PATCH | `/attendance-inbox/:id/memo` | 메모 수정 | ✅ |

### 계약서 관리
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/contracts` | 근로계약서 목록 | ✅ |
| POST | `/contracts` | 계약서 생성 + 서명 링크 발송 | ✅ |
| GET | `/contracts/worker-search` | 계약서 작성용 직무지도원 검색 | ✅ |

### 문서 관리
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/docs/generate` | PDF 생성 + 이메일 발송 | ✅ |
| GET | `/docs/preview` | PDF 미리보기 | ✅ |
| POST | `/docs/sign` | 관리자 서명 적용 | ✅ |
| GET | `/docs/trainees` | 직무지도원의 담당 훈련생 목록 | ✅ |
| GET | `/docs/manager-email` | 현장 담당자 이메일 조회 | ✅ |
| GET | `/document-runs` | 문서 실행 목록 | ✅ |
| POST | `/document-runs` | 문서 실행 생성 | ✅ |
| GET | `/document-versions` | 문서 버전 목록 | ✅ |
| POST | `/document-versions` | 문서 버전 저장 | ✅ |
| GET | `/document-versions/:id/pdf` | PDF 다운로드 | ✅ |
| GET | `/document-submission-logs` | 발송 이력 | ✅ |
| POST | `/document-submission-logs` | 발송 기록 | ✅ |

### 급여 관리
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/payroll/contracts` | 급여 계약 목록 | ✅ |
| POST | `/payroll/contracts` | 급여 계약 등록 | ✅ |
| PATCH | `/payroll/contracts/:id` | 급여 계약 수정 | ✅ |
| DELETE | `/payroll/contracts/:id` | 급여 계약 삭제 | ✅ |
| GET | `/payroll/runs` | 급여 계산 실행 목록 | ✅ |
| POST | `/payroll/runs` | 급여 계산 실행 (DRAFT 생성) | ✅ |
| PATCH | `/payroll/runs/:runId` | 급여 확정 (DRAFT→FINALIZED) | ✅ |
| GET | `/payroll/deductions` | 공제 항목 목록 | ✅ |
| POST | `/payroll/deductions` | 공제 항목 등록 | ✅ |
| PATCH | `/payroll/deductions/:id` | 공제 항목 수정 | ✅ |
| DELETE | `/payroll/deductions/:id` | 공제 항목 삭제 | ✅ |
| GET | `/payroll/insurance-rates` | 4대보험 요율 조회/수정 | ✅ |

### 기타
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/managers` | 기관 담당자 목록 | ✅ |
| POST | `/managers` | 담당자 등록 | ✅ |
| PATCH | `/managers/:id` | 담당자 수정 | ✅ |
| DELETE | `/managers/:id` | 담당자 삭제 | ✅ |
| GET | `/trainees/summary` | 훈련생 현황 요약 | ✅ |
| GET | `/trainee-report` | 훈련생 진척도 리포트 (STANDARD+) | ✅ |
| GET | `/audit-package` | 감사 서류 패키지 ZIP 다운로드 (STANDARD+) | ✅ |
| GET | `/export/csv` | 출퇴근 CSV 내보내기 | ✅ |
| GET/PUT | `/signature` | 관리자 서명 이미지 조회/저장 | ✅ |
| GET/PATCH | `/subscription` | 구독 정보 조회/수정 | ✅ |
| PATCH | `/subscription/:agencyId` | 에이전시 플랜 변경 | ✅ |

---

## 직무지도원 API `/api/worker/`

### 인증
| Method | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/login` | 로그인 |
| POST | `/auth/logout` | 로그아웃 |
| POST | `/auth/signup` | 전화번호 OTP 인증 후 가입 |
| POST | `/auth/register` | 계약서 서명 후 자동 가입 (레거시) |
| POST | `/auth/reset-password` | 임시 비밀번호 SMS 발송 |
| POST | `/phone-verify` | OTP 발송(`action:request`) / 확인(`action:confirm`) |
| GET/POST | `/invite/:id` | 초대 링크 정보 조회 / 코드 검증(`action:verify`) / 가입(`action:signup`) |

### 프로필
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET/PATCH | `/profile` | 프로필 조회/수정 (이름·전화번호·비밀번호) | ✅ |
| POST | `/profile/delete` | 회원 탈퇴 (PII 익명화) | ✅ |
| POST | `/profile/email-change/request` | 이메일 아이디 변경 인증 코드 발송 | ✅ |
| POST | `/profile/email-change/confirm` | 인증 코드 확인 후 loginId 교체 | ✅ |
| GET/POST | `/signature` | 서명 이미지 조회/저장 | ✅ |

### 출퇴근
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/site/current` | 현재 배정 현장 정보 | ✅ |
| POST | `/site/register` | 현장 등록 (신규 가입 후) | ✅ |

> 출퇴근 API는 `/api/attendance/` 하위에 별도 위치

### 일지
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/logs/save` | 일지 저장 (단건) | ✅ |
| POST | `/logs/batch-save` | 일지 일괄 저장 | ✅ |
| GET | `/logs/prev` | 이전 일지 조회 | ✅ |
| POST | `/ai/voice-to-log` | 음성 → 일지 생성 (Groq STT + Gemini) | ✅ |
| POST | `/ai/batch-voice-to-log` | 음성 일괄 일지 생성 | ✅ |

### 문서
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/docs/view` | 문서 데이터 조회 (5종) | ✅ |
| POST | `/docs/generate` | PDF 생성 | ✅ |
| GET | `/docs/preview` | PDF 미리보기 | ✅ |
| POST | `/docs/inperson-sign` | 인-퍼슨 담당자 서명 처리 | ✅ |
| GET | `/docs/sign-token` | 서명 토큰 조회 | ✅ |

### 기타
| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/contracts` | 계약서 조회 (서명 토큰 기반, 비인증 허용) | - |
| POST | `/contracts` | 계약서 서명 | - |
| GET | `/calendar` | 캘린더 (출퇴근+휴무일) | ✅ |
| GET/POST/DELETE | `/holidays` | 커스텀 휴무일 CRUD | ✅ |
| GET | `/history` | 문서 이력 조회 | ✅ |
| GET | `/evaluation` | 훈련생 평가 조회 | ✅ |
| POST | `/evaluation` | 훈련생 평가 저장 | ✅ |
| GET/PATCH | `/notification` | 알람 설정 | ✅ |
| GET | `/payroll` | 급여 조회 | ✅ |
| POST | `/onboarding` | 온보딩 (임시→정식 계정 전환) | ✅ |

---

## 결제 API `/api/payments/`

| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/billing` | 빌링키 발급 + 최초 결제 | 관리자 |
| POST | `/charge` | 자동 결제 (Cron 호출) | `CRON_SECRET` |
| POST | `/cancel` | 구독 해지 | 직무지도원 |

---

## 배치 API `/api/cron/`

| Method | 경로 | 스케줄 | 인증 |
|--------|------|--------|------|
| GET | `/daily` | 매일 00:00 KST | `CRON_SECRET` |

---

## 기타 API

| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/geo/coord2address` | 좌표 → 주소 변환 (카카오 API) | ✅ (worker) |
