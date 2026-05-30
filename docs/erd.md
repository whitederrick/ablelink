# ERD (Entity Relationship Diagram)

> Prisma schema 기반으로 자동 생성. DB 테이블명은 snake_case, 모델명은 PascalCase.

---

## 핵심 관계 다이어그램

```mermaid
erDiagram
    Worker {
        bigint id PK
        string login_id UK
        string password
        string worker_name
        string phone_number
        enum role
        enum status
        enum plan_type
        string signature_url
        boolean is_temporary
        datetime consent_terms_at
        datetime consent_privacy_at
        datetime consent_location_at
        datetime created_at
    }

    Agency {
        bigint id PK
        string name UK
        enum plan_type
        int max_workers
        int max_sites
        datetime trial_started_at
        datetime trial_ends_at
        string toss_customer_key UK
        string toss_billing_key
        datetime next_billing_at
    }

    AdminUser {
        bigint id PK
        string login_id UK
        string password_hash
        enum role
        string display_name
        bigint agency_id FK
        string signature_url
        boolean is_active
    }

    Site {
        bigint id PK
        string company_name
        string address
        decimal gps_lat
        decimal gps_lon
        int allowance_range
        bigint agency_id FK
        boolean is_active
    }

    SiteAssignment {
        bigint id PK
        bigint worker_id FK
        bigint site_id FK
        bigint agency_id FK
        enum service_step
        enum status
        datetime start_date
        datetime end_date
        string work_type
    }

    DailyAttendance {
        bigint id PK
        bigint worker_id FK
        bigint site_id FK
        bigint assignment_id FK
        string work_date
        datetime start_time
        datetime end_time
        boolean is_final_closed
    }

    TraineeLog {
        bigint id PK
        bigint attendance_id FK
        bigint trainee_id FK
        bigint writer_id FK
        string training_type
        decimal time_1on1
        decimal time_group
        boolean is_completed
    }

    Trainee {
        bigint id PK
        bigint current_site_id FK
        string name
        string gender
        string disability_type
        enum status
    }

    EmploymentContract {
        bigint id PK
        bigint agency_id FK
        bigint worker_id FK
        string sign_token UK
        enum status
        datetime contract_start
        datetime contract_end
    }

    DocumentRun {
        bigint id PK
        bigint assignment_id FK
        bigint site_id FK
        bigint worker_id FK
        enum doc_type
        enum status
        string sign_stage
        datetime period_start
        datetime period_end
    }

    PayContract {
        bigint id PK
        bigint agency_id FK
        bigint worker_id FK
        enum worker_type
        enum pay_type
        decimal base_amount
        enum income_type
        datetime effective_from
    }

    PayrollRun {
        bigint id PK
        bigint agency_id FK
        string year_month
        enum status
    }

    PayrollItem {
        bigint id PK
        bigint run_id FK
        bigint worker_id FK
        decimal gross_pay
        decimal total_deduction
        decimal net_pay
    }

    WorkerInvite {
        bigint id PK
        bigint agency_id FK
        bigint site_id FK
        string phone_number
        string code
        datetime expires_at
        datetime used_at
    }

    PhoneVerification {
        bigint id PK
        string phone_number
        string code
        datetime expires_at
        boolean verified
    }

    User ||--o{ SiteAssignment : "배정됨"
    User ||--o{ DailyAttendance : "출퇴근"
    User ||--o{ TraineeLog : "작성"
    User ||--o{ PayContract : "급여계약"
    User ||--o{ PayrollItem : "급여항목"
    User ||--o{ EmploymentContract : "근로계약"

    Agency ||--o{ AdminUser : "관리자"
    Agency ||--o{ Site : "현장"
    Agency ||--o{ SiteAssignment : "배정"
    Agency ||--o{ PayContract : "급여계약"
    Agency ||--o{ PayrollRun : "급여실행"
    Agency ||--o{ EmploymentContract : "근로계약"
    Agency ||--o{ WorkerInvite : "초대"

    Site ||--o{ SiteAssignment : "배정"
    Site ||--o{ DailyAttendance : "출퇴근"
    Site ||--o{ Trainee : "훈련생"
    Site ||--o{ WorkerInvite : "초대"

    SiteAssignment ||--o{ DailyAttendance : "출퇴근"
    SiteAssignment ||--o{ DocumentRun : "문서"

    DailyAttendance ||--o{ TraineeLog : "일지"

    Trainee ||--o{ TraineeLog : "일지"

    PayrollRun ||--o{ PayrollItem : "항목"

    DocumentRun ||--o{ DocumentVersion : "버전"
```

