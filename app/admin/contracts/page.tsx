"use client";
// app/admin/contracts/page.tsx
// 근로계약서 관리 — 생성/발송/목록 조회

import { useEffect, useState } from "react";
import { sharedStyles } from "../_styles";

type WorkType = "AM" | "PM" | "FULL_DAY" | "CUSTOM" | "";
type ContractStatus = "PENDING" | "SIGNED" | "COMPLETED" | "CANCELLED";

interface ContractItem {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  contractStart: string;
  contractEnd: string;
  siteName: string | null;
  workType: string | null;
  status: ContractStatus;
  signToken: string;
  coachSignedAt: string | null;
  adminSignedAt: string | null;
  createdAt: string;
}

interface CoachOption {
  id: string;
  userName: string;
  phoneNumber: string;
}

const STATUS_LABEL: Record<ContractStatus, { label: string; color: string; bg: string }> = {
  PENDING:   { label: "서명 대기",    color: "#d97706", bg: "#fffbeb" },
  SIGNED:    { label: "직무지도원 서명", color: "#2563eb", bg: "#eff6ff" },
  COMPLETED: { label: "계약 완료",    color: "#16a34a", bg: "#f0fdf4" },
  CANCELLED: { label: "취소",        color: "#6b7280", bg: "#f9fafb" },
};

const WORK_TYPE_LABELS: Record<string, string> = {
  AM:       "오전 4H (09:00~12:00)",
  PM:       "오후 4H (13:00~17:00)",
  FULL_DAY: "전일 8H (09:00~18:00)",
  CUSTOM:   "직접 입력",
};

