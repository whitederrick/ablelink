-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING', 'SIGNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'PREMIUM', 'STARTER', 'STANDARD', 'PRO');

-- CreateEnum
CREATE TYPE "AgencyPlanType" AS ENUM ('FREE', 'TRIAL', 'STARTER', 'STANDARD', 'PRO');

-- CreateEnum
CREATE TYPE "ServiceStep" AS ENUM ('PRE_TRAINING', 'FIELD_TRAINING', 'ADAPTATION');

-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('APP_GPS', 'EXTERNAL', 'NONE');

-- CreateEnum
CREATE TYPE "WorkerRole" AS ENUM ('ADMIN', 'WORKER');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('ACTIVE', 'RESIGNED', 'PAUSED');

-- CreateEnum
CREATE TYPE "AssignStatus" AS ENUM ('ACTIVE', 'ENDED', 'ASSIGNED', 'CONFIRMED', 'REJECTED', 'DROPPED', 'REQUESTED', 'ACCEPTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TraineeStatus" AS ENUM ('TRAINING', 'EMPLOYED', 'DROPOUT', 'PAUSED');

-- CreateEnum
CREATE TYPE "TraineePlacementStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DROPOUT', 'PAUSED');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('WORKING', 'DONE', 'ABSENT');

-- CreateEnum
CREATE TYPE "SiteSourceType" AS ENUM ('KEAD', 'AGENCY', 'WORKER_ENTRY');

-- CreateEnum
CREATE TYPE "BasePointApprovalStatus" AS ENUM ('ORIGINAL_SET', 'WORKER_PROPOSED', 'APPROVED', 'REJECTED', 'CORRECTION_REQUESTED');

-- CreateEnum
CREATE TYPE "ApprovalAuthorityType" AS ENUM ('AGENCY', 'KEAD');

-- CreateEnum
CREATE TYPE "BasePointStage" AS ENUM ('AGENCY_CONFIRMED', 'WORKER_FINAL');

-- CreateEnum
CREATE TYPE "BasePointSourceType" AS ENUM ('ADDRESS', 'DEVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AttendanceEditReqStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttendanceIssueStatus" AS ENUM ('OPEN', 'REQUESTED', 'REPLIED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AttendanceIssueType" AS ENUM ('MISSING_CLOCK_IN', 'MISSING_CLOCK_OUT', 'OUT_OF_RANGE', 'TIME_ANOMALY', 'TIME_OUTLIER');

-- CreateEnum
CREATE TYPE "AttendanceIssueEventType" AS ENUM ('ISSUE_CREATED', 'REASON_REQUESTED', 'REASON_REPLIED', 'SUPPLEMENT_REQUESTED', 'RESOLVED', 'MEMO_UPDATED');

-- CreateEnum
CREATE TYPE "AttendanceIssueActorRole" AS ENUM ('MANAGER', 'WORKER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ATTENDANCE_SHEET', 'TRAINING_DAILY_LOG', 'TRAINEE_COMPREHENSIVE_EVAL', 'POST_EMPLOY_ADAPT_LOG', 'ADAPTATION_COMPREHENSIVE_EVAL', 'CHECKLIST');

-- CreateEnum
CREATE TYPE "HolidayRequestType" AS ENUM ('DELETE', 'CHANGE_WORKDAY');

-- CreateEnum
CREATE TYPE "HolidayRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'REPLIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DocumentStage" AS ENUM ('PRE', 'FINAL');

-- CreateEnum
CREATE TYPE "DocumentRunStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubmissionRequestStatus" AS ENUM ('REQUESTED', 'SUBMITTED', 'REVIEWED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('ADMIN', 'USER', 'SITE_CONTACT');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('SITE', 'ASSIGNMENT', 'ATTENDANCE', 'TRAINEE', 'SUBMISSION', 'BASEPOINT', 'PAYROLL');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('BUSINESS', 'EMPLOYMENT');

-- CreateEnum
CREATE TYPE "DeductionType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ManagerSignupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Profession" AS ENUM ('JOB_COACH', 'CAREGIVER', 'ACTIVITY_ASSISTANT');

-- CreateEnum
CREATE TYPE "ProfessionVerifyStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RecruitStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RecruitApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TalentOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "common_codes" (
    "code_group" TEXT NOT NULL,
    "code_value" TEXT NOT NULL,
    "code_name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "common_codes_pkey" PRIMARY KEY ("code_group","code_value")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" BIGSERIAL NOT NULL,
    "login_id" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "worker_name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "role" "WorkerRole" NOT NULL DEFAULT 'WORKER',
    "status" "WorkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan_type" "PlanType" NOT NULL DEFAULT 'FREE',
    "ci_key" TEXT,
    "signature_url" TEXT,
    "is_temporary" BOOLEAN NOT NULL DEFAULT false,
    "bank_name" TEXT,
    "account_number" TEXT,
    "account_holder" TEXT,
    "bank_code" TEXT,
    "account_verified_at" TIMESTAMP(3),
    "account_holder_verified" BOOLEAN,
    "account_verify_method" TEXT,
    "identity_verified_at" TIMESTAMP(3),
    "identity_method" TEXT,
    "identity_verified_by" BIGINT,
    "birth_date" TEXT,
    "pending_login_id" TEXT,
    "verify_code" TEXT,
    "verify_code_expires_at" TIMESTAMP(3),
    "consent_terms_at" TIMESTAMP(3),
    "consent_privacy_at" TIMESTAMP(3),
    "consent_location_at" TIMESTAMP(3),
    "residence_address" TEXT,
    "residence_lat" DECIMAL(65,30),
    "residence_lon" DECIMAL(65,30),
    "rating_avg" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "bio" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "open_to_offers" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" BIGSERIAL NOT NULL,
    "company_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "detail_address" TEXT,
    "gps_lat" DECIMAL(65,30) NOT NULL,
    "gps_lon" DECIMAL(65,30) NOT NULL,
    "allowance_range" INTEGER NOT NULL DEFAULT 100,
    "late_threshold_min" INTEGER,
    "is_verified" BOOLEAN NOT NULL DEFAULT true,
    "siteSourceType" "SiteSourceType" NOT NULL DEFAULT 'AGENCY',
    "place_id" TEXT,
    "normalized_address_key" TEXT,
    "merged_to_site_id" BIGINT,
    "base_point_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "base_point_source" TEXT,
    "basePointAuthority" "ApprovalAuthorityType" NOT NULL DEFAULT 'AGENCY',
    "basePointApprovalStatus" "BasePointApprovalStatus" NOT NULL DEFAULT 'ORIGINAL_SET',
    "base_point_accuracy_m" DOUBLE PRECISION,
    "base_point_updated_at" TIMESTAMP(3),
    "base_point_memo" TEXT,
    "basePointProposedLat" DECIMAL(65,30),
    "basePointProposedLon" DECIMAL(65,30),
    "basePointProposedByWorkerId" BIGINT,
    "basePointProposedAt" TIMESTAMP(3),
    "basePointDecidedAt" TIMESTAMP(3),
    "basePointDecidedById" BIGINT,
    "basePointDecisionMemo" TEXT,
    "basePointCorrectionReason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "agency_id" BIGINT,
    "owner_manager_id" BIGINT,
    "business_contact_name" TEXT,
    "business_contact_phone" TEXT,
    "business_contact_email" TEXT,
    "gov_contacts" JSONB,
    "business_type" TEXT,
    "required_profession" "Profession",
    "needed_activities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "am_capacity" INTEGER NOT NULL DEFAULT 0,
    "pm_capacity" INTEGER NOT NULL DEFAULT 0,
    "full_day_capacity" INTEGER NOT NULL DEFAULT 0,
    "current_base_point_id" BIGINT,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_contacts" (
    "id" BIGSERIAL NOT NULL,
    "site_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone_number" TEXT,
    "role" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_assignments" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "site_id" BIGINT NOT NULL,
    "service_step" "ServiceStep" NOT NULL DEFAULT 'FIELD_TRAINING',
    "attendance_mode" "AttendanceMode" NOT NULL DEFAULT 'APP_GPS',
    "status" "AssignStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3),
    "step_start" TIMESTAMP(3),
    "step_end" TIMESTAMP(3),
    "adaptation_start_date" TIMESTAMP(3),
    "work_type" TEXT,
    "commute_guidance_included" BOOLEAN NOT NULL DEFAULT true,
    "custom_work_start" TEXT,
    "custom_work_end" TEXT,
    "attendance_button_exempt" BOOLEAN NOT NULL DEFAULT false,
    "requested_work_types" TEXT,
    "reply_deadline" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "dropped_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3),
    "base_confirmed_at" TIMESTAMP(3),
    "assigned_by_manager_id" BIGINT,
    "status_reason" TEXT,
    "agency_id" BIGINT,
    "is_main_worker" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "site_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainees" (
    "id" BIGSERIAL NOT NULL,
    "current_site_id" BIGINT,
    "name" TEXT NOT NULL,
    "birth_date" TEXT,
    "gender" TEXT NOT NULL,
    "phone_number" TEXT,
    "guardianPhoneNumber" TEXT,
    "guardian_phone_number2" TEXT,
    "disability_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" "TraineeStatus" NOT NULL DEFAULT 'TRAINING',
    "leftAt" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_placements" (
    "id" BIGSERIAL NOT NULL,
    "trainee_id" BIGINT NOT NULL,
    "site_id" BIGINT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "status" "TraineePlacementStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "trainee_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_attendances" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "site_id" BIGINT NOT NULL,
    "assignment_id" BIGINT NOT NULL,
    "base_point_id" BIGINT,
    "work_date" TEXT NOT NULL,
    "start_time" TIMESTAMP(3),
    "actual_start_time" TIMESTAMP(3),
    "start_loc_lat" DECIMAL(65,30),
    "start_loc_lon" DECIMAL(65,30),
    "end_time" TIMESTAMP(3),
    "actual_end_time" TIMESTAMP(3),
    "end_loc_lat" DECIMAL(65,30),
    "end_loc_lon" DECIMAL(65,30),
    "payroll_confirmed_at" TIMESTAMP(3),
    "correction_requested_at" TIMESTAMP(3),
    "correction_request_note" TEXT,
    "clock_out_missed_at" TIMESTAMP(3),
    "late_clock_out_at" TIMESTAMP(3),
    "late_clock_out_reason_code" TEXT,
    "late_clock_out_reason" TEXT,
    "start_distance_m" DOUBLE PRECISION,
    "end_distance_m" DOUBLE PRECISION,
    "within_range" BOOLEAN,
    "range_m" INTEGER,
    "is_gps_modified" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkStatus" NOT NULL DEFAULT 'WORKING',
    "is_final_closed" BOOLEAN NOT NULL DEFAULT false,
    "finalized_at" TIMESTAMP(6),
    "is_manager_final_closed" BOOLEAN NOT NULL DEFAULT false,
    "manager_final_at" TIMESTAMP(3),
    "manager_final_by" BIGINT,

    CONSTRAINT "daily_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_logs" (
    "id" BIGSERIAL NOT NULL,
    "attendance_id" BIGINT NOT NULL,
    "trainee_id" BIGINT NOT NULL,
    "writer_id" BIGINT NOT NULL,
    "training_type" TEXT NOT NULL,
    "time_1on1" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "time_group" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "content" TEXT,
    "evaluation" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "ext_time_1on1" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ext_time_group" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total_recognized_time" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "trainee_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_log_tasks" (
    "id" BIGSERIAL NOT NULL,
    "log_id" BIGINT NOT NULL,
    "task_name" TEXT NOT NULL,
    "performance_score" INTEGER NOT NULL,
    "difficulty" TEXT,
    "feedback" TEXT,

    CONSTRAINT "trainee_log_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone_number" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_number" TEXT,
    "representative_name" TEXT,
    "representative_signature_url" TEXT,
    "gov_contact_email" TEXT,
    "gov_contact_name" TEXT,
    "gov_contacts" JSONB,
    "payroll_auto_day" INTEGER,
    "late_threshold_min" INTEGER NOT NULL DEFAULT 30,
    "default_contract_template" TEXT,
    "allowed_contract_templates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plan_type" "AgencyPlanType" NOT NULL DEFAULT 'FREE',
    "max_workers" INTEGER NOT NULL DEFAULT 0,
    "max_sites" INTEGER NOT NULL DEFAULT 0,
    "trial_started_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "toss_customer_key" TEXT,
    "toss_billing_key" TEXT,
    "subscription_id" TEXT,
    "next_billing_at" TIMESTAMP(3),
    "subscribed_at" TIMESTAMP(3),
    "subscription_canceled_at" TIMESTAMP(3),
    "billing_cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "custom_amount" INTEGER,
    "billing_note" TEXT,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" BIGSERIAL NOT NULL,
    "login_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "managers" (
    "id" BIGSERIAL NOT NULL,
    "login_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "agency_id" BIGINT NOT NULL,
    "signature_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_runs" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "assignment_id" BIGINT NOT NULL,
    "site_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "trainee_id" BIGINT,
    "doc_type" "DocumentType" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "open_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "DocumentRunStatus" NOT NULL DEFAULT 'OPEN',
    "current_version_id" BIGINT,
    "worker_signed_at" TIMESTAMP(3),
    "manager_signature_url" TEXT,
    "manager_signed_at" TIMESTAMP(3),
    "manager_signer_name" TEXT,
    "agency_signature_url" TEXT,
    "agency_signed_at" TIMESTAMP(3),
    "requires_manager_sign" BOOLEAN NOT NULL DEFAULT false,
    "sign_stage" TEXT NOT NULL DEFAULT 'DRAFT',
    "gov_status" TEXT NOT NULL DEFAULT 'NONE',
    "gov_submitted_at" TIMESTAMP(3),
    "gov_submit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "stage" "DocumentStage" NOT NULL,
    "pdf_url" TEXT NOT NULL,
    "pdf_file_name" TEXT,
    "source_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_worker_id" BIGINT,
    "created_by_manager_id" BIGINT,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_submission_logs" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "version_id" BIGINT NOT NULL,
    "stage" "DocumentStage" NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by_worker_id" BIGINT,
    "submitted_by_manager_id" BIGINT,
    "sent_to_email" TEXT,
    "email_sent_at" TIMESTAMP(3),
    "email_status" TEXT,
    "email_payload" JSONB,

    CONSTRAINT "document_submission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_base_points" (
    "id" BIGSERIAL NOT NULL,
    "site_id" BIGINT NOT NULL,
    "lat" DECIMAL(65,30) NOT NULL,
    "lon" DECIMAL(65,30) NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "source_type" "BasePointSourceType" NOT NULL,
    "stage" "BasePointStage" NOT NULL,
    "authority" "ApprovalAuthorityType" NOT NULL,
    "confirmed_by_worker_id" BIGINT,
    "confirmed_by_manager_id" BIGINT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memo" TEXT,
    "correction_reason" TEXT,
    "prev_base_point_id" BIGINT,

    CONSTRAINT "site_base_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_requests" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "assignment_id" BIGINT NOT NULL,
    "requested_by_manager_id" BIGINT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "status" "SubmissionRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "memo" TEXT,

    CONSTRAINT "submission_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" BIGSERIAL NOT NULL,
    "request_id" BIGINT NOT NULL,
    "submitted_by_worker_id" BIGINT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_url" TEXT,
    "file_name" TEXT,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_holidays" (
    "id" BIGSERIAL NOT NULL,
    "assignment_id" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "count_as_workday" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_sign_tokens" (
    "id" BIGSERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "assignment_id" BIGINT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "sign_role" TEXT NOT NULL,
    "signer_name" TEXT,
    "signature_url" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_sign_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_contracts" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "assignment_id" BIGINT,
    "contract_start" TIMESTAMP(3) NOT NULL,
    "contract_end" TIMESTAMP(3) NOT NULL,
    "site_name" TEXT,
    "work_type" TEXT,
    "commute_guidance_included" BOOLEAN NOT NULL DEFAULT true,
    "custom_work_start" TEXT,
    "custom_work_end" TEXT,
    "sign_token" TEXT NOT NULL,
    "token_sent_at" TIMESTAMP(3),
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'PENDING',
    "worker_signed_at" TIMESTAMP(3),
    "worker_signature_url" TEXT,
    "admin_signed_at" TIMESTAMP(3),
    "admin_signature_url" TEXT,
    "worker_filled_site_name" TEXT,
    "worker_filled_work_type" TEXT,
    "pdf_url" TEXT,
    "admin_memo" TEXT,
    "work_location" TEXT,
    "job_description" TEXT,
    "work_start_time" TEXT,
    "work_end_time" TEXT,
    "break_start_time" TEXT,
    "break_end_time" TEXT,
    "work_days_per_week" INTEGER,
    "weekly_holiday" TEXT,
    "wage_type" TEXT,
    "wage_amount" INTEGER,
    "bonus_exists" BOOLEAN NOT NULL DEFAULT false,
    "bonus_amount" INTEGER,
    "extra_pay_exists" BOOLEAN NOT NULL DEFAULT false,
    "extra_pay_desc" TEXT,
    "overtime_rate" INTEGER,
    "wage_payday" TEXT,
    "wage_pay_method" TEXT,
    "employer_biz_name" TEXT,
    "employer_phone" TEXT,
    "employer_address" TEXT,
    "employer_rep_name" TEXT,
    "worker_address" TEXT,
    "worker_filled_address" TEXT,
    "special_clauses" JSONB,
    "template_key" TEXT NOT NULL DEFAULT 'STANDARD',
    "template_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_manager_id" BIGINT,

    CONSTRAINT "employment_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_contract_clauses" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_contract_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satisfaction_surveys" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "assignment_id" BIGINT,
    "contract_id" BIGINT,
    "recipient_name" TEXT,
    "recipient_phone" TEXT NOT NULL,
    "site_name" TEXT,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "scores" JSONB,
    "overall_score" INTEGER,
    "comment" TEXT,
    "shared_with_agency" BOOLEAN NOT NULL DEFAULT false,
    "form_id" BIGINT,
    "form_snapshot" JSONB,
    "category_scores" JSONB,
    "total_score" INTEGER,
    "sent_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_manager_id" BIGINT,

    CONSTRAINT "satisfaction_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" BIGINT,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_contracts" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "worker_type" "WorkerType" NOT NULL DEFAULT 'EXTERNAL',
    "pay_type" "PayType" NOT NULL,
    "base_amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "income_type" "IncomeType" NOT NULL DEFAULT 'BUSINESS',
    "hourly_rate_2plus" DECIMAL(65,30),
    "weekly_holiday_pay" DECIMAL(65,30),
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "year_month" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "gross_pay" DECIMAL(65,30) NOT NULL,
    "total_deduction" DECIMAL(65,30) NOT NULL,
    "net_pay" DECIMAL(65,30) NOT NULL,
    "worked_days" INTEGER,
    "worked_minutes" INTEGER,
    "breakdown" JSONB,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_deductions" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeductionType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_rates" (
    "id" BIGSERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "national_pension" DECIMAL(65,30) NOT NULL,
    "health_insurance" DECIMAL(65,30) NOT NULL,
    "long_term_care" DECIMAL(65,30) NOT NULL,
    "employment_insurance" DECIMAL(65,30) NOT NULL,
    "industrial_accident" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "insurance_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_tax_tables" (
    "id" BIGSERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "meta" JSONB,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_tax_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "attendance_issues" (
    "id" BIGSERIAL NOT NULL,
    "daily_attendance_id" BIGINT NOT NULL,
    "status" "AttendanceIssueStatus" NOT NULL DEFAULT 'OPEN',
    "issueTypes" "AttendanceIssueType"[] DEFAULT ARRAY[]::"AttendanceIssueType"[],
    "worker_reason_text" TEXT,
    "admin_memo" TEXT,
    "requested_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_issue_events" (
    "id" BIGSERIAL NOT NULL,
    "issue_id" BIGINT NOT NULL,
    "type" "AttendanceIssueEventType" NOT NULL,
    "actor_role" "AttendanceIssueActorRole" NOT NULL,
    "actor_worker_id" BIGINT,
    "actor_manager_id" BIGINT,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_issue_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "api_call_logs" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "worker_id" BIGINT,
    "service" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_announcements" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "audience" TEXT NOT NULL DEFAULT 'MANAGERS',
    "admin_id" BIGINT,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_announcement_reads" (
    "id" BIGSERIAL NOT NULL,
    "announcement_id" BIGINT NOT NULL,
    "manager_id" BIGINT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_announcements" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "category_id" BIGINT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_manager_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_categories" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'sky',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "admin_id" BIGINT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_edit_requests" (
    "id" BIGSERIAL NOT NULL,
    "attendance_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "proposed_start" TEXT,
    "proposed_end" TEXT,
    "status" "AttendanceEditReqStatus" NOT NULL DEFAULT 'PENDING',
    "admin_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_edit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_holiday_requests" (
    "id" BIGSERIAL NOT NULL,
    "holiday_id" BIGINT NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "request_type" "HolidayRequestType" NOT NULL,
    "proposed_count_as_workday" BOOLEAN,
    "reason" TEXT,
    "status" "HolidayRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "manager_id" BIGINT,

    CONSTRAINT "site_holiday_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "manager_id" BIGINT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "reply" TEXT,
    "replied_by" BIGINT,
    "replied_at" TIMESTAMP(3),
    "attachments" JSONB,
    "reply_attachments" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_notification_settings" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "clock_in_alert_minutes" INTEGER NOT NULL DEFAULT 3,
    "clock_out_alert_minutes" INTEGER NOT NULL DEFAULT 3,
    "push_subscription" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_evaluations" (
    "id" BIGSERIAL NOT NULL,
    "trainee_id" BIGINT NOT NULL,
    "writer_id" BIGINT NOT NULL,
    "eval_type" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "comments" JSONB NOT NULL DEFAULT '{}',
    "is_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainee_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_verifications" (
    "id" BIGSERIAL NOT NULL,
    "phone_number" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_invites" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "site_id" BIGINT,
    "phone_number" TEXT NOT NULL,
    "worker_name" TEXT,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by_worker_id" BIGINT,
    "existing_worker_id" BIGINT,
    "assignment_id" BIGINT,
    "purpose" TEXT NOT NULL DEFAULT 'NEW_ACCOUNT',
    "created_by_manager_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_signup_requests" (
    "id" BIGSERIAL NOT NULL,
    "agency_name" TEXT NOT NULL,
    "business_number" TEXT NOT NULL,
    "business_number_type" TEXT NOT NULL DEFAULT 'BUSINESS',
    "document_url" TEXT,
    "login_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "phone_number" TEXT,
    "status" "ManagerSignupStatus" NOT NULL DEFAULT 'PENDING',
    "nts_verified" BOOLEAN NOT NULL DEFAULT false,
    "nts_business_name" TEXT,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" BIGINT,
    "agency_id" BIGINT,
    "manager_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_signup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_invites" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "manager_id" BIGINT,
    "created_by_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_notices" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "kind" TEXT NOT NULL DEFAULT 'NOTICE_INDIVIDUAL',
    "year_month" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_notices" (
    "id" BIGSERIAL NOT NULL,
    "manager_id" BIGINT NOT NULL,
    "ticket_id" BIGINT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_professions" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "profession" "Profession" NOT NULL,
    "cert_number" TEXT,
    "certified_at" TIMESTAMP(3),
    "experience_years" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "cert_doc_url" TEXT,
    "verify_status" "ProfessionVerifyStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "verified_by_admin_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_professions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_experiences" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "profession" "Profession",
    "org_name" TEXT NOT NULL,
    "title" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_reviews" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "agency_id" BIGINT,
    "manager_id" BIGINT,
    "created_by_admin_id" BIGINT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruit_posts" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "profession" "Profession" NOT NULL DEFAULT 'JOB_COACH',
    "task_name" TEXT,
    "address" TEXT NOT NULL,
    "detail_address" TEXT,
    "lat" DECIMAL(65,30),
    "lon" DECIMAL(65,30),
    "region" TEXT,
    "work_hours" TEXT,
    "work_days" TEXT,
    "pay_info" TEXT,
    "service_start" TIMESTAMP(3),
    "service_end" TIMESTAMP(3),
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "status" "RecruitStatus" NOT NULL DEFAULT 'OPEN',
    "agency_id" BIGINT,
    "created_by_manager_id" BIGINT,
    "created_by_admin_id" BIGINT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "site_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruit_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruit_applications" (
    "id" BIGSERIAL NOT NULL,
    "recruit_post_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "message" TEXT,
    "status" "RecruitApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talent_offers" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "agency_id" BIGINT,
    "created_by_manager_id" BIGINT,
    "created_by_admin_id" BIGINT,
    "profession" "Profession",
    "site_name" TEXT,
    "site_id" BIGINT,
    "message" TEXT,
    "service_start" TIMESTAMP(3),
    "service_end" TIMESTAMP(3),
    "status" "TalentOfferStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "talent_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobcoach_eval_forms" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "include_opinion" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobcoach_eval_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobcoach_eval_categories" (
    "id" BIGSERIAL NOT NULL,
    "form_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "jobcoach_eval_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobcoach_eval_questions" (
    "id" BIGSERIAL NOT NULL,
    "category_id" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "max_score" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "jobcoach_eval_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workers_login_id_key" ON "workers"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "workers_ci_key_key" ON "workers"("ci_key");

-- CreateIndex
CREATE INDEX "workers_open_to_offers_status_idx" ON "workers"("open_to_offers", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sites_place_id_key" ON "sites"("place_id");

-- CreateIndex
CREATE INDEX "sites_agency_id_is_active_idx" ON "sites"("agency_id", "is_active");

-- CreateIndex
CREATE INDEX "sites_siteSourceType_is_verified_idx" ON "sites"("siteSourceType", "is_verified");

-- CreateIndex
CREATE INDEX "sites_normalized_address_key_idx" ON "sites"("normalized_address_key");

-- CreateIndex
CREATE INDEX "site_contacts_site_id_is_active_idx" ON "site_contacts"("site_id", "is_active");

-- CreateIndex
CREATE INDEX "site_assignments_worker_id_status_idx" ON "site_assignments"("worker_id", "status");

-- CreateIndex
CREATE INDEX "site_assignments_site_id_status_idx" ON "site_assignments"("site_id", "status");

-- CreateIndex
CREATE INDEX "site_assignments_agency_id_status_idx" ON "site_assignments"("agency_id", "status");

-- CreateIndex
CREATE INDEX "site_assignments_service_step_attendance_mode_idx" ON "site_assignments"("service_step", "attendance_mode");

-- CreateIndex
CREATE INDEX "trainee_placements_site_id_status_idx" ON "trainee_placements"("site_id", "status");

-- CreateIndex
CREATE INDEX "trainee_placements_trainee_id_status_idx" ON "trainee_placements"("trainee_id", "status");

-- CreateIndex
CREATE INDEX "daily_attendances_worker_id_work_date_idx" ON "daily_attendances"("worker_id", "work_date");

-- CreateIndex
CREATE INDEX "daily_attendances_site_id_work_date_idx" ON "daily_attendances"("site_id", "work_date");

-- CreateIndex
CREATE INDEX "daily_attendances_base_point_id_idx" ON "daily_attendances"("base_point_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_attendances_assignment_id_work_date_key" ON "daily_attendances"("assignment_id", "work_date");

-- CreateIndex
CREATE INDEX "trainee_logs_trainee_id_idx" ON "trainee_logs"("trainee_id");

-- CreateIndex
CREATE INDEX "trainee_logs_writer_id_idx" ON "trainee_logs"("writer_id");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_name_key" ON "agencies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_business_number_key" ON "agencies"("business_number");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_toss_customer_key_key" ON "agencies"("toss_customer_key");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_subscription_id_key" ON "agencies"("subscription_id");

-- CreateIndex
CREATE INDEX "agencies_plan_type_idx" ON "agencies"("plan_type");

-- CreateIndex
CREATE UNIQUE INDEX "admins_login_id_key" ON "admins"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "managers_login_id_key" ON "managers"("login_id");

-- CreateIndex
CREATE INDEX "managers_agency_id_idx" ON "managers"("agency_id");

-- CreateIndex
CREATE INDEX "document_runs_agency_id_doc_type_period_start_idx" ON "document_runs"("agency_id", "doc_type", "period_start");

-- CreateIndex
CREATE INDEX "document_runs_assignment_id_doc_type_idx" ON "document_runs"("assignment_id", "doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "document_runs_assignment_id_doc_type_period_start_trainee_i_key" ON "document_runs"("assignment_id", "doc_type", "period_start", "trainee_id");

-- CreateIndex
CREATE INDEX "document_versions_run_id_stage_created_at_idx" ON "document_versions"("run_id", "stage", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_run_id_version_no_key" ON "document_versions"("run_id", "version_no");

-- CreateIndex
CREATE INDEX "document_submission_logs_run_id_stage_submitted_at_idx" ON "document_submission_logs"("run_id", "stage", "submitted_at");

-- CreateIndex
CREATE INDEX "document_submission_logs_version_id_idx" ON "document_submission_logs"("version_id");

-- CreateIndex
CREATE INDEX "site_base_points_site_id_stage_idx" ON "site_base_points"("site_id", "stage");

-- CreateIndex
CREATE INDEX "site_base_points_confirmed_by_worker_id_idx" ON "site_base_points"("confirmed_by_worker_id");

-- CreateIndex
CREATE INDEX "site_base_points_confirmed_by_manager_id_idx" ON "site_base_points"("confirmed_by_manager_id");

-- CreateIndex
CREATE INDEX "submission_requests_assignment_id_status_idx" ON "submission_requests"("assignment_id", "status");

-- CreateIndex
CREATE INDEX "submission_requests_agency_id_status_idx" ON "submission_requests"("agency_id", "status");

-- CreateIndex
CREATE INDEX "submissions_request_id_submitted_at_idx" ON "submissions"("request_id", "submitted_at");

-- CreateIndex
CREATE INDEX "submissions_submitted_by_worker_id_submitted_at_idx" ON "submissions"("submitted_by_worker_id", "submitted_at");

-- CreateIndex
CREATE INDEX "site_holidays_assignment_id_idx" ON "site_holidays"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_holidays_assignment_id_date_key" ON "site_holidays"("assignment_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "site_sign_tokens_token_key" ON "site_sign_tokens"("token");

-- CreateIndex
CREATE INDEX "site_sign_tokens_token_idx" ON "site_sign_tokens"("token");

-- CreateIndex
CREATE INDEX "site_sign_tokens_assignment_id_idx" ON "site_sign_tokens"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "employment_contracts_sign_token_key" ON "employment_contracts"("sign_token");

-- CreateIndex
CREATE INDEX "employment_contracts_agency_id_status_idx" ON "employment_contracts"("agency_id", "status");

-- CreateIndex
CREATE INDEX "employment_contracts_worker_id_status_idx" ON "employment_contracts"("worker_id", "status");

-- CreateIndex
CREATE INDEX "employment_contracts_sign_token_idx" ON "employment_contracts"("sign_token");

-- CreateIndex
CREATE INDEX "agency_contract_clauses_agency_id_is_active_idx" ON "agency_contract_clauses"("agency_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "satisfaction_surveys_token_key" ON "satisfaction_surveys"("token");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_agency_id_status_idx" ON "satisfaction_surveys"("agency_id", "status");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_worker_id_idx" ON "satisfaction_surveys"("worker_id");

-- CreateIndex
CREATE INDEX "satisfaction_surveys_token_idx" ON "satisfaction_surveys"("token");

-- CreateIndex
CREATE INDEX "audit_events_agency_id_entity_type_entity_id_idx" ON "audit_events"("agency_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_type_actor_id_idx" ON "audit_events"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "pay_contracts_agency_id_worker_id_effective_from_idx" ON "pay_contracts"("agency_id", "worker_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_agency_id_year_month_key" ON "payroll_runs"("agency_id", "year_month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_run_id_worker_id_key" ON "payroll_items"("run_id", "worker_id");

-- CreateIndex
CREATE INDEX "agency_deductions_agency_id_is_active_idx" ON "agency_deductions"("agency_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_rates_year_key" ON "insurance_rates"("year");

-- CreateIndex
CREATE UNIQUE INDEX "income_tax_tables_year_key" ON "income_tax_tables"("year");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_issues_daily_attendance_id_key" ON "attendance_issues"("daily_attendance_id");

-- CreateIndex
CREATE INDEX "attendance_issues_status_updated_at_idx" ON "attendance_issues"("status", "updated_at");

-- CreateIndex
CREATE INDEX "attendance_issue_events_issue_id_created_at_idx" ON "attendance_issue_events"("issue_id", "created_at");

-- CreateIndex
CREATE INDEX "attendance_issue_events_actor_worker_id_created_at_idx" ON "attendance_issue_events"("actor_worker_id", "created_at");

-- CreateIndex
CREATE INDEX "attendance_issue_events_actor_manager_id_created_at_idx" ON "attendance_issue_events"("actor_manager_id", "created_at");

-- CreateIndex
CREATE INDEX "api_call_logs_agency_id_service_created_at_idx" ON "api_call_logs"("agency_id", "service", "created_at");

-- CreateIndex
CREATE INDEX "api_call_logs_created_at_idx" ON "api_call_logs"("created_at");

-- CreateIndex
CREATE INDEX "system_announcements_created_at_idx" ON "system_announcements"("created_at");

-- CreateIndex
CREATE INDEX "system_announcement_reads_manager_id_idx" ON "system_announcement_reads"("manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_announcement_reads_announcement_id_manager_id_key" ON "system_announcement_reads"("announcement_id", "manager_id");

-- CreateIndex
CREATE INDEX "agency_announcements_agency_id_pinned_created_at_idx" ON "agency_announcements"("agency_id", "pinned", "created_at");

-- CreateIndex
CREATE INDEX "announcement_categories_is_active_sort_order_idx" ON "announcement_categories"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "system_audit_logs_admin_id_created_at_idx" ON "system_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "system_audit_logs_created_at_idx" ON "system_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "attendance_edit_requests_attendance_id_status_idx" ON "attendance_edit_requests"("attendance_id", "status");

-- CreateIndex
CREATE INDEX "attendance_edit_requests_worker_id_status_idx" ON "attendance_edit_requests"("worker_id", "status");

-- CreateIndex
CREATE INDEX "site_holiday_requests_holiday_id_status_idx" ON "site_holiday_requests"("holiday_id", "status");

-- CreateIndex
CREATE INDEX "site_holiday_requests_agency_id_status_idx" ON "site_holiday_requests"("agency_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_agency_id_status_idx" ON "support_tickets"("agency_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "worker_notification_settings_worker_id_key" ON "worker_notification_settings"("worker_id");

-- CreateIndex
CREATE INDEX "trainee_evaluations_trainee_id_eval_type_idx" ON "trainee_evaluations"("trainee_id", "eval_type");

-- CreateIndex
CREATE INDEX "phone_verifications_phone_number_idx" ON "phone_verifications"("phone_number");

-- CreateIndex
CREATE INDEX "worker_invites_code_idx" ON "worker_invites"("code");

-- CreateIndex
CREATE INDEX "worker_invites_agency_id_idx" ON "worker_invites"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "manager_signup_requests_login_id_key" ON "manager_signup_requests"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "manager_signup_requests_manager_id_key" ON "manager_signup_requests"("manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "manager_invites_code_key" ON "manager_invites"("code");

-- CreateIndex
CREATE UNIQUE INDEX "manager_invites_manager_id_key" ON "manager_invites"("manager_id");

-- CreateIndex
CREATE INDEX "manager_invites_agency_id_idx" ON "manager_invites"("agency_id");

-- CreateIndex
CREATE INDEX "worker_notices_worker_id_read_at_idx" ON "worker_notices"("worker_id", "read_at");

-- CreateIndex
CREATE INDEX "worker_notices_agency_id_idx" ON "worker_notices"("agency_id");

-- CreateIndex
CREATE INDEX "manager_notices_manager_id_read_at_idx" ON "manager_notices"("manager_id", "read_at");

-- CreateIndex
CREATE INDEX "worker_professions_profession_is_active_idx" ON "worker_professions"("profession", "is_active");

-- CreateIndex
CREATE INDEX "worker_professions_verify_status_idx" ON "worker_professions"("verify_status");

-- CreateIndex
CREATE UNIQUE INDEX "worker_professions_worker_id_profession_key" ON "worker_professions"("worker_id", "profession");

-- CreateIndex
CREATE INDEX "worker_experiences_worker_id_idx" ON "worker_experiences"("worker_id");

-- CreateIndex
CREATE INDEX "worker_reviews_worker_id_idx" ON "worker_reviews"("worker_id");

-- CreateIndex
CREATE INDEX "worker_reviews_agency_id_idx" ON "worker_reviews"("agency_id");

-- CreateIndex
CREATE INDEX "recruit_posts_status_profession_idx" ON "recruit_posts"("status", "profession");

-- CreateIndex
CREATE INDEX "recruit_posts_agency_id_idx" ON "recruit_posts"("agency_id");

-- CreateIndex
CREATE INDEX "recruit_posts_created_by_manager_id_idx" ON "recruit_posts"("created_by_manager_id");

-- CreateIndex
CREATE INDEX "recruit_applications_worker_id_status_idx" ON "recruit_applications"("worker_id", "status");

-- CreateIndex
CREATE INDEX "recruit_applications_recruit_post_id_status_idx" ON "recruit_applications"("recruit_post_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recruit_applications_recruit_post_id_worker_id_key" ON "recruit_applications"("recruit_post_id", "worker_id");

-- CreateIndex
CREATE INDEX "talent_offers_worker_id_status_idx" ON "talent_offers"("worker_id", "status");

-- CreateIndex
CREATE INDEX "talent_offers_agency_id_status_idx" ON "talent_offers"("agency_id", "status");

-- CreateIndex
CREATE INDEX "talent_offers_created_by_manager_id_idx" ON "talent_offers"("created_by_manager_id");

-- CreateIndex
CREATE INDEX "jobcoach_eval_forms_is_active_idx" ON "jobcoach_eval_forms"("is_active");

-- CreateIndex
CREATE INDEX "jobcoach_eval_categories_form_id_sort_order_idx" ON "jobcoach_eval_categories"("form_id", "sort_order");

-- CreateIndex
CREATE INDEX "jobcoach_eval_questions_category_id_sort_order_idx" ON "jobcoach_eval_questions"("category_id", "sort_order");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_merged_to_site_id_fkey" FOREIGN KEY ("merged_to_site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_owner_manager_id_fkey" FOREIGN KEY ("owner_manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_current_base_point_id_fkey" FOREIGN KEY ("current_base_point_id") REFERENCES "site_base_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_contacts" ADD CONSTRAINT "site_contacts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_assigned_by_manager_id_fkey" FOREIGN KEY ("assigned_by_manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainees" ADD CONSTRAINT "trainees_current_site_id_fkey" FOREIGN KEY ("current_site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_placements" ADD CONSTRAINT "trainee_placements_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_placements" ADD CONSTRAINT "trainee_placements_trainee_id_fkey" FOREIGN KEY ("trainee_id") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_base_point_id_fkey" FOREIGN KEY ("base_point_id") REFERENCES "site_base_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_logs" ADD CONSTRAINT "trainee_logs_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "daily_attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_logs" ADD CONSTRAINT "trainee_logs_trainee_id_fkey" FOREIGN KEY ("trainee_id") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_logs" ADD CONSTRAINT "trainee_logs_writer_id_fkey" FOREIGN KEY ("writer_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_log_tasks" ADD CONSTRAINT "trainee_log_tasks_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "trainee_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "managers" ADD CONSTRAINT "managers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_runs" ADD CONSTRAINT "document_runs_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_runs" ADD CONSTRAINT "document_runs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_runs" ADD CONSTRAINT "document_runs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_runs" ADD CONSTRAINT "document_runs_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "document_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_worker_id_fkey" FOREIGN KEY ("created_by_worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_manager_id_fkey" FOREIGN KEY ("created_by_manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_logs" ADD CONSTRAINT "document_submission_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "document_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_logs" ADD CONSTRAINT "document_submission_logs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_logs" ADD CONSTRAINT "document_submission_logs_submitted_by_worker_id_fkey" FOREIGN KEY ("submitted_by_worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_logs" ADD CONSTRAINT "document_submission_logs_submitted_by_manager_id_fkey" FOREIGN KEY ("submitted_by_manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_base_points" ADD CONSTRAINT "site_base_points_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_base_points" ADD CONSTRAINT "site_base_points_confirmed_by_worker_id_fkey" FOREIGN KEY ("confirmed_by_worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_base_points" ADD CONSTRAINT "site_base_points_confirmed_by_manager_id_fkey" FOREIGN KEY ("confirmed_by_manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_base_points" ADD CONSTRAINT "site_base_points_prev_base_point_id_fkey" FOREIGN KEY ("prev_base_point_id") REFERENCES "site_base_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_requests" ADD CONSTRAINT "submission_requests_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_requests" ADD CONSTRAINT "submission_requests_requested_by_manager_id_fkey" FOREIGN KEY ("requested_by_manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "submission_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_worker_id_fkey" FOREIGN KEY ("submitted_by_worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_holidays" ADD CONSTRAINT "site_holidays_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_sign_tokens" ADD CONSTRAINT "site_sign_tokens_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_contract_clauses" ADD CONSTRAINT "agency_contract_clauses_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_contracts" ADD CONSTRAINT "pay_contracts_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_contracts" ADD CONSTRAINT "pay_contracts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_deductions" ADD CONSTRAINT "agency_deductions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_issues" ADD CONSTRAINT "attendance_issues_daily_attendance_id_fkey" FOREIGN KEY ("daily_attendance_id") REFERENCES "daily_attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_issue_events" ADD CONSTRAINT "attendance_issue_events_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "attendance_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_issue_events" ADD CONSTRAINT "attendance_issue_events_actor_worker_id_fkey" FOREIGN KEY ("actor_worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_issue_events" ADD CONSTRAINT "attendance_issue_events_actor_manager_id_fkey" FOREIGN KEY ("actor_manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_call_logs" ADD CONSTRAINT "api_call_logs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_call_logs" ADD CONSTRAINT "api_call_logs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_announcements" ADD CONSTRAINT "system_announcements_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_announcements" ADD CONSTRAINT "agency_announcements_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "announcement_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_audit_logs" ADD CONSTRAINT "system_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_edit_requests" ADD CONSTRAINT "attendance_edit_requests_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "daily_attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_edit_requests" ADD CONSTRAINT "attendance_edit_requests_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_holiday_requests" ADD CONSTRAINT "site_holiday_requests_holiday_id_fkey" FOREIGN KEY ("holiday_id") REFERENCES "site_holidays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_holiday_requests" ADD CONSTRAINT "site_holiday_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_holiday_requests" ADD CONSTRAINT "site_holiday_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_replied_by_fkey" FOREIGN KEY ("replied_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_notification_settings" ADD CONSTRAINT "worker_notification_settings_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_evaluations" ADD CONSTRAINT "trainee_evaluations_trainee_id_fkey" FOREIGN KEY ("trainee_id") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_evaluations" ADD CONSTRAINT "trainee_evaluations_writer_id_fkey" FOREIGN KEY ("writer_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_created_by_manager_id_fkey" FOREIGN KEY ("created_by_manager_id") REFERENCES "managers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_signup_requests" ADD CONSTRAINT "manager_signup_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_signup_requests" ADD CONSTRAINT "manager_signup_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_signup_requests" ADD CONSTRAINT "manager_signup_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_invites" ADD CONSTRAINT "manager_invites_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_invites" ADD CONSTRAINT "manager_invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_invites" ADD CONSTRAINT "manager_invites_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_notices" ADD CONSTRAINT "worker_notices_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_notices" ADD CONSTRAINT "manager_notices_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_notices" ADD CONSTRAINT "manager_notices_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_professions" ADD CONSTRAINT "worker_professions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_experiences" ADD CONSTRAINT "worker_experiences_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_reviews" ADD CONSTRAINT "worker_reviews_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_reviews" ADD CONSTRAINT "worker_reviews_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_reviews" ADD CONSTRAINT "worker_reviews_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruit_posts" ADD CONSTRAINT "recruit_posts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruit_posts" ADD CONSTRAINT "recruit_posts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruit_applications" ADD CONSTRAINT "recruit_applications_recruit_post_id_fkey" FOREIGN KEY ("recruit_post_id") REFERENCES "recruit_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruit_applications" ADD CONSTRAINT "recruit_applications_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_offers" ADD CONSTRAINT "talent_offers_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_offers" ADD CONSTRAINT "talent_offers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_offers" ADD CONSTRAINT "talent_offers_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobcoach_eval_categories" ADD CONSTRAINT "jobcoach_eval_categories_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "jobcoach_eval_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobcoach_eval_questions" ADD CONSTRAINT "jobcoach_eval_questions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "jobcoach_eval_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

