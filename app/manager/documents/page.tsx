"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AssignmentItem, DocStage, DocType,
  DocumentRunItem, DocumentVersionItem, DocumentSubmissionLogItem,
} from "./_lib/types";
import {
  fetchAssignments, createRun, listRuns, listVersions,
  createVersion, listSubmissionLogs, createSubmissionLog,
} from "./_lib/api";
import { T } from "../_styles";

const DOC_TYPE_LABEL: Record<string, string> = {
  TRAINING_DAILY_LOG:            "지원고용 훈련일지",
  ATTENDANCE_SHEET:              "직무지도원 출근부",
  TRAINEE_COMPREHENSIVE_EVAL:    "훈련생 종합평가",
  POST_EMPLOY_ADAPT_LOG:         "적응지도 일지",
  ADAPTATION_COMPREHENSIVE_EVAL: "적응지도 종합평가",
  CHECKLIST:                     "체크리스트",
};

const DOC_TYPE_PREVIEW_KEY: Record<string, string> = {
  TRAINING_DAILY_LOG:            "training-daily-log",
  ATTENDANCE_SHEET:              "attendance-sheet",
  TRAINEE_COMPREHENSIVE_EVAL:    "trainee-final-eval",
  POST_EMPLOY_ADAPT_LOG:         "adaptation-daily-log",
  ADAPTATION_COMPREHENSIVE_EVAL: "adaptation-final-eval",
};

const STAGE_LABEL: Record<string, string>  = { PRE: "초안", FINAL: "최종본" };
const STATUS_LABEL: Record<string, string> = { OPEN: "진행중", CLOSED: "완료" };

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { return iso; }
}
function toDateValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function kstStart(s: string) { return `${s}T00:00:00.000+09:00`; }
function kstEnd(s: string)   { return `${s}T23:59:59.999+09:00`; }