---

## 테이블 목록

| 테이블 | 설명 | 주요 관계 |
|--------|------|----------|
| `users` | 직무지도원 계정 | Agency ← SiteAssignment |
| `agencies` | 에이전시 (구독 단위) | AdminUser, Site, PayrollRun |
| `admin_users` | 관리자 계정 | Agency (agencyId FK) |
| `sites` | 사업체/현장 | Agency, SiteAssignment |
| `site_assignments` | 직무지도원-현장 배정 | User, Site, Agency |
| `daily_attendances` | 일별 출퇴근 기록 | SiteAssignment (Cascade) |
| `trainees` | 훈련생 | Site |
| `trainee_logs` | 훈련일지 | DailyAttendance, Trainee |
| `trainee_log_tasks` | 일지별 과업 | TraineeLog (Cascade) |
| `trainee_placements` | 훈련생-현장 배치 이력 | Trainee, Site |
| `trainee_evaluations` | 훈련생 종합평가 | Trainee, User |
| `employment_contracts` | 근로계약서 | Agency, User |
| `document_runs` | 문서 제출 사이클 | SiteAssignment (Cascade) |
| `document_versions` | 문서 버전 (PDF) | DocumentRun |
| `document_submission_logs` | 문서 발송 이력 | DocumentRun, DocumentVersion |
| `pay_contracts` | 급여 계약 | Agency, User |
| `payroll_runs` | 월별 급여 계산 실행 | Agency |
| `payroll_items` | 개인별 급여 항목 | PayrollRun, User |
| `agency_deductions` | 에이전시 커스텀 공제 | Agency |
| `insurance_rates` | 연도별 4대보험 요율 | - |
| `site_base_points` | 현장 GPS 기준점 | Site |
| `site_holidays` | 커스텀 휴무일 | SiteAssignment |
| `site_sign_tokens` | 사업체담당자 서명 토큰 | SiteAssignment |
| `attendance_issues` | 근태 이슈 | DailyAttendance (1:1) |
| `attendance_issue_events` | 근태 이슈 이벤트 이력 | AttendanceIssue |
| `worker_invites` | 직무지도원 초대 링크 | Agency, Site |
| `phone_verifications` | 전화번호 OTP 인증 | - |
| `worker_notification_settings` | 알람 설정 | Worker (1:1) |
| `submission_requests` | 문서 제출 요청 | SiteAssignment |
| `audit_events` | 감사 로그 | - |
| `common_codes` | 공통 코드 | - |

---

## 주요 Enum

| Enum | 값 |
|------|---|
| `AgencyPlanType` | FREE, TRIAL, STARTER, STANDARD, PRO |
| `AdminRole` | ADMIN, GOV, AGENCY |
| `WorkerRole` | ADMIN, WORKER |
| `WorkerStatus` | ACTIVE, RESIGNED, PAUSED |
| `AssignStatus` | ACTIVE, ENDED, ASSIGNED, CONFIRMED, REJECTED, DROPPED |
| `ServiceStep` | PRE_TRAINING, FIELD_TRAINING, ADAPTATION |
| `DocumentType` | ATTENDANCE_SHEET, TRAINING_DAILY_LOG, TRAINEE_COMPREHENSIVE_EVAL, POST_EMPLOY_ADAPT_LOG, ADAPTATION_COMPREHENSIVE_EVAL, CHECKLIST |
| `PayType` | MONTHLY, DAILY, HOURLY |
| `IncomeType` | BUSINESS (사업소득 3.3%), EMPLOYMENT (근로소득 4대보험) |
| `WorkerType` | INTERNAL (소속직원), EXTERNAL (프리랜서) |
| `ContractStatus` | PENDING, SIGNED, COMPLETED, CANCELLED |
