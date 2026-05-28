# 환경변수 명세서

> ✅ 필수 | ⚡ 기능 필수 (없으면 해당 기능 비활성) | 🔧 선택 (기본값 있음)

---

## 데이터베이스

| 변수명 | 필수 | 설명 | 예시 |
|--------|------|------|------|
| `DATABASE_URL` | ✅ | Supabase Transaction Mode (포트 6543, PgBouncer) | `postgres://...?pgbouncer=true` |
| `DIRECT_URL` | ✅ | Supabase Direct Connection (포트 5432, 마이그레이션용) | `postgres://...:5432/postgres` |

---

## 세션 / 인증

| 변수명 | 필수 | 설명 | 예시 |
|--------|------|------|------|
| `ADMIN_SESSION_SECRET` | ✅ | 관리자 JWT 서명 시크릿 (32자 이상 랜덤) | `423e17f71de298...` |
| `WORKER_SESSION_SECRET` | ✅ | 직무지도원 JWT 서명 시크릿 (32자 이상 랜덤) | `9e81bde5adc3ae...` |
| `ADMIN_SESSION_COOKIE` | 🔧 | 관리자 세션 쿠키명 | `admlink_admin_session` |
| `ADMIN_SESSION_MAX_AGE_SEC` | 🔧 | 관리자 세션 유효기간(초) | `28800` (8시간) |

> **생성 방법**: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Supabase 스토리지

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase 프로젝트 URL (SSRF 방어 allowlist 기준) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service_role 키 (서명 이미지·PDF 업로드) |

---

## AWS SES (이메일)

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `AWS_SES_REGION` | ✅ | SES 리전 | `ap-northeast-2` |
| `AWS_SES_ACCESS_KEY` | ✅ | IAM Access Key ID |
| `AWS_SES_SECRET_KEY` | ✅ | IAM Secret Access Key |
| `AWS_REGION` | 🔧 | onboarding 라우트용 리전 (fallback) | `ap-northeast-2` |
| `EMAIL_FROM` | 🔧 | 이메일 발신자 표시명 | `AbleLink <noreply@able-link.co.kr>` |
| `SES_FROM_EMAIL` | 🔧 | 발신 이메일 주소 | `noreply@able-link.co.kr` |

> **주의**: AWS SES 샌드박스 해제 전까지는 등록된 이메일로만 발송 가능

---

## AI 서비스

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `GROQ_API_KEY` | ⚡ | Groq Whisper STT (음성 → 텍스트) |
| `GEMINI_API_KEY` | ⚡ | Google Gemini (텍스트 → 일지 생성) |

> 미설정 시 AI 일지 기능 오류

---

## 토스페이먼츠 (결제)

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` | ⚡ | 토스 클라이언트 키 (브라우저 노출) |
| `TOSS_PAYMENTS_SECRET_KEY` | ⚡ | 토스 시크릿 키 (서버 전용) |

> - 테스트: `test_ck_...`, `test_sk_...`
> - 운영: `live_ck_...`, `live_sk_...` ← **출시 전 교체 필요**

---

## 카카오 알림톡 (알리고)

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `KAKAO_ALIMTALK_API_KEY` | ⚡ | 알리고 API 키 |
| `KAKAO_ALIMTALK_USERID` | ⚡ | 알리고 계정 ID |
| `KAKAO_ALIMTALK_SENDER_KEY` | ⚡ | 카카오 채널 발신 프로필 키 |
| `KAKAO_ALIMTALK_SENDER_PHONE` | ⚡ | 발신 번호 |
| `KAKAO_CONTRACT_TEMPLATE_CODE` | ⚡ | 계약서 서명 요청 템플릿 코드 |
| `KAKAO_SIGNUP_TEMPLATE_CODE` | ⚡ | 신규 가입 안내 템플릿 코드 |
| `KAKAO_CONTRACT_SIGNED_TEMPLATE_CODE` | ⚡ | 서명 완료 알림 템플릿 코드 |
| `KAKAO_CONTRACT_EXPIRY_TEMPLATE_CODE` | ⚡ | 계약 만료 D-30/7/1 템플릿 코드 |
| `KAKAO_REST_API_KEY` | ⚡ | 카카오 REST API 키 |

> 미설정 시 SMS/알림톡 발송 비활성화 (콘솔 로그로 대체)

---

## Redis (Rate Limiting)

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis REST Token |

> 미설정 시 인메모리 폴백 (단일 인스턴스에서만 유효)

---

## 배치 작업

| 변수명 | 필수 | 설명 | 기본값 |
|--------|------|------|--------|
| `CRON_SECRET` | ✅ | Cron 엔드포인트 인증 시크릿 | - |
| `AUTO_FINALIZE_MINUTES` | 🔧 | 퇴근 후 자동 확정까지 분 단위 | `60` |

---

## 앱 설정

| 변수명 | 필수 | 설명 | 기본값 |
|--------|------|------|--------|
| `NEXT_PUBLIC_APP_URL` | ✅ | 앱 공개 URL (초대 링크 생성 등) | `https://able-link.co.kr` |
| `NEXT_PUBLIC_BASE_URL` | 🔧 | 기본 URL (로컬 개발용) | `http://localhost:3000` |

---

## 미사용 / 레거시

| 변수명 | 상태 | 설명 |
|--------|------|------|
| `JSREPORT_URL` | 레거시 | 구 PDF 생성 서버 URL (현재 PDFKit 사용) |

---

## .env 파일 전체 템플릿

```env
# Database
DATABASE_URL="postgres://...?pgbouncer=true"
DIRECT_URL="postgres://...:5432/postgres"

# Session
ADMIN_SESSION_SECRET=""
WORKER_SESSION_SECRET=""
ADMIN_SESSION_COOKIE="admlink_admin_session"
ADMIN_SESSION_MAX_AGE_SEC=28800

# Supabase
NEXT_PUBLIC_SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""

# AWS SES
AWS_SES_REGION="ap-northeast-2"
AWS_SES_ACCESS_KEY=""
AWS_SES_SECRET_KEY=""
AWS_REGION="ap-northeast-2"
EMAIL_FROM="AbleLink <noreply@able-link.co.kr>"
SES_FROM_EMAIL="noreply@able-link.co.kr"

# AI
GROQ_API_KEY=""
GEMINI_API_KEY=""

# Toss (테스트)
NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_..."
TOSS_PAYMENTS_SECRET_KEY="test_sk_..."

# Kakao
KAKAO_REST_API_KEY=""
KAKAO_ALIMTALK_API_KEY=""
KAKAO_ALIMTALK_USERID=""
KAKAO_ALIMTALK_SENDER_KEY=""
KAKAO_ALIMTALK_SENDER_PHONE=""
KAKAO_CONTRACT_TEMPLATE_CODE=""
KAKAO_SIGNUP_TEMPLATE_CODE=""
KAKAO_CONTRACT_SIGNED_TEMPLATE_CODE=""
KAKAO_CONTRACT_EXPIRY_TEMPLATE_CODE=""

# Redis
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""

# Cron
CRON_SECRET=""
AUTO_FINALIZE_MINUTES=60

# App
NEXT_PUBLIC_APP_URL="https://able-link.co.kr"
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```
