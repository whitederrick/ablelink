# 화면 흐름도

---

## 직무지도원 화면 구조

```
/worker/
├── login                  # 로그인
├── signup                 # 셀프 가입 (OTP → 정보 → 약관)
├── invite/[id]            # 초대 링크 가입 (코드 → 정보 → 약관)
├── register               # 레거시 가입 (계약서 서명 후)
├── reset-password         # 비밀번호 찾기 (임시 비밀번호 SMS)
├── onboarding             # 임시 계정 → 정식 계정 전환
│
├── home                   # 홈 (출퇴근 버튼, 오늘 현황)
├── worklog                # 업무일지 작성
├── history                # 문서 이력
├── docs                   # 문서 조회 (5종)
├── calendar               # 캘린더 (출퇴근 + 휴무일)
├── evaluation             # 훈련생 평가
│
├── profile                # 내 정보 수정 + 회원 탈퇴
├── site/register          # 현장 등록 (첫 가입 후)
├── subscribe              # 구독 (결제)
│
├── signature              # 서명 등록
└── contracts              # 근로계약서 서명 (토큰 기반)
```

### 직무지도원 인증 흐름

```
┌─────────────────────────────────────────────────────────┐
│                    첫 진입 경로                           │
├──────────────┬──────────────────┬───────────────────────┤
│ /worker/login│ /worker/signup   │ /worker/invite/[id]   │
│ (기존 계정)  │ (신규 OTP 가입)  │ (관리자 초대)         │
└──────┬───────┴────────┬─────────┴────────────┬──────────┘
       │                 │                       │
       ▼                 ▼                       ▼
  로그인 성공        OTP 인증→가입           코드 확인→가입
       │                 │                       │
       ├─── isTemporary? ─Yes──→ /worker/onboarding
       │                                         │
       ├─── hasSite? ──No──→ /worker/site/register
       │
       ▼
  /worker/home  (메인 화면)
```

### 홈 화면 상태 흐름

```
/worker/home
  ├── 출근 전: [출근하기] 버튼
  │     → GPS 수집 → 거리 계산 → 출근 처리
  │
  ├── 근무 중: [퇴근하기] 버튼 + 근무 시간 표시
  │     → 퇴근 처리 → 일지 작성 유도
  │
  └── 퇴근 후: 일지 작성 현황 + [일지 작성하기] 링크
        → /worker/worklog
```

---

## 관리자 화면 구조

```
/admin/
├── login                  # 로그인
│
├── (layout.tsx)           # 공통 사이드바 레이아웃
│   ├── page (/)           # 대시보드
│   │
│   ├── coaches            # 직무지도원 관리
│   │   └── (InviteModal)  # 초대 발송 모달
│   │
│   ├── sites              # 현장 관리
│   │   └── [id]           # 현장 상세
│   │
│   ├── attendances        # 출퇴근 관리 (지도 포함)
│   │
│   ├── inbox              # 근태 이슈 수신함
│   │
│   ├── contracts          # 근로계약서
│   │
│   ├── documents          # 문서 관리
│   │   └── (5종 탭)
│   │
│   ├── payroll            # 급여 관리
│   │   └── (3탭: 계약/계산/공제설정)
│   │
│   ├── reports            # 훈련생 진척도 리포트
│   │
│   ├── managers           # 기관 담당자 관리
│   │
│   ├── signature          # 서명 등록
│   │
│   └── subscription       # 구독 관리
```

### 관리자 인증 흐름

```
/admin/login
  → 아이디/비밀번호 입력
  → POST /api/admin/auth/login
  → 세션 쿠키 발급
  → /admin (대시보드)
```

### 문서 생성 흐름

```
/admin/documents
  1. DocumentRun 선택/생성 (직무지도원, 문서 종류, 기간)
  2. [미리보기] → PDF 렌더링 확인
  3. [관리자 서명] → 서명 이미지 삽입
  4. [이메일 발송] → 수신자 이메일 입력 → SES 발송
  5. 발송 이력 확인
```

### 급여 계산 흐름

```
/admin/payroll
  탭1 [급여 계약]
    → 직무지도원별 payType, 시급/일급/월급, 소득유형 설정

  탭2 [급여 계산]
    → 연월 선택 → [계산 실행]
    → DRAFT 생성 (출퇴근 기록 기반 자동 계산)
    → 검토 후 [확정] → FINALIZED

  탭3 [공제 설정]
    → 에이전시 커스텀 공제 항목 CRUD
```

### 초대 발송 흐름

```
/admin/coaches
  [초대 발송] 버튼 클릭
  → 전화번호 입력 (필수)
  → 이름, 배정 현장 입력 (선택)
  → [초대 발송]
  → SMS 발송 (환경변수 설정 시) 또는 콘솔 출력
  → 결과 화면: 인증번호(6자리) + 초대 링크 + 복사 버튼
```

---

## 공개 페이지

```
/terms          # 서비스 이용약관
/privacy        # 개인정보처리방침
/worker/contracts  # 근로계약서 서명 (토큰 기반, 비인증)
```

---

## 페이지 접근 제어 요약

| 경로 | 인증 | 비고 |
|------|------|------|
| `/admin/*` | 관리자 세션 | 미인증 시 `/admin/login` |
| `/worker/home` ~ | 직무지도원 세션 | 미인증 시 `/worker/login` |
| `/worker/home` (isTemporary) | - | `/worker/onboarding` 강제 |
| `/worker/login`, `/signup`, `/invite/*` | 불필요 | 공개 |
| `/terms`, `/privacy` | 불필요 | 공개 |
| `/worker/contracts` | 불필요 | 토큰 파라미터 필요 |
