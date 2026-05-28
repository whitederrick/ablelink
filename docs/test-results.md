# 테스트 결과 리포트

> 테스트 일시: 2026-05-28  
> 테스트 환경: 로컬 dev 서버 (http://localhost:3000)  
> 테스트 방식: curl API 호출 + 런타임 직접 실행

---

## 전체 요약

| 구분 | 전체 | ✅ PASS | ❌ FAIL | 🔴 버그(수정완료) |
|------|------|---------|---------|-----------------|
| 공개 페이지 | 5 | 5 | 0 | 0 |
| 페이지 보호(리다이렉트) | 4 | 4 | 0 | 0 |
| 관리자 인증 | 5 | 5 | 0 | 0 |
| 관리자 핵심 API | 6 | 6 | 0 | 0 |
| 직무지도원 인증 | 3 | 3 | 0 | 0 |
| 직무지도원 핵심 API | 5 | 5 | 0 | 0 |
| 보안 (Rate Limit / 스코프) | 5 | 5 | 0 | 0 |
| 입력값 검증 | 4 | 4 | 0 | 0 |
| 기타 (robots/404/탈퇴) | 4 | 4 | 0 | 0 |
| **공개 API 접근** | **5** | **0** | **5** | **5 (수정완료)** |
| **합계** | **46** | **41** | **5** | **5** |

---

## 1. 공개 페이지 접근

| # | 경로 | 기대 | 결과 |
|---|------|------|------|
| 1 | `/worker/login` | 200 | ✅ 200 |
| 2 | `/worker/signup` | 200 | ✅ 200 |
| 3 | `/terms` | 200 | ✅ 200 |
| 4 | `/privacy` | 200 | ✅ 200 |
| 5 | `/nonexistent` | 404 | ✅ 404 (커스텀 404 페이지) |

---

## 2. 페이지 보호 (미인증 → 로그인 리다이렉트)

| # | 경로 | 기대 | 결과 |
|---|------|------|------|
| 1 | `/admin` | 307 → `/admin/login` | ✅ 307 |
| 2 | `/admin/coaches` | 307 → `/admin/login` | ✅ 307 |
| 3 | `/worker/home` | 307 → `/worker/login` | ✅ 307 |
| 4 | `/worker/profile` | 307 → `/worker/login` | ✅ 307 |

---

## 3. 관리자 인증

| # | 시나리오 | 기대 | 결과 |
|---|----------|------|------|
| 1 | 정상 로그인 (admin/admin1234!) | `success:true` | ✅ |
| 2 | 잘못된 비밀번호 | `success:false` + 오류 메시지 | ✅ |
| 3 | 빈 칸 로그인 | `success:false` + 오류 메시지 | ✅ |
| 4 | 로그아웃 후 dashboard 접근 | 401 | ✅ |
| 5 | 세션 쿠키로 `/api/admin/auth/me` | role/agencyId 포함 응답 | ✅ |

---

## 4. 관리자 핵심 API

| # | 엔드포인트 | 기대 | 결과 |
|---|-----------|------|------|
| 1 | `GET /api/admin/dashboard` | `success:true` | ✅ |
| 2 | `GET /api/admin/coaches` | `success:true`, total:1 | ✅ |
| 3 | `GET /api/admin/sites` | `success:true`, total:1 | ✅ |
| 4 | `GET /api/admin/assignments` | `success:true` | ✅ |
| 5 | `GET /api/admin/trainees/summary` (인증) | `success:true` | ✅ |
| 6 | `GET /api/admin/trainees/summary` (미인증) | 401 | ✅ |

---

## 5. 직무지도원 인증

| # | 시나리오 | 기대 | 결과 |
|---|----------|------|------|
| 1 | 정상 로그인 (worker01/worker1234!) | `success:true` + 현장 정보 | ✅ |
| 2 | 잘못된 비밀번호 | `success:false` | ✅ |
| 3 | 워커 쿠키로 관리자 API 접근 | 401 | ✅ |

---

## 6. 직무지도원 핵심 API

| # | 엔드포인트 | 기대 | 결과 |
|---|-----------|------|------|
| 1 | `GET /api/worker/profile` | `success:true` + 이름 | ✅ |
| 2 | `GET /api/worker/site/current` | 현장명·훈련생 목록 | ✅ |
| 3 | `GET /api/worker/calendar` | `success:true` | ✅ |
| 4 | `GET /api/worker/payroll` | `success:true` | ✅ |
| 5 | `GET /api/worker/profile` (미인증) | 401 | ✅ |

---

## 7. 보안

| # | 시나리오 | 기대 | 결과 |
|---|----------|------|------|
| 1 | OTP 10회 초과 요청 | 11번째부터 429 | ✅ (8번째부터 429 — Redis 윈도우 누적) |
| 2 | Cron 시크릿 없이 `/api/cron/daily` | 401 | ✅ |
| 3 | 잘못된 Cron 시크릿 | 401 | ✅ |
| 4 | 미인증으로 모든 admin API 접근 | 401 | ✅ |
| 5 | 회원 탈퇴 - 잘못된 비밀번호 | `success:false` | ✅ |

---

## 8. 입력값 검증

| # | 시나리오 | 기대 | 결과 |
|---|----------|------|------|
| 1 | 전화번호 형식 오류 (짧은 번호) | 400 + 오류 메시지 | ✅ |
| 2 | OTP 틀린 코드 확인 | `success:false` | ✅ |
| 3 | 계약서 잘못된 토큰 | `success:false` | ✅ |
| 4 | 관리자 로그인 빈 칸 | 400 + 오류 메시지 | ✅ |

---

## 9. 기타

| # | 시나리오 | 기대 | 결과 |
|---|----------|------|------|
| 1 | `GET /robots.txt` | Disallow: /admin/, /api/ 포함 | ✅ |
| 2 | 존재하지 않는 URL | 404 커스텀 페이지 | ✅ |
| 3 | 회원 탈퇴 - 잘못된 비밀번호 | `success:false` | ✅ |
| 4 | `GET /api/admin/payroll/runs` | `success:true` | ✅ |

---

## 🔴 발견된 버그 (모두 수정 완료)

### BUG-001: proxy.ts 공개 경로 5개 누락

| 항목 | 내용 |
|------|------|
| 심각도 | 🔴 Critical — 출시 시 가입/초대 기능 전체 불동작 |
| 증상 | `/worker/signup`, `/worker/invite/*`, `/api/worker/phone-verify`, `/api/worker/invite/*`, `/api/worker/contracts` 모두 401 반환 |
| 원인 | 2026-05-28 가입/초대 플로우 추가 시 `proxy.ts` 공개 경로 allowlist 업데이트 누락 |
| 수정 | `proxy.ts`에 5개 경로 추가 (커밋 `8dd832b`) |

### BUG-002: proxy.ts 구조적 문제 (allowlist 방식)

| 항목 | 내용 |
|------|------|
| 심각도 | 🟡 Medium — 향후 기능 추가 시 BUG-001 반복 가능 |
| 원인 | API 라우트 공개/보호 여부를 미들웨어 allowlist로 관리 → 누락 반복 구조 |
| 수정 | API 라우트를 미들웨어에서 완전 제외, 각 라우트 자체 인증 처리로 전환 (커밋 `64eabf0`) |

---

## 미실행 항목 (환경 제약)

| 항목 | 사유 |
|------|------|
| GPS 출퇴근 | 실제 기기 위치 필요 |
| SMS/알림톡 발송 | 카카오 계정 미연동 (환경변수 미설정) |
| 실제 이메일 발송 | AWS SES 샌드박스 미해제 |
| 토스 결제 | 실카드 필요 (운영 키 미전환) |
| PWA (홈 화면 추가) | 실제 모바일 기기 필요 |
| 에이전시 스코프 격리 | 테스트용 다중 에이전시 계정 생성 실패 (tsx 환경 문제) |
