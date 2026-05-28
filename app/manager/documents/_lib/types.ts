// app/admin/documents/_lib/types.ts
// Admin 문서 관리 관련 타입들

export type DocType = "TRAINING_DAILY_LOG" | string;
export type DocStage = "PRE" | "FINAL" | string;

export type DocumentRunItem = {
  id: string;
  assignmentId: string;
  siteId: string;
  coachUserId: string;

  docType: DocType;

  periodStart: string; // ISO
  periodEnd: string; // ISO
  openAt: string; // ISO
  dueAt: string; // ISO
  status: string;

  currentVersionId: string | null;

  site?: { id: string; companyName: string; agencyId: string | null } | null;
  coach?: { id: string; userName: string; loginId: string } | null;
};

export type DocumentVersionItem = {
  id: string;
  runId: string;
  versionNo: number;
  stage: DocStage;
  pdfUrl: string;
  pdfFileName: string | null;
  sourceData: any | null;
  createdAt: string;
};

export type DocumentSubmissionLogItem = {
  id: string;
  runId: string;
  versionId: string;
  stage: DocStage;
  submittedAt: string;
  submittedByUserId: string | null;
  submittedByAdminId: string | null;
  sentToEmail: string | null;
  emailSentAt: string | null;
  emailStatus: string | null;
  emailPayload: any | null;
};

export type AssignmentItem = {
  id: string;
  siteId: string;
  siteName?: string | null;

  userId: string;
  userName?: string | null;

  startDate?: string | null;
  endDate?: string | null;

  status?: string | null;
};
