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
  const [newSourceDataText, setNewSourceDataText] = useState('{"note":"sample"}');

  // Submit form
  const [submitEmail, setSubmitEmail] = useState("");
  const [submitStatus, setSubmitStatus] = useState("SENT");
  const [submitPayloadText, setSubmitPayloadText] = useState('{"provider":"MANUAL"}');

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
    if (!newPdfUrl.trim()) return alert("pdfUrl은 필수입니다.");

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

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111", marginBottom: 20 }}>문서 운영</h1>

      {/* Assignment */}
      <section style={{ backgroundColor: "#fff", border: "none", borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#333", minWidth: 120 }}>배정 선택</div>
          <input
            value={assignQuery}
            onChange={(e) => setAssignQuery(e.target.value)}
            placeholder="검색(사이트/직무지도원 등)"
            style={{ flex: 1, padding: 8, border: "1px solid #ddd", borderRadius: 8 }}
          />
          <button onClick={() => loadAssignments(false)} disabled={assignLoading} style={{ padding: "8px 12px" }}>
            {assignLoading ? "조회중..." : "검색"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <select
            value={selectedAssignmentId}
            onChange={(e) => setSelectedAssignmentId(e.target.value)}
            style={{ width: 520, padding: 8, border: "1px solid #ddd", borderRadius: 8 }}
          >
            <option value="">배정 선택...</option>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id} / {a.siteName ?? a.siteId} / {a.userName ?? a.userId}
              </option>
            ))}
          </select>

          <div style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>
            <div>선택 배정: {selectedAssignment ? `#${selectedAssignment.id}` : "-"}</div>
            <div>Site: {selectedAssignment?.siteName ?? "-"}</div>
            <div>Coach: {selectedAssignment?.userName ?? "-"}</div>
          </div>
        </div>
      </section>

      {/* Doc settings */}
      <section style={{ backgroundColor: "#fff", borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#333", minWidth: 120 }}>문서 설정</div>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#444" }}>문서 타입</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
              <option value="TRAINING_DAILY_LOG">TRAINING_DAILY_LOG (단순 업무일지)</option>
              {/* 향후 확장 */}
            </select>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#444" }}>기간 시작</span>
            <input type="date" value={periodStartDate} onChange={(e) => setPeriodStartDate(e.target.value)} />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#444" }}>기간 종료</span>
            <input type="date" value={periodEndDate} onChange={(e) => setPeriodEndDate(e.target.value)} />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#444" }}>마감(dueAt)</span>
            <input type="date" value={dueAtDate} onChange={(e) => setDueAtDate(e.target.value)} />
          </label>

          <button onClick={onCreateRun} disabled={runLoading || !selectedAssignmentId} style={{ padding: "8px 12px" }}>
            {runLoading ? "처리중..." : "Run 생성"}
          </button>
        </div>
      </section>

      {/* Runs */}
      <section style={{ backgroundColor: "#fff", borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#333", minWidth: 120 }}>Run 목록</div>
          <button onClick={() => loadRuns()} disabled={runLoading} style={{ padding: "8px 12px" }}>
            {runLoading ? "조회중..." : "새로고침"}
          </button>
          <div style={{ fontSize: 13, color: "#444" }}>
            선택 Run: {selectedRun ? `#${selectedRun.id}` : "-"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            style={{ width: 520, padding: 8, border: "1px solid #ddd", borderRadius: 8 }}
          >
            <option value="">Run 선택...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.id} / {r.docType} / {new Date(r.periodStart).toLocaleDateString()}~{new Date(r.periodEnd).toLocaleDateString()} / due {new Date(r.dueAt).toLocaleDateString()}
              </option>
            ))}
          </select>

          <div style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>
            <div>Status: {selectedRun?.status ?? "-"}</div>
            <div>OpenAt: {selectedRun ? new Date(selectedRun.openAt).toLocaleString() : "-"}</div>
            <div>CurrentVersionId: {selectedRun?.currentVersionId ?? "-"}</div>
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Versions */}
        <section style={{ backgroundColor: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>Version</div>
            <button
              onClick={() => selectedRunId && loadVersions(selectedRunId)}
              disabled={!selectedRunId || versionsLoading}
              style={{ padding: "6px 10px" }}
            >
              {versionsLoading ? "조회중..." : "새로고침"}
            </button>
            <div style={{ fontSize: 13, color: "#444" }}>
              최신: {latestVersion ? `v${latestVersion.versionNo}(${latestVersion.stage})` : "-"}
            </div>
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>버전 생성</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#444" }}>Stage</span>
                <select value={newStage} onChange={(e) => setNewStage(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
                  <option value="PRE">PRE</option>
                  <option value="FINAL">FINAL</option>
                </select>
              </label>

              <input
                value={newPdfUrl}
                onChange={(e) => setNewPdfUrl(e.target.value)}
                placeholder="pdfUrl (필수)"
                style={{ flex: 1, minWidth: 220, padding: 8, border: "1px solid #ddd", borderRadius: 8 }}
              />
            </div>

            <input
              value={newPdfFileName}
              onChange={(e) => setNewPdfFileName(e.target.value)}
              placeholder="pdfFileName (선택)"
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 8, marginBottom: 8 }}
            />

            <textarea
              value={newSourceDataText}
              onChange={(e) => setNewSourceDataText(e.target.value)}
              placeholder="sourceData JSON"
              rows={6}
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 8, fontFamily: "monospace", fontSize: 12 }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={onCreateVersion} disabled={!selectedRunId || versionsLoading} style={{ padding: "8px 12px" }}>
                {versionsLoading ? "처리중..." : "Version 생성"}
              </button>
            </div>
          </div>

          <div style={{ fontSize: 13, color: "#444", marginBottom: 8 }}>목록</div>
          <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid #eee", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>No</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Stage</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>PDF</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>v{v.versionNo}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{v.stage}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
                      <a href={v.pdfUrl} target="_blank" rel="noreferrer">
                        open
                      </a>
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{new Date(v.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {versions.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 10, color: "#777" }}>
                      버전이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Submission logs */}
        <section style={{ backgroundColor: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>제출 로그</div>
            <button
              onClick={() => selectedRunId && loadLogs(selectedRunId)}
              disabled={!selectedRunId || logsLoading}
              style={{ padding: "6px 10px" }}
            >
              {logsLoading ? "조회중..." : "새로고침"}
            </button>
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>제출</div>

            <div style={{ fontSize: 12, color: "#444", marginBottom: 8 }}>
              제출 대상 버전: {latestVersion ? `v${latestVersion.versionNo} (${latestVersion.stage})` : "-"}
            </div>

            <input
              value={submitEmail}
              onChange={(e) => setSubmitEmail(e.target.value)}
              placeholder="sentToEmail (선택)"
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 8, marginBottom: 8 }}
            />

            <input
              value={submitStatus}
              onChange={(e) => setSubmitStatus(e.target.value)}
              placeholder="emailStatus (예: SENT)"
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 8, marginBottom: 8 }}
            />

            <textarea
              value={submitPayloadText}
              onChange={(e) => setSubmitPayloadText(e.target.value)}
              placeholder="emailPayload JSON"
              rows={6}
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 8, fontFamily: "monospace", fontSize: 12 }}
            />

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => onSubmit("PRE")} disabled={!selectedRunId || logsLoading || !latestVersion} style={{ padding: "8px 12px" }}>
                PRE 제출 로그
              </button>
              <button onClick={() => onSubmit("FINAL")} disabled={!selectedRunId || logsLoading || !latestVersion} style={{ padding: "8px 12px" }}>
                FINAL 제출 로그
              </button>
            </div>
          </div>

          <div style={{ fontSize: 13, color: "#444", marginBottom: 8 }}>목록</div>
          <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid #eee", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>At</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Stage</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Email</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{new Date(l.submittedAt).toLocaleString()}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{l.stage}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{l.sentToEmail ?? "-"}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{l.emailStatus ?? "-"}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 10, color: "#777" }}>
                      제출 로그가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