function CreateContractModal({ coaches, onClose, onCreated }: {
  coaches: CoachOption[];
  onClose: () => void;
  onCreated: (item: ContractItem, url: string) => void;
}) {
  const [userId, setUserId]       = useState("");
  const [contractStart, setStart] = useState("");
  const [contractEnd, setEnd]     = useState("");
  const [siteName, setSiteName]   = useState("");
  const [workType, setWorkType]   = useState<WorkType>("FULL_DAY");
  const [commuteGuide, setCommuteGuide] = useState(true);
  const [customStart, setCustomStart]   = useState("09:00");
  const [customEnd, setCustomEnd]       = useState("18:00");
  const [adminMemo, setAdminMemo]       = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  async function handleCreate() {
    if (!userId || !contractStart || !contractEnd) {
      setError("직무지도원, 계약 시작일, 종료일은 필수입니다.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          contractStart,
          contractEnd,
          siteName: siteName || null,
          workType: workType || null,
          commuteGuidanceIncluded: workType === "FULL_DAY" ? false : commuteGuide,
          customWorkStart: workType === "CUSTOM" ? customStart : null,
          customWorkEnd:   workType === "CUSTOM" ? customEnd   : null,
          adminMemo: adminMemo || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert(data.message);
      onCreated({} as ContractItem, data.contractUrl);
      onClose();
    } catch (e: any) {
      setError(e.message || "생성에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 480, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 20px" }}>근로계약서 생성</h2>

        <div style={fm.field}>
          <label style={fm.label}>직무지도원 *</label>
          <select value={userId} onChange={e => setUserId(e.target.value)} style={fm.input}>
            <option value="">선택하세요</option>
            {coaches.map(c => (
              <option key={c.id} value={c.id}>{c.userName} ({c.phoneNumber})</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={fm.label}>계약 시작일 *</label>
            <input type="date" value={contractStart} onChange={e => setStart(e.target.value)} style={fm.input} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fm.label}>계약 종료일 *</label>
            <input type="date" value={contractEnd} onChange={e => setEnd(e.target.value)} style={fm.input} />
          </div>
        </div>

        <div style={fm.field}>
          <label style={fm.label}>근무 사업체명 (미입력 시 직무지도원이 직접 입력)</label>
          <input value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="사업체명" style={fm.input} />
        </div>

        <div style={fm.field}>
          <label style={fm.label}>근무형태 (미입력 시 직무지도원이 직접 입력)</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(["AM", "PM", "FULL_DAY", "CUSTOM", ""] as WorkType[]).map(wt => (
              <button
                key={wt || "none"}
                type="button"
                onClick={() => setWorkType(wt)}
                style={{ ...fm.typeBtn, ...(workType === wt ? fm.typeBtnActive : {}) }}
              >
                {wt ? WORK_TYPE_LABELS[wt] : "미정 (직무지도원 입력)"}
              </button>
            ))}
          </div>
        </div>

        {workType === "CUSTOM" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={fm.label}>근무 시작</label>
              <input type="time" value={customStart} onChange={e => setCustomStart(e.target.value)} style={fm.input} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fm.label}>근무 종료</label>
              <input type="time" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={fm.input} />
            </div>
          </div>
        )}

        {workType && workType !== "FULL_DAY" && workType !== "" && (
          <div style={{ ...fm.field, padding: "12px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={commuteGuide} onChange={e => setCommuteGuide(e.target.checked)} style={{ width: 17, height: 17, accentColor: "#2563eb" }} />
              <span style={{ fontSize: 14, color: "#374151" }}>출퇴근 지도 포함 (+60분) — 기본: 포함</span>
            </label>
          </div>
        )}
        {workType === "FULL_DAY" && (
          <div style={{ ...fm.field, padding: "10px 12px", background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca", fontSize: 13, color: "#dc2626" }}>
            전일 8시간 근무는 출퇴근/휴게 지도를 포함할 수 없습니다.
          </div>
        )}

        <div style={fm.field}>
          <label style={fm.label}>관리자 메모 (선택)</label>
          <textarea value={adminMemo} onChange={e => setAdminMemo(e.target.value)} placeholder="내부 메모" style={{ ...fm.input, height: 60, resize: "none" as const }} />
        </div>

        {error && <p style={{ color: "#dc2626", fontSize: 13, margin: "0 0 12px" }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={fm.cancelBtn}>취소</button>
          <button onClick={handleCreate} disabled={saving} style={{ ...fm.saveBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? "생성 중..." : "계약서 생성 및 발송"}
          </button>
        </div>
      </div>
    </div>
  );
}

const fm: Record<string, React.CSSProperties> = {
  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 6 },
  input: { width: "100%", height: 40, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 14, boxSizing: "border-box" as const, background: "#fff" },
  typeBtn: { padding: "9px 8px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 12, color: "#374151", textAlign: "center" as const },
  typeBtnActive: { border: "1.5px solid #2563eb", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, color: "#374151" },
  saveBtn: { padding: "9px 24px", border: "none", borderRadius: 8, background: "#2563eb", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#fff" },
};

export default function AdminContractsPage() {
  const T = sharedStyles();
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [coaches, setCoaches] = useState<CoachOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/contracts").then(r => r.json()),
      fetch("/api/admin/coaches?pageSize=200").then(r => r.json()),
    ]).then(([c, co]) => {
      if (c.success) setContracts(c.items);
      if (co.success && Array.isArray(co.data)) setCoaches(co.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function copyLink(token: string) {
    const url = `${baseUrl}/contract/${token}`;
    navigator.clipboard.writeText(url).then(() => alert("링크가 복사되었습니다."));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={T.pageTitle}>근로계약서 관리</h1>
          <p style={T.pageSub}>전자계약서 생성 및 발송 관리</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ padding: "9px 18px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
          + 계약서 생성
        </button>
      </div>

      {lastCreatedUrl && (
        <div style={{ marginBottom: 16, padding: "12px 16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#16a34a", margin: "0 0 4px" }}>계약서가 생성되었습니다</p>
            <p style={{ fontSize: 12, color: "#4b5563", margin: 0, wordBreak: "break-all" as const }}>{lastCreatedUrl}</p>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(lastCreatedUrl); alert("복사되었습니다."); }}
            style={{ padding: "6px 12px", border: "1px solid #bbf7d0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, color: "#16a34a", fontWeight: 600, whiteSpace: "nowrap" as const }}>
            링크 복사
          </button>
        </div>
      )}

      <div style={T.tableWrap}>
        <table style={T.table}>
          <thead>
            <tr>
              {["직무지도원", "계약 기간", "사업체", "근무형태", "상태", "서명일", "링크"].map(h => (
                <th key={h} style={T.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={T.tdCenter}>로딩 중...</td></tr>
            ) : contracts.length === 0 ? (
              <tr><td colSpan={7} style={T.tdCenter}>계약서가 없습니다.</td></tr>
            ) : contracts.map(c => {
              const st = STATUS_LABEL[c.status] ?? { label: c.status, color: "#6b7280", bg: "#f9fafb" };
              return (
                <tr key={c.id} style={T.tr}>
                  <td style={T.td}><strong>{c.userName}</strong><br /><span style={{ fontSize: 11, color: "#9ca3af" }}>{c.userPhone}</span></td>
                  <td style={{ ...T.td, fontSize: 12, color: "#6b7280" }}>
                    {c.contractStart?.slice(0, 10)}<br />~ {c.contractEnd?.slice(0, 10)}
                  </td>
                  <td style={{ ...T.td, fontSize: 13 }}>{c.siteName || <span style={{ color: "#d1d5db" }}>미지정</span>}</td>
                  <td style={{ ...T.td, fontSize: 12 }}>{c.workType ? (WORK_TYPE_LABELS[c.workType] ?? c.workType) : <span style={{ color: "#d1d5db" }}>미지정</span>}</td>
                  <td style={T.td}>
                    <span style={{ ...T.badge, background: st.bg, color: st.color }}>{st.label}</span>
                  </td>
                  <td style={{ ...T.td, fontSize: 12, color: "#6b7280" }}>
                    {c.coachSignedAt ? c.coachSignedAt.slice(0, 10) : "-"}
                  </td>
                  <td style={T.td}>
                    <button onClick={() => copyLink(c.signToken)} style={{ padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, color: "#2563eb" }}>
                      링크 복사
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateContractModal
          coaches={coaches}
          onClose={() => setShowCreate(false)}
          onCreated={(_, url) => {
            setLastCreatedUrl(url);
            fetch("/api/admin/contracts").then(r => r.json()).then(d => { if (d.success) setContracts(d.items); });
          }}
        />
      )}
    </div>
  );
}
