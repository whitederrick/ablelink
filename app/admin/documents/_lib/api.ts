// app/admin/documents/_lib/api.ts
// Admin 문서 관리 관련 API 클라이언트 함수들

import type {
  AssignmentItem,
  DocumentRunItem,
  DocumentVersionItem,
  DocumentSubmissionLogItem,
  DocStage,
  DocType,
} from "./types";

async function j<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok || (data as any)?.success === false) {
    const msg = (data as any)?.message || `HTTP_${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchAssignments(q: string): Promise<AssignmentItem[]> {
  // 기존 admin assignments API 재사용
  const url = `/api/admin/assignments?q=${encodeURIComponent(q)}&page=1&pageSize=50`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await j<{ success: boolean; items: any[] }>(res);
  return (data.items || []).map((r) => ({
    id: String(r.id),
    siteId: String(r.siteId),
    siteName: r.site?.companyName ?? r.site?.name ?? null,
    workerId: String(r.workerId),
    workerName: r.user?.workerName ?? r.user?.name ?? null,
    startDate: r.startDate ?? null,
    endDate: r.endDate ?? null,
    status: r.status ?? null,
  }));
}

export async function createRun(input: {
  assignmentId: string;
  docType: DocType;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  dueAt: string; // ISO
  openAt?: string; // ISO
}): Promise<DocumentRunItem> {
  const res = await fetch(`/api/admin/document-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await j<{ success: boolean; item: DocumentRunItem }>(res);
  return data.item;
}

export async function listRuns(params: {
  assignmentId?: string;
  docType?: DocType;
  from?: string; // ISO
  to?: string; // ISO
  page?: number;
  pageSize?: number;
}): Promise<{ total: number; items: DocumentRunItem[] }> {
  const sp = new URLSearchParams();
  if (params.assignmentId) sp.set("assignmentId", params.assignmentId);
  if (params.docType) sp.set("docType", params.docType);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  sp.set("page", String(params.page ?? 1));
  sp.set("pageSize", String(params.pageSize ?? 20));

  const res = await fetch(`/api/admin/document-runs?${sp.toString()}`, { cache: "no-store" });
  const data = await j<{ success: boolean; total: number; items: DocumentRunItem[] }>(res);
  return { total: data.total ?? 0, items: data.items ?? [] };
}

export async function listVersions(runId: string): Promise<DocumentVersionItem[]> {
  const res = await fetch(`/api/admin/document-versions?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
  const data = await j<{ success: boolean; items: DocumentVersionItem[] }>(res);
  return data.items ?? [];
}

export async function createVersion(input: {
  runId: string;
  stage: DocStage;
  pdfUrl: string;
  pdfFileName?: string | null;
  sourceData?: any; // undefined/null/object 모두 허용
}): Promise<DocumentVersionItem> {
  const res = await fetch(`/api/admin/document-versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await j<{ success: boolean; item: DocumentVersionItem }>(res);
  return data.item;
}

export async function listSubmissionLogs(runId: string): Promise<DocumentSubmissionLogItem[]> {
  const res = await fetch(
    `/api/admin/document-submission-logs?runId=${encodeURIComponent(runId)}`,
    { cache: "no-store" }
  );
  const data = await j<{ success: boolean; items: DocumentSubmissionLogItem[] }>(res);
  return data.items ?? [];
}

export async function createSubmissionLog(input: {
  runId: string;
  versionId: string;
  stage: DocStage;
  sentToEmail?: string | null;
  emailStatus?: string | null;
  emailPayload?: any; // undefined/null/object
}): Promise<DocumentSubmissionLogItem> {
  const res = await fetch(`/api/admin/document-submission-logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await j<{ success: boolean; item: DocumentSubmissionLogItem }>(res);
  return data.item;
}
