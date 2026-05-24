"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AssignmentItem, DocStage, DocType, DocumentRunItem,
  DocumentVersionItem, DocumentSubmissionLogItem,
} from "./_lib/types";
import {
  fetchAssignments, createRun, listRuns, listVersions,
  createVersion, listSubmissionLogs, createSubmissionLog,
} from "./_lib/api";
import { T } from "../_styles";

function toDateInputValue(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toIsoKstDayStart(dateStr: string) { return `${dateStr}T00:00:00.000+09:00`; }
function toIsoKstDayEnd(dateStr: string)   { return `${dateStr}T23:59:59.999+09:00`; }

const DOC_TYPE_LABEL: Record<string, string> = {
  TRAINING_DAILY_LOG: "지원고용 훈련일지",
  ATTENDANCE_SHEET: "직무지도원 출근부",
  TRAINEE_COMPREHENSIVE_EVAL: "훈련생 종합평가",
  POST_EMPLOY_ADAPT_LOG: "적응지도 일지",
  ADAPTATION_COMPREHENSIVE_EVAL: "적응지도 종합평가",
  CHECKLIST: "체크리스트",
};

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <span className="text-sm font-black text-slate-900">{title}</span>
      {children}
    </div>
  );
}

export default function AdminDocumentsPage() {
  const [assignQuery, setAssignQuery] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");

  const [docType, setDocType] = useState<DocType>("TRAINING_DAILY_LOG");

  const today = useMemo(() => new Date(), []);
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const monthEnd = useMemo(() => new Date(today.getFullYear(), today.getMonth() + 1, 0), [today]);

  const [periodStartDate, setPeriodStartDate] = useState(toDateInputValue(monthStart));
  const [periodEndDate, setPeriodEndDate] = useState(toDateInputValue(monthEnd));
  const [dueAtDate, setDueAtDate] = useState(toDateInputValue(monthEnd));

  const [runLoading, setRunLoading] = useState(false);
  const [runs, setRuns] = useState<DocumentRunItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");

  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);

  const [logsLoading, setLogsLoading] = useState(false);
  const [logs, setLogs] = useState<DocumentSubmissionLogItem[]>([]);

  const [newStage, setNewStage] = useState<DocStage>("PRE");
  const [newPdfUrl, setNewPdfUrl] = useState("");
  const [newPdfFileName, setNewPdfFileName] = useState("");
  const [newSourceDataText, setNewSourceDataText] = useState("");

  const [submitEmail, setSubmitEmail] = useState("");
  const [submitStatus, setSubmitStatus] = useState("");
  const [submitPayloadText, setSubmitPayloadText] = useState("");

  const selectedAssignment = assignments.find(a => a.id === selectedAssignmentId) || null;
  const selectedRun = runs.find(r => r.id === selectedRunId) || null;
  const latestVersion = versions.length > 0 ? versions[0] : null;

  async function loadAssignments(initial = false) {
    setAssignLoading(true);
    try {
      const items = await fetchAssignments(assignQuery);
      setAssignments(items);
      if (initial && items.length > 0 && !selectedAssignmentId) setSelectedAssignmentId(items[0].id);
    } catch (e: any) { alert(e?.message || "ASSIGNMENTS_FETCH_FAILED"); }
    finally { setAssignLoading(false); }
  }

  async function loadRuns() {
    if (!selectedAssignmentId) { setRuns([]); setSelectedRunId(""); return; }
    setRunLoading(true);
    try {
      const { items } = await listRuns({
        assignmentId: selectedAssignmentId, docType,
        from: toIsoKstDayStart(periodStartDate), to: toIsoKstDayEnd(periodEndDate),
        page: 1, pageSize: 20,
      });
      setRuns(items);
      if (items.length > 0) setSelectedRunId(items[0].id);
      else setSelectedRunId("");
    } catch (e: any) { alert(e?.message || "RUNS_FETCH_FAILED"); }
    finally { setRunLoading(false); }
  }

  async function loadVersions(runId: string) {
    setVersionsLoading(true);
    try { setVersions(await listVersions(runId)); }
    catch (e: any) { alert(e?.message || "VERSIONS_FETCH_FAILED"); }
    finally { setVersionsLoading(false); }
  }

  async function loadLogs(runId: string) {
    setLogsLoading(true);
    try { setLogs(await listSubmissionLogs(runId)); }
    catch (e: any) { alert(e?.message || "LOGS_FETCH_FAILED"); }
    finally { setLogsLoading(false); }
  }

  useEffect(() => {
    (async () => {
      setAssignLoading(true);
      try {
        const items = await fetchAssignments("");
        setAssignments(items);
        if (items.length > 0) setSelectedAssignmentId(items[0].id);
      } catch (e: any) { alert(e?.message || "ASSIGNMENTS_FETCH_FAILED"); }
      finally { setAssignLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadRuns().catch(() => {}); }, [selectedAssignmentId, docType, periodStartDate, periodEndDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedRunId) { setVersions([]); setLogs([]); return; }
    loadVersions(selectedRunId).catch(() => {});
    loadLogs(selectedRunId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  async function onCreateRun() {
    if (!selectedAssignmentId) return alert("배정을 선택하세요.");
    setRunLoading(true);
    try {
      const created = await createRun({
        assignmentId: selectedAssignmentId, docType,
        periodStart: toIsoKstDayStart(periodStartDate), periodEnd: toIsoKstDayEnd(periodEndDate),
        dueAt: toIsoKstDayEnd(dueAtDate),
      });
      await loadRuns(); setSelectedRunId(created.id);
    } catch (e: any) { alert(e?.message || "RUN_CREATE_FAILED"); }
    finally { setRunLoading(false); }
  }

  async function onCreateVersion() {
    if (!selectedRunId) return alert("Run을 먼저 선택/생성하세요.");
    let sourceData: any = undefined;
    if (newSourceDataText.trim()) {
      try { sourceData = JSON.parse(newSourceDataText); }
      catch { return alert("sourceData JSON 파싱 실패"); }
    }
    setVersionsLoading(true);
    try {
      await createVersion({ runId: selectedRunId, stage: newStage, pdfUrl: newPdfUrl.trim(),
        pdfFileName: newPdfFileName.trim() ? newPdfFileName.trim() : null, sourceData });
      await loadVersions(selectedRunId);
      await loadRuns();
      setNewPdfUrl(""); setNewPdfFileName("");
    } catch (e: any) { alert(e?.message || "VERSION_CREATE_FAILED"); }
    finally { setVersionsLoading(false); }
  }

  async function onSubmit(stage: DocStage) {
    if (!selectedRunId) return alert("Run을 먼저 선택하세요.");
    if (!latestVersion) return alert("제출할 Version이 없습니다. 먼저 Version을 생성하세요.");
    let emailPayload: any = undefined;
    if (submitPayloadText.trim()) {
      try { emailPayload = JSON.parse(submitPayloadText); }
      catch { return alert("emailPayload JSON 파싱 실패"); }
    }
    setLogsLoading(true);
    try {
      await createSubmissionLog({ runId: selectedRunId, versionId: latestVersion.id, stage,
        sentToEmail: submitEmail.trim() ? submitEmail.trim() : null,
        emailStatus: submitStatus.trim() ? submitStatus.trim() : null, emailPayload });
      await loadLogs(selectedRunId);
    } catch (e: any) { alert(e?.message || "SUBMIT_FAILED"); }
    finally { setLogsLoading(false); }
  }

  const stageBadge = (stage: string) => stage === "FINAL"
    ? <span className={`${T.badge} bg-sky-50 text-sky-600`}>{stage}</span>
    : <span className={`${T.badge} bg-slate-100 text-slate-500`}>{stage}</span>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className={T.pageTitle}>문서 운영</h1>
        <p className={T.pageSub}>직무지도원별 문서 Run 생성 및 제출 이력 관리</p>
      </div>

      {/* 배정 선택 */}
      <div className={T.card}>
        <SectionHeader title="배정 선택" />
        <div className="mb-3 flex gap-2">
          <input value={assignQuery} onChange={e => setAssignQuery(e.target.value)}
            placeholder="검색(사이트/직무지도원 등)" className={`flex-1 ${T.input}`} />
          <button onClick={() => loadAssignments(false)} disabled={assignLoading} className={T.btnSecondary}>
            {assignLoading ? "조회중..." : "검색"}
          </button>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <select value={selectedAssignmentId} onChange={e => setSelectedAssignmentId(e.target.value)}
            className={`w-full max-w-md flex-none ${T.select}`}>
            <option value="">배정 선택...</option>
            {assignments.map(a => (
              <option key={a.id} value={a.id}>#{a.id} / {a.siteName ?? a.siteId} / {a.userName ?? a.userId}</option>
            ))}
          </select>
          {selectedAssignment && (
            <div className="text-xs font-semibold leading-relaxed text-slate-500">
              <div><span className="text-slate-400">선택 배정</span> #{selectedAssignment.id}</div>
              <div><span className="text-slate-400">Site</span> {selectedAssignment.siteName ?? "-"}</div>
              <div><span className="text-slate-400">Coach</span> {selectedAssignment.userName ?? "-"}</div>
            </div>
          )}
        </div>
      </div>

      {/* 문서 설정 */}
      <div className={T.card}>
        <SectionHeader title="문서 설정">
          <button onClick={onCreateRun} disabled={runLoading || !selectedAssignmentId} className={T.btnPrimary}>
            {runLoading ? "처리중..." : "Run 생성"}
          </button>
        </SectionHeader>
        <div className="flex flex-wrap items-center gap-4">
          {[
            { label: "문서 타입", content: (
              <select value={docType} onChange={e => setDocType(e.target.value)} className={`w-auto ${T.select}`}>
                {Object.entries(DOC_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )},
            { label: "기간 시작", content: <input type="date" value={periodStartDate} onChange={e => setPeriodStartDate(e.target.value)} className={`w-auto ${T.input}`} /> },
            { label: "기간 종료", content: <input type="date" value={periodEndDate}   onChange={e => setPeriodEndDate(e.target.value)}   className={`w-auto ${T.input}`} /> },
            { label: "마감(dueAt)", content: <input type="date" value={dueAtDate}    onChange={e => setDueAtDate(e.target.value)}       className={`w-auto ${T.input}`} /> },
          ].map(({ label, content }) => (
            <label key={label} className="flex items-center gap-2">
              <span className="whitespace-nowrap text-xs font-semibold text-slate-400">{label}</span>
              {content}
            </label>
          ))}
        </div>
      </div>

      {/* Run 목록 */}
      <div className={T.card}>
        <SectionHeader title="Run 목록">
          <button onClick={() => loadRuns()} disabled={runLoading} className={T.btnSecondary}>
            {runLoading ? "조회중..." : "새로고침"}
          </button>
        </SectionHeader>
        <div className="flex flex-wrap items-start gap-4">
          <select value={selectedRunId} onChange={e => setSelectedRunId(e.target.value)}
            className={`w-full max-w-md flex-none ${T.select}`}>
            <option value="">Run 선택...</option>
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                #{r.id} / {DOC_TYPE_LABEL[r.docType] || r.docType} / {new Date(r.periodStart).toLocaleDateString()}~{new Date(r.periodEnd).toLocaleDateString()} / 마감 {new Date(r.dueAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          {selectedRun && (
            <div className="text-xs font-semibold leading-relaxed text-slate-500">
              <div><span className="text-slate-400">Status</span> {stageBadge(selectedRun.status)}</div>
              <div><span className="text-slate-400">OpenAt</span> {new Date(selectedRun.openAt).toLocaleString()}</div>
              <div><span className="text-slate-400">CurrentVersionId</span> {selectedRun.currentVersionId ?? "-"}</div>
            </div>
          )}
        </div>
      </div>

      {/* Version + 제출 로그 */}
      <div className="grid grid-cols-2 gap-4">
        {/* Version */}
        <div className={T.card}>
          <SectionHeader title="Version">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">
                최신: {latestVersion ? `v${latestVersion.versionNo}(${latestVersion.stage})` : "-"}
              </span>
              <button onClick={() => selectedRunId && loadVersions(selectedRunId)}
                disabled={!selectedRunId || versionsLoading} className={T.btnSecondary}>
                {versionsLoading ? "조회중..." : "새로고침"}
              </button>
            </div>
          </SectionHeader>

          <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="mb-3 text-sm font-black text-slate-700">버전 생성</p>
            <div className="mb-2 flex gap-2">
              <label className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400">Stage</span>
                <select value={newStage} onChange={e => setNewStage(e.target.value)} className={`w-auto ${T.select}`}>
                  <option value="PRE">PRE</option>
                  <option value="FINAL">FINAL</option>
                </select>
              </label>
              <input value={newPdfUrl} onChange={e => setNewPdfUrl(e.target.value)}
                placeholder="pdfUrl (선택 - 비워두면 jsreport 자동 생성)" className={`flex-1 ${T.input}`} />
            </div>
            <input value={newPdfFileName} onChange={e => setNewPdfFileName(e.target.value)}
              placeholder="pdfFileName (선택)" className={`mb-2 w-full ${T.input}`} />
            <textarea value={newSourceDataText} onChange={e => setNewSourceDataText(e.target.value)}
              placeholder="sourceData JSON" rows={4}
              className={`w-full resize-y font-mono text-xs ${T.input} h-auto py-2`} />
            <div className="mt-2 flex justify-end">
              <button onClick={onCreateVersion} disabled={!selectedRunId || versionsLoading} className={T.btnPrimary}>
                {versionsLoading ? "처리중..." : "Version 생성"}
              </button>
            </div>
          </div>

          <p className="mb-1.5 text-xs font-semibold text-slate-400">목록</p>
          <div className={T.tableWrap}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>{["No", "Stage", "PDF", "Created"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {versions.length === 0 ? (
                  <tr><td colSpan={4} className={T.tdCenter}>버전이 없습니다.</td></tr>
                ) : versions.map(v => (
                  <tr key={v.id} className={T.trBase}>
                    <td className={T.td}>v{v.versionNo}</td>
                    <td className={T.td}>{stageBadge(v.stage)}</td>
                    <td className={T.td}>
                      <a href={`/api/admin/document-versions/${v.id}/pdf`} target="_blank" rel="noreferrer"
                        className="font-semibold text-sky-600 hover:underline">열기</a>
                    </td>
                    <td className={`${T.td} text-slate-400`}>{new Date(v.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 제출 로그 */}
        <div className={T.card}>
          <SectionHeader title="제출 로그">
            <button onClick={() => selectedRunId && loadLogs(selectedRunId)}
              disabled={!selectedRunId || logsLoading} className={T.btnSecondary}>
              {logsLoading ? "조회중..." : "새로고침"}
            </button>
          </SectionHeader>

          <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="mb-1 text-sm font-black text-slate-700">제출</p>
            <p className="mb-3 text-xs font-semibold text-slate-400">
              제출 대상 버전: {latestVersion ? `v${latestVersion.versionNo} (${latestVersion.stage})` : "-"}
            </p>
            <input value={submitEmail} onChange={e => setSubmitEmail(e.target.value)}
              placeholder="sentToEmail (선택)" className={`mb-2 w-full ${T.input}`} />
            <input value={submitStatus} onChange={e => setSubmitStatus(e.target.value)}
              placeholder="emailStatus (예: SENT)" className={`mb-2 w-full ${T.input}`} />
            <textarea value={submitPayloadText} onChange={e => setSubmitPayloadText(e.target.value)}
              placeholder="emailPayload JSON" rows={4}
              className={`w-full resize-y font-mono text-xs ${T.input} h-auto py-2`} />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => onSubmit("PRE")} disabled={!selectedRunId || logsLoading || !latestVersion} className={T.btnSecondary}>
                PRE 제출
              </button>
              <button onClick={() => onSubmit("FINAL")} disabled={!selectedRunId || logsLoading || !latestVersion} className={T.btnPrimary}>
                FINAL 제출
              </button>
            </div>
          </div>

          <p className="mb-1.5 text-xs font-semibold text-slate-400">목록</p>
          <div className={T.tableWrap}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>{["At", "Stage", "Email", "Status"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={4} className={T.tdCenter}>제출 로그가 없습니다.</td></tr>
                ) : logs.map(l => (
                  <tr key={l.id} className={T.trBase}>
                    <td className={`${T.td} text-slate-400`}>{new Date(l.submittedAt).toLocaleString()}</td>
                    <td className={T.td}>{stageBadge(l.stage)}</td>
                    <td className={`${T.td} text-slate-600`}>{l.sentToEmail ?? "-"}</td>
                    <td className={`${T.td} text-slate-600`}>{l.emailStatus ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
