# AbleLink

장애인 직무지도원 및 에이전시 통합 관리 서비스

## 개요

AbleLink는 장애인 고용 지원 서비스를 운영하는 에이전시와 직무지도원을 연결하는 SaaS 플랫폼입니다.

- **에이전시 관리자**: 직무지도원 배정, 계약, 급여, 문서, 현장 관리
- **직무지도원**: GPS 출퇴근, AI 업무일지, 훈련생 평가, 전자서명

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Next.js 15 (App Router) |
| 언어 | TypeScript |
| 스타일 | Tailwind CSS |
| ORM | Prisma 5 |
| DB | PostgreSQL (Supabase) |
| 인증 | JWT (jose) + HttpOnly 쿠키 |
| AI | Groq (STT), Gemini (일지 생성) |
| 이메일 | AWS SES |
| 결제 | 토스페이먼츠 빌링 |
| 캐시/Rate Limit | Upstash Redis |
| PDF | PDFKit |
| 배포 | Vercel |

---

## 로컬 실행

### 사전 요구사항

- Node.js 20+
- PostgreSQL (또는 Supabase 프로젝트)

### 설치

```bash
npm install
```

### 환경변수 설정

`.env` 파일을 생성하고 [환경변수 명세서](./env-vars.md)를 참고하여 값을 입력합니다.

### DB 마이그레이션

```bash
npx prisma migrate deploy
npx prisma generate
```

### 개발 서버 실행

```bash
npm run dev
```

- 관리자: http://localhost:3000/admin/login
- 직무지도원: http://localhost:3000/worker/login

---

## 폴더 구조

```
ablelink/
├── app/
│   ├── admin/          # 관리자 페이지 (Next.js App Router)
│   ├── worker/         # 직무지도원 페이지
│   ├── api/
│   │   ├── admin/      # 관리자 API 라우트
│   │   ├── worker/     # 직무지도원 API 라우트
│   │   ├── payments/   # 결제 API
│   │   └── cron/       # 배치 작업
│   ├── terms/          # 서비스 이용약관
│   └── privacy/        # 개인정보처리방침
├── lib/                # 공통 유틸 (email, sms, pdf, rateLimit 등)
├── prisma/
│   ├── schema.prisma   # DB 스키마
│   └── migrations/     # 마이그레이션 이력
├── public/             # 정적 파일 (PWA manifest, 아이콘 등)
└── docs/               # 개발 산출물
```

---

## 주요 명령어

```bash
npm run dev          # 개발 서버 (webpack 모드)
npm run build        # 프로덕션 빌드 (prisma generate 포함)
npm run lint         # ESLint
npx prisma studio    # DB GUI
npx prisma migrate dev --name <이름>   # 새 마이그레이션 생성
```

---

## 관련 문서

- [ERD](./erd.md)
- [시스템 아키텍처](./architecture.md)
- [API 명세서](./api-spec.md)
- [기능 명세서](./features.md)
- [화면 흐름도](./page-flow.md)
- [배포 및 운영 매뉴얼](./deployment.md)
- [환경변수 명세서](./env-vars.md)
