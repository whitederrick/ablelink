# 시스템 아키텍처

## 전체 구조

```
┌─────────────────────────────────────────────────────┐
│                    클라이언트                         │
│  ┌──────────────┐        ┌──────────────────────┐   │
│  │ 관리자 브라우저│        │ 직무지도원 (PWA/모바일) │   │
│  └──────┬───────┘        └──────────┬───────────┘   │
└─────────┼──────────────────────────┼───────────────┘
          │ HTTPS                    │ HTTPS
          ▼                          ▼
┌─────────────────────────────────────────────────────┐
│                   Vercel Edge Network                 │
│  ┌───────────────────────────────────────────────┐  │
│  │           Next.js 15 (App Router)              │  │
│  │  ┌─────────────┐   ┌─────────────────────┐   │  │
│  │  │  /admin/*   │   │     /worker/*        │   │  │
│  │  │  페이지/UI  │   │     페이지/UI (PWA)  │   │  │
│  │  └─────────────┘   └─────────────────────┘   │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │           API Routes (/api/*)            │  │  │
│  │  │  admin/ │ worker/ │ payments/ │ cron/   │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
   │  Supabase   │  │ Upstash Redis│  │  외부 서비스  │
   │ PostgreSQL  │  │ Rate Limiting│  │  AWS SES      │
   │ (PgBouncer) │  │              │  │  Groq AI      │
   └─────────────┘  └──────────────┘  │  Gemini AI    │
                                       │  Toss 결제    │
                                       │  카카오 알림톡│
                                       └──────────────┘
```

---

## 기술 스택 상세

### 프론트엔드
| 항목 | 기술 | 비고 |
|------|------|------|
| 프레임워크 | Next.js 15 App Router | 서버 컴포넌트 + 클라이언트 컴포넌트 혼용 |
| 스타일 | Tailwind CSS v3 | 커스텀 토큰 없이 유틸리티 클래스만 사용 |
| 아이콘 | Lucide React | |
| 지도 | Leaflet (관리자) | 출근부 GPS 지도 시각화 |
| PWA | Service Worker + manifest | 직무지도원 앱 전용 |

### 백엔드 (Next.js API Routes)
| 항목 | 기술 | 비고 |
|------|------|------|
| ORM | Prisma 5 | |
| DB | PostgreSQL via Supabase | PgBouncer Transaction Mode (포트 6543) |
| 인증 | JWT (jose) + HttpOnly 쿠키 | 관리자/직무지도원 별도 시크릿 |
| Rate Limiting | Upstash Redis | 로그인·OTP 엔드포인트 |
| PDF 생성 | PDFKit | 서버사이드 렌더링 |
| ZIP 패키징 | JSZip | 감사 서류 패키지 |

### AI 서비스
| 항목 | 기술 | 용도 |
|------|------|------|
| STT | Groq Whisper | 음성 → 텍스트 변환 |
| 일지 생성 | Google Gemini | STT 결과 → 업무일지 자동 작성 |

### 외부 서비스
| 서비스 | 용도 | 환경변수 |
|--------|------|----------|
| AWS SES | 이메일 발송 | `AWS_SES_*` |
| 토스페이먼츠 | 구독 결제 (빌링키) | `TOSS_PAYMENTS_*` |
| 카카오 알림톡 (알리고) | SMS/알림톡 발송 | `KAKAO_ALIMTALK_*` |
| Supabase Storage | 서명 이미지, PDF 저장 | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

---

## 인증 구조

### 관리자 인증
```
POST /api/admin/auth/login
  → bcrypt 비밀번호 검증
  → JWT 서명 (ADMIN_SESSION_SECRET)
  → admlink_admin_session 쿠키 (HttpOnly, Secure, SameSite=Lax, 8시간)

requireAdminSession(req)
  → 쿠키에서 JWT 검증
  → AdminScope { userId, role, agencyId } 반환
  → role=AGENCY 이면 agencyId 필수 (스코프 강제)
```

### 직무지도원 인증
```
POST /api/worker/auth/login
  → bcrypt 비밀번호 검증
  → JWT 서명 (WORKER_SESSION_SECRET)
  → ablelink_worker_session 쿠키 (HttpOnly, Secure, SameSite=Lax, 7일)

getWorkerSessionFromReq(req)
  → 쿠키에서 JWT 검증
  → WorkerPayload { workerId, workerName, isTemporary } 반환
  → isTemporary=true 이면 /worker/onboarding 리다이렉트
```

---

## 보안 헤더 (next.config.ts)

| 헤더 | 값 |
|------|---|
| `Strict-Transport-Security` | max-age=63072000; includeSubDomains; preload |
| `X-Frame-Options` | SAMEORIGIN |
| `X-Content-Type-Options` | nosniff |
| `Referrer-Policy` | strict-origin-when-cross-origin |
| `Permissions-Policy` | camera=(), microphone=(), geolocation=(self) |

---

## 배치 작업 (Vercel Cron)

| 작업 | 스케줄 | 경로 | 내용 |
|------|--------|------|------|
| 일일 배치 | 매일 00:00 KST | `/api/cron/daily` | 출퇴근 자동 확정, 만료 토큰 정리, 계약 만료 알림톡 |
| 자동 결제 | 매일 01:00 KST | `/api/payments/charge` | nextBillingAt 도래한 구독 자동 결제 |

인증: `CRON_SECRET` 헤더 검증

---

## 데이터 흐름 — 출퇴근

```
직무지도원 앱
  → GPS 위치 수집
  → POST /api/attendance/clock-in (위도/경도)
  → 서버: 현장 기준점과 거리 계산
  → DailyAttendance 생성 (WORKING)
  → 퇴근 시 endTime 기록 + TraineeLog 연결
  → AUTO_FINALIZE_MINUTES 경과 후 자동 확정 (isFinalClosed=true)
```

## 데이터 흐름 — 문서 생성

```
관리자
  → POST /api/admin/docs/generate (workerId, docType, periodStart, periodEnd)
  → 서버: DB에서 출퇴근·일지 데이터 수집
  → PDFKit으로 PDF 렌더링
  → Supabase Storage 업로드
  → DocumentVersion 생성
  → (선택) AWS SES로 이메일 발송
```
