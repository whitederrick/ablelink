"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AssignmentItem,
  DocStage,
  DocType,
  DocumentRunItem,
  DocumentVersionItem,
  DocumentSubmissionLogItem,
} from "./_lib/types";
import {
  fetchAssignments,
  createRun,
  listRuns,
  listVersions,
  createVersion,
  listSubmissionLogs,
  createSubmissionLog,
} from "./_lib/api";

function toDateInputValue(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toIsoKstDayStart(dateStr: string) {
  return `${dateStr}T00:00:00.000+09:00`;
}
function toIsoKstDayEnd(dateStr: string) {
  return `${dateStr}T23:59:59.999+09:00`;
}

export default function AdminDocumentsPage() {
  // Assignments
  const [assignQuery, setAssignQuery] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");

  // Doc options
  const [docType, setDocType] = useState<DocType>("TRAINING_DAILY_LOG");

  const today = useMemo(() => new Date(), []);
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const monthEnd = useMemo(() => new Date(today.getFullYear(), today.getMonth() + 1, 0), [today]);

  const [periodStartDate, setPeriodStartDate] = useState(toDateInputValue(monthStart));
  const [periodEndDate, setPeriodEndDate] = useState(toDateInputValue(monthEnd));
  const [dueAtDate, setDueAtDate] = useState(toDateInputValue(monthEnd));

  // Runs
  const [runLoading, setRunLoading] = useState(false);
  const [runs, setRuns] = useState<DocumentRunItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");

  // Versions & logs
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);

  const [logsLoading, setLogsLoading] = useState(false);
  const [logs, setLogs] = useState<DocumentSubmissionLogItem[]>([]);

  // Version create form
  const [newStage, setNewStage] = useState<DocStage>("PRE");
  const [newPdfUrl, setNewPdfUrl] = useState("");
  const [newPdfFileName, setNewPdfFileName] = useState("");
  const [newSourceDataText, setNewSourceDataText] = useState('');

  // Submit form
  const [submitEmail, setSubmitEmail] = useState("");
  const [submitStatus, setSubmitStatus] = useState('');
  const [submitPayloadText, setSubmitPayloadText] = useState('');

  const selectedAssignment = assignments.find((a) => a.id === selectedAssignmentId) || null;
  const selectedRun = runs.find((r) => r.id === selectedRunId) || null;
  const latestVersion = versions.length > 0 ? versions[0] : null;

  async function loadAssignments(initial = false) {
    setAssignLoading(true);
    try {
      const items = await fetchAssignments(assignQuery);
      setAssignments(items);
      if (initial && items.length > 0 && !selectedAssignmentId) {
        setSelectedAssignmentId(items[0].id);
      }
    } catch (e: any) {
      alert(e?.message || "ASSIGNMENTS_FETCH_FAILED");
    } finally {
      setAssignLoading(false);
    }
  }

  async function loadRuns() {
    if (!selectedAssignmentId) {
      setRuns([]);
      setSelectedRunId("");
      return;
    }

    setRunLoading(true);
    try {
      const { items } = await listRuns({
        assignmentId: selectedAssignmentId,
        docType,
        from: toIsoKstDayStart(periodStartDate),
        to: toIsoKstDayEnd(periodEndDate),
        page: 1,
        pageSize: 20,
      });
      setRuns(items);
      if (items.length > 0) {
        // 최신(내림차순) 첫 항목을 선택
        setSelectedRunId(items[0].id);
      } else {
        setSelectedRunId("");
      }
    } catch (e: any) {
      alert(e?.message || "RUNS_FETCH_FAILED");
    } finally {
      setRunLoading(false);
    }
  }

  async function loadVersions(runId: string) {
    setVersionsLoading(true);
    try {
      const items = await listVersions(runId);
      setVersions(items);
    } catch (e: any) {
      alert(e?.message || "VERSIONS_FETCH_FAILED");
    } finally {
      setVersionsLoading(false);
    }
  }

  async function loadLogs(runId: string) {
    setLogsLoading(true);
    try {
      const items = await listSubmissionLogs(runId);
      setLogs(items);
    } catch (e: any) {
      alert(e?.message || "LOGS_FETCH_FAILED");
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
        setAssignLoading(true);
        try {
        const items = await fetchAssignments("");
        setAssignments(items);
        if (items.length > 0) setSelectedAssignmentId(items[0].id);
        } catch (e: any) {
        alert(e?.message || "ASSIGNMENTS_FETCH_FAILED");
        } finally {
        setAssignLoading(false);
        }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

  useEffect(() => {
    loadRuns().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignmentId, docType, periodStartDate, periodEndDate]);

  useEffect(() => {
    if (!selectedRunId) {
      setVersions([]);
      setLogs([]);
      return;
    }
    loadVersions(selectedRunId).catch(() => {});
    loadLogs(selectedRunId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  async function onCreateRun() {
    if (!selectedAssignmentId) return alert("배정을 선택하세요.");

    setRunLoading(true);
    try {
      const created = await createRun({
        assignmentId: selectedAssignmentId,
        docType,
        periodStart: toIsoKstDayStart(periodStartDate),
        periodEnd: toIsoKstDayEnd(periodEndDate),
        dueAt: toIsoKstDayEnd(dueAtDate),
      });

      await loadRuns();
      setSelectedRunId(created.id);
    } catch (e: any) {
      alert(e?.message || "RUN_CREATE_FAILED");
    } finally {
      setRunLoading(false);
    }
  }

  async function onCreateVersion() {
    if (!selectedRunId) return alert("Run을 먼저 선택/생성하세요.");
    // pdfUrl은 선택 - 비워두면 jsreport로 자동 생성

    let sourceData: any = undefined;
    if (newSourceDataText.trim()) {
      try {
        sourceData = JSON.parse(newSourceDataText);
      } catch {
        return alert("sourceData JSON 파싱 실패");
      }
    }

    setVersionsLoading(true);
    try {
      await createVersion({
        runId: selectedRunId,
        stage: newStage,
        pdfUrl: newPdfUrl.trim(),
        pdfFileName: newPdfFileName.trim() ? newPdfFileName.trim() : null,
        sourceData,
      });

      await loadVersions(selectedRunId);
      await loadRuns(); // currentVersion 갱신 반영
      setNewPdfUrl("");
      setNewPdfFileName("");
    } catch (e: any) {
      alert(e?.message || "VERSION_CREATE_FAILED");
    } finally {
      setVersionsLoading(false);
    }
  }

  async function onSubmit(stage: DocStage) {
    if (!selectedRunId) return alert("Run을 먼저 선택하세요.");
    if (!latestVersion) return alert("제출할 Version이 없습니다. 먼저 Version을 생성하세요.");

    let emailPayload: any = undefined;
    if (submitPayloadText.trim()) {
      try {
        emailPayload = JSON.parse(submitPayloadText);
      } catch {
        return alert("emailPayload JSON 파싱 실패");
      }
    }

    setLogsLoading(true);
    try {
      await createSubmissionLog({
        runId: selectedRunId,
        versionId: latestVersion.id,
        stage,
        sentToEmail: submitEmail.trim() ? submitEmail.trim() : null,
        emailStatus: submitStatus.trim() ? submitStatus.trim() : null,
        emailPayload,
      });
      await loadLogs(selectedRunId);
    } catch (e: any) {
      alert(e?.message || "SUBMIT_FAILED");
    } finally {
      setLogsLoading(false);
    }
  }

  const DOC_TYPE_LABEL: Record<string, string> = {
    TRAINING_DAILY_LOG: "지원고용 훈련일지",
    ATTENDANCE_SHEET: "직무지도원 출근부",
    TRAINEE_COMPREHENSIVE_EVAL: "훈련생 종합평가",
    POST_EMPLOY_ADAPT_LOG: "적응지도 일지",
    ADAPTATION_COMPREHENSIVE_EVAL: "적응지도 종합평가",
    CHECKLIST: "체크리스트",
  };

  return (
    <div>
      {/* 페이지 헤더 */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.3px" }}>문서 운영</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9ca3af" }}>직무지도원별 문서 Run 생성 및 제출 이력 관리</p>
      </div>

      {/* 배정 선택 */}
      <div style={card}>
        <div style={sectionHeader}>
          <span style={sectionTitle}>배정 선택</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input
            value={assignQuery}
            onChange={(e) => setAssignQuery(e.target.value)}
            placeholder="검색(사이트/직무지도원 등)"
            style={inputStyle}
          />
          <button onClick={() => loadAssignments(false)} disabled={assignLoading} style={btnSecondary}>
            {assignLoading ? "조회중..." : "검색"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" as const }}>
          <select
            value={selectedAssignmentId}
            onChange={(e) => setSelectedAssignmentId(e.target.value)}
            style={{ ...inputStyle, width: 480, flex: "none" }}
          >
            <option value="">배정 선택...</option>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id} / {a.siteName ?? a.siteId} / {a.userName ?? a.userId}
              </option>
            ))}
          </select>
          {selectedAssignment && (
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.8 }}>
              <div><span style={{ color: "#9ca3af" }}>선택 배정</span> #{selectedAssignment.id}</div>
              <div><span style={{ color: "#9ca3af" }}>Site</span> {selectedAssignment.siteName ?? "-"}</div>
              <div><span style={{ color: "#9ca3af" }}>Coach</span> {selectedAssignment.userName ?? "-"}</div>
            </div>
          )}
        </div>
      </div>

      {/* 문서 설정 */}
      <div style={{ ...card, marginTop: 12 }}>
        <div style={sectionHeader}>
          <span style={sectionTitle}>문서 설정</span>
          <button onClick={onCreateRun} disabled={runLoading || !selectedAssignmentId} style={btnPrimary}>
            {runLoading ? "처리중..." : "Run 생성"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" as const, alignItems: "center" }}>
          <label style={labelRow}>
            <span style={labelText}>문서 타입</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
              <option value="TRAINING_DAILY_LOG">지원고용 훈련일지</option>
              <option value="ATTENDANCE_SHEET">직무지도원 출근부</option>
              <option value="TRAINEE_COMPREHENSIVE_EVAL">훈련생 종합평가</option>
              <option value="POST_EMPLOY_ADAPT_LOG">적응지도 일지</option>
              <option value="ADAPTATION_COMPREHENSIVE_EVAL">적응지도 종합평가</option>
              <option value="CHECKLIST">체크리스트</option>
            </select>
          </label>
          <label style={labelRow}>
            <span style={labelText}>기간 시작</span>
            <input type="date" value={periodStartDate} onChange={(e) => setPeriodStartDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
          </label>
          <label style={labelRow}>
            <span style={labelText}>기간 종료</span>
            <input type="date" value={periodEndDate} onChange={(e) => setPeriodEndDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
          </label>
          <label style={labelRow}>
            <span style={labelText}>마감(dueAt)</span>
            <input type="date" value={dueAtDate} onChange={(e) => setDueAtDate(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
          </label>
        </div>
      </div>

      {/* Run 목록 */}
      <div style={{ ...card, marginTop: 12 }}>
        <div style={sectionHeader}>
          <span style={sectionTitle}>Run 목록</span>
          <button onClick={() => loadRuns()} disabled={runLoading} style={btnSecondary}>
            {runLoading ? "조회중..." : "새로고침"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" as const, alignItems: "flex-start" }}>
          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            style={{ ...inputStyle, width: 480, flex: "none" }}
          >
            <option value="">Run 선택...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.id} / {DOC_TYPE_LABEL[r.docType] || r.docType} / {new Date(r.periodStart).toLocaleDateString()}~{new Date(r.periodEnd).toLocaleDateString()} / 마감 {new Date(r.dueAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          {selectedRun && (
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.8 }}>
              <div><span style={{ color: "#9ca3af" }}>Status</span> <span style={{ ...badge, ...(selectedRun.status === "OPEN" ? badgeBlue : badgeGray) }}>{selectedRun.status}</span></div>
              <div><span style={{ color: "#9ca3af" }}>OpenAt</span> {new Date(selectedRun.openAt).toLocaleString()}</div>
              <div><span style={{ color: "#9ca3af" }}>CurrentVersionId</span> {selectedRun.currentVersionId ?? "-"}</div>
            </div>
          )}
        </div>
      </div>

      {/* Version + 제출 로그 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        {/* Version */}
        <div style={card}>
          <div style={sectionHeader}>
            <span style={sectionTitle}>Version</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>최신: {latestVersion ? `v${latestVersion.versionNo}(${latestVersion.stage})` : "-"}</span>
              <button onClick={() => selectedRunId && loadVersions(selectedRunId)} disabled={!selectedRunId || versionsLoading} style={btnSecondary}>
                {versionsLoading ? "조회중..." : "새로고침"}
              </button>
            </div>
          </div>

          {/* 버전 생성 폼 */}
          <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 14, marginBottom: 14, background: "#fafafa" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "#374151" }}>버전 생성</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <label style={labelRow}>
                <span style={labelText}>Stage</span>
                <select value={newStage} onChange={(e) => setNewStage(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                  <option value="PRE">PRE</option>
                  <option value="FINAL">FINAL</option>
                </select>
              </label>
              <input value={newPdfUrl} onChange={(e) => setNewPdfUrl(e.target.value)} placeholder="pdfUrl (선택 - 비워두면 jsreport 자동 생성)" style={{ ...inputStyle, flex: 1 }} />
            </div>
            <input value={newPdfFileName} onChange={(e) => setNewPdfFileName(e.target.value)} placeholder="pdfFileName (선택)" style={{ ...inputStyle, marginBottom: 8 }} />
            <textarea value={newSourceDataText} onChange={(e) => setNewSourceDataText(e.target.value)} placeholder="sourceData JSON" rows={4}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, resize: "vertical" as const }} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={onCreateVersion} disabled={!selectedRunId || versionsLoading} style={btnPrimary}>
                {versionsLoading ? "처리중..." : "Version 생성"}
              </button>
            </div>
          </div>

          {/* 버전 목록 */}
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>목록</div>
          <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["No", "Stage", "PDF", "Created"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #f0f0f0", color: "#9ca3af", fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versions.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 16, color: "#d1d5db", textAlign: "center" }}>버전이 없습니다.</td></tr>
                ) : versions.map((v) => (
                  <tr key={v.id} style={{ borderBottom: "1px solid #f9f9f9" }}>
                    <td style={{ padding: "10px 12px" }}>v{v.versionNo}</td>
                    <td style={{ padding: "10px 12px" }}><span style={{ ...badge, ...(v.stage === "FINAL" ? badgeBlue : badgeGray) }}>{v.stage}</span></td>
                    <td style={{ padding: "10px 12px" }}><a href={`/api/admin/document-versions/${v.id}/pdf`} target="_blank" rel="noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>열기</a></td>
                    <td style={{ padding: "10px 12px", color: "#9ca3af" }}>{new Date(v.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 제출 로그 */}
        <div style={card}>
          <div style={sectionHeader}>
            <span style={sectionTitle}>제출 로그</span>
            <button onClick={() => selectedRunId && loadLogs(selectedRunId)} disabled={!selectedRunId || logsLoading} style={btnSecondary}>
              {logsLoading ? "조회중..." : "새로고침"}
            </button>
          </div>

          {/* 제출 폼 */}
          <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 14, marginBottom: 14, background: "#fafafa" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#374151" }}>제출</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>
              제출 대상 버전: {latestVersion ? `v${latestVersion.versionNo} (${latestVersion.stage})` : "-"}
            </div>
            <input value={submitEmail} onChange={(e) => setSubmitEmail(e.target.value)} placeholder="sentToEmail (선택)" style={{ ...inputStyle, marginBottom: 8 }} />
            <input value={submitStatus} onChange={(e) => setSubmitStatus(e.target.value)} placeholder="emailStatus (예: SENT)" style={{ ...inputStyle, marginBottom: 8 }} />
            <textarea value={submitPayloadText} onChange={(e) => setSubmitPayloadText(e.target.value)} placeholder="emailPayload JSON" rows={4}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, resize: "vertical" as const }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => onSubmit("PRE")} disabled={!selectedRunId || logsLoading || !latestVersion} style={btnSecondary}>PRE 제출</button>
              <button onClick={() => onSubmit("FINAL")} disabled={!selectedRunId || logsLoading || !latestVersion} style={btnPrimary}>FINAL 제출</button>
            </div>
          </div>

          {/* 제출 로그 목록 */}
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>목록</div>
          <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["At", "Stage", "Email", "Status"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #f0f0f0", color: "#9ca3af", fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 16, color: "#d1d5db", textAlign: "center" }}>제출 로그가 없습니다.</td></tr>
                ) : logs.map((l) => (
                  <tr key={l.id} style={{ borderBottom: "1px solid #f9f9f9" }}>
                    <td style={{ padding: "10px 12px", color: "#9ca3af" }}>{new Date(l.submittedAt).toLocaleString()}</td>
                    <td style={{ padding: "10px 12px" }}><span style={{ ...badge, ...(l.stage === "FINAL" ? badgeBlue : badgeGray) }}>{l.stage}</span></td>
                    <td style={{ padding: "10px 12px" }}>{l.sentToEmail ?? "-"}</td>
                    <td style={{ padding: "10px 12px" }}>{l.emailStatus ?? "-"}</td>
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

// ── 공통 스타일 ──────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #f0f0f0",
  borderRadius: 12,
  padding: "18px 20px",
};
const sectionHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 14,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#111827",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 11px",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  fontSize: 13,
  color: "#111827",
  background: "#fff",
  outline: "none",
  fontFamily: "inherit",
};
const labelRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};
const labelText: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
  whiteSpace: "nowrap" as const,
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 16px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff",
  color: "#374151",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
};
const badge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
};
const badgeBlue: React.CSSProperties = { background: "#eff6ff", color: "#2563eb" };
const badgeGray: React.CSSProperties = { background: "#f9fafb", color: "#6b7280" };