export default function AdminDocumentsPage() {
  const today      = useMemo(() => new Date(), []);
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const monthEnd   = useMemo(() => new Date(today.getFullYear(), today.getMonth() + 1, 0), [today]);

  const [assignments,         setAssignments]         = useState<AssignmentItem[]>([]);
  const [assignLoading,       setAssignLoading]       = useState(false);
  const [selectedAssignId,    setSelectedAssignId]    = useState("");

  const [docType,    setDocType]    = useState<DocType>("TRAINING_DAILY_LOG");
  const [periodStart, setPeriodStart] = useState(toDateValue(monthStart));
  const [periodEnd,   setPeriodEnd]   = useState(toDateValue(monthEnd));
  const [dueDate,     setDueDate]     = useState(toDateValue(monthEnd));

  const [runs,         setRuns]         = useState<DocumentRunItem[]>([]);
  const [runLoading,   setRunLoading]   = useState(false);
  const [selectedRunId, setSelectedRunId] = useState("");

  const [versions,        setVersions]        = useState<DocumentVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [newStage,        setNewStage]        = useState<DocStage>("PRE");

  const [logs,         setLogs]         = useState<DocumentSubmissionLogItem[]>([]);
  const [logsLoading,  setLogsLoading]  = useState(false);
  const [submitEmail,  setSubmitEmail]  = useState("");

  const selectedRun    = runs.find(r => r.id === selectedRunId) || null;
  const latestVersion  = versions.length > 0 ? versions[0] : null;

  useEffect(() => {
    setAssignLoading(true);
    fetchAssignments("")
      .then(items => {
        setAssignments(items);
        if (items.length > 0) setSelectedAssignId(items[0].id);
      })
      .catch(() => {})
      .finally(() => setAssignLoading(false));
  }, []);

  useEffect(() => { loadRuns().catch(() => {}); }, [selectedAssignId, docType, periodStart, periodEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedRunId) { setVersions([]); setLogs([]); return; }
    loadVersions(selectedRunId).catch(() => {});
    loadLogs(selectedRunId).catch(() => {});
  }, [selectedRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRuns() {
    if (!selectedAssignId) { setRuns([]); setSelectedRunId(""); return; }
    setRunLoading(true);
    try {
      const { items } = await listRuns({
        assignmentId: selectedAssignId, docType,
        from: kstStart(periodStart), to: kstEnd(periodEnd),
        page: 1, pageSize: 20,
      });
      setRuns(items);
      if (items.length > 0) setSelectedRunId(items[0].id);
      else setSelectedRunId("");
    } catch (e: any) { alert(e?.message || "조회 실패"); }
    finally { setRunLoading(false); }
  }

  async function loadVersions(runId: string) {
    setVersionsLoading(true);
    try { setVersions(await listVersions(runId)); }
    catch {}
    finally { setVersionsLoading(false); }
  }

  async function loadLogs(runId: string) {
    setLogsLoading(true);
    try { setLogs(await listSubmissionLogs(runId)); }
    catch {}
    finally { setLogsLoading(false); }
  }

  async function onCreateRun() {
    if (!selectedAssignId) return alert("배정을 선택하세요.");
    setRunLoading(true);
    try {
      const created = await createRun({
        assignmentId: selectedAssignId, docType,
        periodStart: kstStart(periodStart),
        periodEnd:   kstEnd(periodEnd),
        dueAt:       kstEnd(dueDate),
      });
      await loadRuns();
      setSelectedRunId(created.id);
    } catch (e: any) { alert(e?.message || "생성 실패"); }
    finally { setRunLoading(false); }
  }

  async function onCreateVersion() {
    if (!selectedRun) return alert("발송 건을 먼저 선택하세요.");
    // 해당 발송 건의 미리보기 URL을 PDF URL로 사용
    const previewKey = DOC_TYPE_PREVIEW_KEY[selectedRun.docType] || selectedRun.docType.toLowerCase().replace(/_/g, "-");
    const p = new URLSearchParams({
      workerId: selectedRun.workerId,
      docType:     previewKey,
      periodStart: selectedRun.periodStart.slice(0, 10),
      periodEnd:   selectedRun.periodEnd.slice(0, 10),
    });
    const pdfUrl = `/api/admin/docs/preview?${p.toString()}`;
    setVersionsLoading(true);
    try {
      await createVersion({ runId: selectedRunId, stage: newStage, pdfUrl });
      await loadVersions(selectedRunId);
      await loadRuns();
    } catch (e: any) { alert(e?.message || "버전 생성 실패"); }
    finally { setVersionsLoading(false); }
  }

  async function onLogSubmission(stage: DocStage) {
    if (!latestVersion) return alert("버전이 없습니다. 먼저 버전을 생성하세요.");
    setLogsLoading(true);
    try {
      await createSubmissionLog({
        runId: selectedRunId, versionId: latestVersion.id, stage,
        sentToEmail: submitEmail.trim() || null,
        emailStatus: "SENT",
      });
      await loadLogs(selectedRunId);
    } catch (e: any) { alert(e?.message || "기록 실패"); }
    finally { setLogsLoading(false); }
  }

  const stageBadge = (s: string) => (
    <span className={`${T.badge} ${s === "FINAL" ? "bg-sky-50 text-sky-600" : "bg-amber-50 text-amber-700"}`}>
      {STAGE_LABEL[s] || s}
    </span>
  );

  const statusBadge = (s: string) => (
    <span className={`${T.badge} ${s === "OPEN" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
      {STATUS_LABEL[s] || s}
    </span>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className={T.pageTitle}>문서 운영</h1>
        <p className={T.pageSub}>직무지도원별 문서 발송 건 생성 및 제출 이력 관리</p>
      </div>

      {/* 배정 + 설정 */}
      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-900">조회 조건</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-400">직무지도원 배정</label>
            {assignLoading ? (
              <p className={T.empty}>불러오는 중...</p>
            ) : (
              <select value={selectedAssignId} onChange={e => setSelectedAssignId(e.target.value)}
                className={`w-full ${T.select}`}>
                <option value="">배정 선택...</option>
                {assignments.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.workerName ?? a.workerId} — {a.siteName ?? a.siteId}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">문서 종류</label>
            <select value={docType} onChange={e => setDocType(e.target.value)} className={`w-auto ${T.select}`}>
              {Object.entries(DOC_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">기간</label>
            <div className="flex items-center gap-1">
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={`w-auto ${T.input}`} />
              <span className="text-slate-400">~</span>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={`w-auto ${T.input}`} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">마감일</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={`w-auto ${T.input}`} />
          </div>
          <div className="flex gap-2">
            <button onClick={loadRuns} disabled={runLoading || !selectedAssignId} className={T.btnSecondary}>
              {runLoading ? "조회중..." : "조회"}
            </button>
            <button onClick={onCreateRun} disabled={runLoading || !selectedAssignId} className={T.btnPrimary}>
              {runLoading ? "처리중..." : "발송 건 생성"}
            </button>
          </div>
        </div>
      </div>

      {/* 발송 건 목록 */}
      <div className={T.card}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-black text-slate-900">발송 건 목록</p>
          <span className="text-xs font-semibold text-slate-400">총 {runs.length}건</span>
        </div>
        {runs.length === 0 ? (
          <p className={T.empty}>{runLoading ? "조회 중..." : "발송 건이 없습니다."}</p>
        ) : (
          <div className={T.tableWrap}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {["직무지도원", "문서 종류", "기간", "마감일", "상태", "버전", ""].map(h =>
                    <th key={h} className={T.th}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className={`${T.trBase} ${selectedRunId === r.id ? "bg-sky-50" : ""}`}>
                    <td className={T.td}>{r.worker?.workerName ?? r.workerId}</td>
                    <td className={T.td}>{DOC_TYPE_LABEL[r.docType] || r.docType}</td>
                    <td className={T.td}>{fmtDate(r.periodStart)} ~ {fmtDate(r.periodEnd)}</td>
                    <td className={T.td}>{fmtDate(r.dueAt)}</td>
                    <td className={T.td}>{statusBadge(r.status)}</td>
                    <td className={T.td}>{r.currentVersionId ? "있음" : "없음"}</td>
                    <td className={T.td}>
                      <button
                        onClick={() => setSelectedRunId(r.id === selectedRunId ? "" : r.id)}
                        className="font-semibold text-sky-600 hover:underline"
                      >
                        {selectedRunId === r.id ? "닫기" : "상세"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 발송 건 상세 */}
      {selectedRun && (
        <div className="grid grid-cols-2 gap-4">
          {/* 버전 이력 */}
          <div className={T.card}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-black text-slate-900">버전 이력</p>
              <span className="text-xs font-semibold text-slate-400">
                최신: {latestVersion ? `v${latestVersion.versionNo}` : "없음"}
              </span>
            </div>

            <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-black text-slate-700">새 버전 생성</p>
              <div className="mb-3 flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-400 whitespace-nowrap">버전 종류</label>
                <select value={newStage} onChange={e => setNewStage(e.target.value)} className={`flex-1 ${T.select}`}>
                  <option value="PRE">초안 (임시)</option>
                  <option value="FINAL">최종본</option>
                </select>
              </div>
              <button onClick={onCreateVersion} disabled={versionsLoading} className={`w-full ${T.btnPrimary}`}>
                {versionsLoading ? "처리중..." : "버전 생성"}
              </button>
            </div>

            <div className={T.tableWrap}>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>{["No", "종류", "PDF", "생성일시"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {versions.length === 0 ? (
                    <tr><td colSpan={4} className={T.tdCenter}>{versionsLoading ? "조회 중..." : "버전이 없습니다."}</td></tr>
                  ) : versions.map(v => (
                    <tr key={v.id} className={T.trBase}>
                      <td className={T.td}>v{v.versionNo}</td>
                      <td className={T.td}>{stageBadge(v.stage)}</td>
                      <td className={T.td}>
                        <a href={`/api/admin/document-versions/${v.id}/pdf`} target="_blank" rel="noreferrer"
                          className="font-semibold text-sky-600 hover:underline">열기</a>
                      </td>
                      <td className={`${T.td} text-slate-400`}>{new Date(v.createdAt).toLocaleString("ko-KR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 발송 이력 */}
          <div className={T.card}>
            <p className="mb-3 text-sm font-black text-slate-900">발송 이력</p>

            <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="mb-1 text-xs font-black text-slate-700">발송 기록 추가</p>
              <p className="mb-2 text-xs font-semibold text-slate-400">
                대상 버전: {latestVersion
                  ? `v${latestVersion.versionNo} — ${STAGE_LABEL[latestVersion.stage] || latestVersion.stage}`
                  : "없음 (버전 먼저 생성)"}
              </p>
              <input
                value={submitEmail}
                onChange={e => setSubmitEmail(e.target.value)}
                placeholder="수신 이메일 (선택)"
                className={`mb-2 w-full ${T.input}`}
              />
              <div className="flex gap-2">
                <button onClick={() => onLogSubmission("PRE")} disabled={logsLoading || !latestVersion}
                  className={`flex-1 ${T.btnSecondary}`}>
                  초안 발송
                </button>
                <button onClick={() => onLogSubmission("FINAL")} disabled={logsLoading || !latestVersion}
                  className={`flex-1 ${T.btnPrimary}`}>
                  최종본 발송
                </button>
              </div>
            </div>

            <div className={T.tableWrap}>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>{["발송일시", "종류", "수신 이메일", "상태"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={4} className={T.tdCenter}>{logsLoading ? "조회 중..." : "발송 이력이 없습니다."}</td></tr>
                  ) : logs.map(l => (
                    <tr key={l.id} className={T.trBase}>
                      <td className={`${T.td} text-slate-400`}>{new Date(l.submittedAt).toLocaleString("ko-KR")}</td>
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
      )}
    </div>
  );
}
