"use client";
// app/admin/payroll/page.tsx
// 관리자 급여 관리 — 계약 등록 / 월별 계산 / 명세 확정

import { useEffect, useState } from "react";
import { sharedStyles } from "../_styles";

// ── 타입 ──────────────────────────────────────────────────────────────
type PayType = "MONTHLY" | "DAILY" | "HOURLY";
type RunStatus = "DRAFT" | "FINALIZED";

interface Contract {
  id: string; userId: string; userName: string; loginId: string;
  payType: PayType; baseAmount: number;
  effectiveFrom: string; effectiveTo: string | null;
}

interface RunSummary {
  id: string; yearMonth: string; status: RunStatus;
  itemCount: number; createdAt: string; finalizedAt: string | null;
}

interface RunItem {
  id: string; userId: string; userName: string; loginId: string;
  grossPay: number; totalDeduction: number; netPay: number;
  workedDays: number; workedMinutes: number; breakdown: any;
}

interface RunDetail extends RunSummary {
  items: RunItem[];
  totalGrossPay: number; totalDeduction: number; totalNetPay: number;
}

interface Coach { id: string; userName: string; }

// ── 유틸 ──────────────────────────────────────────────────────────────
function comma(n: number) { return n.toLocaleString("ko-KR"); }
function fmtMin(m: number) {
  if (!m) return "-";
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
function pad2(n: number) { return String(n).padStart(2, "0"); }
function defaultYM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
const payTypeLabel: Record<PayType, string> = { MONTHLY: "월급", DAILY: "일급", HOURLY: "시급" };

// ── 메인 ──────────────────────────────────────────────────────────────
type Tab = "contracts" | "runs";

export default function PayrollPage() {
  const T = sharedStyles();
  const [tab, setTab] = useState<Tab>("contracts");

  // ── 계약 탭 상태
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ userId: "", payType: "HOURLY" as PayType, baseAmount: "", effectiveFrom: "", effectiveTo: "" });
  const [saving, setSaving] = useState(false);

  // ── 급여 실행 탭 상태
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [calcYM, setCalcYM] = useState(defaultYM());
  const [calculating, setCalculating] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [editItem, setEditItem] = useState<RunItem | null>(null);
  const [editGross, setEditGross] = useState("");
  const [editDed, setEditDed] = useState("");
  const [finalizing, setFinalizing] = useState(false);

  // ── 계약 목록 로드
  async function loadContracts() {
    setLoadingContracts(true);
    try {
      const res = await fetch("/api/admin/payroll/contracts");
      const d = await res.json();
      if (d.success) setContracts(d.data);
    } finally { setLoadingContracts(false); }
  }

  // ── 직무지도원 목록 로드
  async function loadCoaches() {
    const res = await fetch("/api/admin/coaches?pageSize=200");
    const d = await res.json();
    if (d.success) setCoaches((d.data || []).map((c: any) => ({ id: c.id, userName: c.userName })));
  }

  // ── 급여 실행 목록 로드
  async function loadRuns() {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/admin/payroll/runs");
      const d = await res.json();
      if (d.success) setRuns(d.data);
    } finally { setLoadingRuns(false); }
  }

  useEffect(() => {
    if (tab === "contracts") { loadContracts(); loadCoaches(); }
    else { loadRuns(); }
  }, [tab]);

  // ── 계약 저장
  async function handleSaveContract() {
    if (!form.userId || !form.baseAmount || !form.effectiveFrom) {
      alert("직무지도원, 금액, 적용 시작일은 필수입니다."); return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payroll/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, baseAmount: Number(form.baseAmount) }),
      });
      const d = await res.json();
      if (d.success) { setShowForm(false); setForm({ userId: "", payType: "HOURLY", baseAmount: "", effectiveFrom: "", effectiveTo: "" }); loadContracts(); }
      else alert(d.message);
    } finally { setSaving(false); }
  }

  // ── 계약 삭제
  async function handleDeleteContract(id: string) {
    if (!confirm("계약을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/admin/payroll/contracts/${id}`, { method: "DELETE" });
    const d = await res.json();
    if (d.success) loadContracts();
    else alert(d.message);
  }

  // ── 급여 계산
  async function handleCalculate() {
    if (!confirm(`${calcYM} 급여를 계산할까요?\n기존 DRAFT 데이터가 있으면 재계산됩니다.`)) return;
    setCalculating(true);
    try {
      const res = await fetch("/api/admin/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth: calcYM }),
      });
      const d = await res.json();
      if (d.success) { loadRuns(); alert(`${d.itemCount}명 계산 완료`); }
      else alert(d.message);
    } finally { setCalculating(false); }
  }

  // ── 실행 상세 로드
  async function loadRunDetail(runId: string) {
    setLoadingRun(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}`);
      const d = await res.json();
      if (d.success) setSelectedRun(d.data);
    } finally { setLoadingRun(false); }
  }

  // ── 항목 수정 저장
  async function handleSaveEdit() {
    if (!editItem || !selectedRun) return;
    const res = await fetch(`/api/admin/payroll/runs/${selectedRun.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: editItem.id, grossPay: Number(editGross), totalDeduction: Number(editDed) }),
    });
    const d = await res.json();
    if (d.success) {
      setSelectedRun(prev => prev ? {
        ...prev,
        items: prev.items.map(i => i.id === editItem.id ? d.item : i),
        totalGrossPay: prev.items.map(i => i.id === editItem.id ? d.item : i).reduce((s, i) => s + i.grossPay, 0),
        totalDeduction: prev.items.map(i => i.id === editItem.id ? d.item : i).reduce((s, i) => s + i.totalDeduction, 0),
        totalNetPay: prev.items.map(i => i.id === editItem.id ? d.item : i).reduce((s, i) => s + i.netPay, 0),
      } : null);
      setEditItem(null);
    } else alert(d.message);
  }

  // ── 확정
  async function handleFinalize() {
    if (!selectedRun) return;
    if (!confirm(`${selectedRun.yearMonth} 급여를 최종 확정하시겠습니까?\n확정 후에는 수정할 수 없습니다.`)) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${selectedRun.id}`, { method: "POST" });
      const d = await res.json();
      if (d.success) {
        setSelectedRun(prev => prev ? { ...prev, status: "FINALIZED", finalizedAt: d.finalizedAt } : null);
        loadRuns();
        alert("확정 완료! 직무지도원이 급여명세를 조회할 수 있습니다.");
      } else alert(d.message);
    } finally { setFinalizing(false); }
  }

  // ── 탭 버튼
  const tabBtn = (t: Tab, label: string) => (
    <button onClick={() => setTab(t)} style={{
      padding: "7px 20px", borderRadius: 8, border: "1px solid",
      borderColor: tab === t ? "#111827" : "#e5e7eb",
      background: tab === t ? "#111827" : "#fff",
      color: tab === t ? "#fff" : "#374151",
      fontWeight: 600, fontSize: 13, cursor: "pointer",
    }}>{label}</button>
  );

  // ──────────────────── 렌더 ────────────────────
  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={T.pageTitle}>급여 관리</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {tabBtn("contracts", "💰 급여 계약")}
          {tabBtn("runs", "📊 급여 계산")}
        </div>
      </div>

      {/* ── 계약 탭 ────────────────────────────────────────── */}
      {tab === "contracts" && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button style={T.btnPrimary} onClick={() => setShowForm(v => !v)}>
              {showForm ? "취소" : "+ 계약 등록"}
            </button>
          </div>

          {showForm && (
            <div style={{ ...T.card, marginBottom: 16, background: "#f9fafb" }}>
              <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 14, color: "#374151" }}>급여 계약 등록</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>직무지도원</label>
                  <select value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} style={{ ...T.input, width: "100%", height: 38 }}>
                    <option value="">선택</option>
                    {coaches.map(c => <option key={c.id} value={c.id}>{c.userName}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>급여 유형</label>
                  <select value={form.payType} onChange={e => setForm(f => ({ ...f, payType: e.target.value as PayType }))} style={{ ...T.input, width: "100%", height: 38 }}>
                    <option value="HOURLY">시급</option>
                    <option value="DAILY">일급</option>
                    <option value="MONTHLY">월급</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>금액 (원)</label>
                  <input type="number" value={form.baseAmount} onChange={e => setForm(f => ({ ...f, baseAmount: e.target.value }))}
                    placeholder={form.payType === "HOURLY" ? "예: 12000" : form.payType === "DAILY" ? "예: 96000" : "예: 2200000"}
                    style={{ ...T.input, width: "100%" }} />
                </div>
                <div>
                  <label style={labelStyle}>적용 시작일</label>
                  <input type="date" value={form.effectiveFrom} onChange={e => setForm(f => ({ ...f, effectiveFrom: e.target.value }))} style={{ ...T.input, width: "100%" }} />
                </div>
                <div>
                  <label style={labelStyle}>적용 종료일 (선택)</label>
                  <input type="date" value={form.effectiveTo} onChange={e => setForm(f => ({ ...f, effectiveTo: e.target.value }))} style={{ ...T.input, width: "100%" }} />
                </div>
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                <button style={T.btnPrimary} onClick={handleSaveContract} disabled={saving}>
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button style={T.btnSecondary} onClick={() => setShowForm(false)}>취소</button>
              </div>
            </div>
          )}

          {loadingContracts ? (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>로딩 중...</p>
          ) : contracts.length === 0 ? (
            <div style={T.tableWrap}><p style={T.tdCenter}>등록된 급여 계약이 없습니다.</p></div>
          ) : (
            <div style={T.tableWrap}>
              <table style={T.table}>
                <thead>
                  <tr>
                    {["직무지도원", "급여 유형", "금액", "적용 기간", ""].map(h => (
                      <th key={h} style={T.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <tr key={c.id} style={T.tr}>
                      <td style={T.td}>
                        <div style={{ fontWeight: 600 }}>{c.userName}</div>
                        <div style={{ fontSize: 12, color: "#9ca3af" }}>{c.loginId}</div>
                      </td>
                      <td style={T.td}>
                        <span style={{ ...T.badge, background: "#eff6ff", color: "#2563eb" }}>{payTypeLabel[c.payType]}</span>
                      </td>
                      <td style={{ ...T.td, fontWeight: 700, color: "#111827" }}>
                        {comma(c.baseAmount)}원{c.payType === "HOURLY" ? "/시간" : c.payType === "DAILY" ? "/일" : "/월"}
                      </td>
                      <td style={{ ...T.td, fontSize: 12, color: "#6b7280" }}>
                        {c.effectiveFrom} ~ {c.effectiveTo || "현재"}
                      </td>
                      <td style={T.td}>
                        <button style={T.btnDanger} onClick={() => handleDeleteContract(c.id)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── 급여 계산 탭 ────────────────────────────────────── */}
      {tab === "runs" && !selectedRun && (
        <>
          {/* 급여 계산 액션 */}
          <div style={{ ...T.card, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label style={labelStyle}>계산 월</label>
              <input type="month" value={calcYM} onChange={e => setCalcYM(e.target.value)}
                style={{ ...T.input, width: "auto" }} />
            </div>
            <button style={T.btnPrimary} onClick={handleCalculate} disabled={calculating}>
              {calculating ? "계산 중..." : "⚡ 급여 계산"}
            </button>
            <p style={{ margin: 0, fontSize: 12, color: "#9ca3af", alignSelf: "center" }}>
              출퇴근 기록과 급여 계약을 기반으로 자동 계산합니다. 기존 DRAFT는 재계산됩니다.
            </p>
          </div>

          {loadingRuns ? (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>로딩 중...</p>
          ) : runs.length === 0 ? (
            <div style={T.tableWrap}><p style={T.tdCenter}>급여 계산 내역이 없습니다.</p></div>
          ) : (
            <div style={T.tableWrap}>
              <table style={T.table}>
                <thead>
                  <tr>
                    {["연월", "상태", "대상 인원", "생성일", "확정일", ""].map(h => (
                      <th key={h} style={T.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.id} style={T.tr}>
                      <td style={{ ...T.td, fontWeight: 700 }}>{r.yearMonth}</td>
                      <td style={T.td}>
                        {r.status === "FINALIZED"
                          ? <span style={{ ...T.badge, background: "#f0fdf4", color: "#16a34a" }}>확정</span>
                          : <span style={{ ...T.badge, background: "#fffbeb", color: "#d97706" }}>초안</span>}
                      </td>
                      <td style={T.td}>{r.itemCount}명</td>
                      <td style={{ ...T.td, fontSize: 12, color: "#6b7280" }}>{r.createdAt.slice(0, 10)}</td>
                      <td style={{ ...T.td, fontSize: 12, color: "#6b7280" }}>{r.finalizedAt ? r.finalizedAt.slice(0, 10) : "-"}</td>
                      <td style={T.td}>
                        <button style={T.btnSecondary} onClick={() => loadRunDetail(r.id)}>상세 보기</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── 급여 실행 상세 ────────────────────────────────────── */}
      {tab === "runs" && selectedRun && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <button style={T.btnSecondary} onClick={() => setSelectedRun(null)}>← 목록</button>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>
              {selectedRun.yearMonth} 급여명세
              <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 400, color: selectedRun.status === "FINALIZED" ? "#16a34a" : "#d97706" }}>
                {selectedRun.status === "FINALIZED" ? "● 확정" : "● 초안"}
              </span>
            </h2>
            {selectedRun.status === "DRAFT" && (
              <button style={{ ...T.btnPrimary, marginLeft: "auto", background: "#16a34a" }}
                onClick={handleFinalize} disabled={finalizing}>
                {finalizing ? "처리 중..." : "✅ 급여 확정"}
              </button>
            )}
          </div>

          {/* 합계 카드 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
            {[
              { label: "총 지급액", value: selectedRun.totalGrossPay, color: "#2563eb" },
              { label: "총 공제액", value: selectedRun.totalDeduction, color: "#dc2626" },
              { label: "총 실지급액", value: selectedRun.totalNetPay, color: "#16a34a" },
            ].map((c, i) => (
              <div key={i} style={T.summaryCard}>
                <p style={{ ...T.summaryNum, fontSize: 20, color: c.color }}>{comma(Math.round(c.value))}원</p>
                <p style={T.summaryLabel}>{c.label}</p>
              </div>
            ))}
          </div>

          {loadingRun ? (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>로딩 중...</p>
          ) : (
            <div style={T.tableWrap}>
              <table style={T.table}>
                <thead>
                  <tr>
                    {["직무지도원", "근무일수", "근무시간", "지급액", "공제액(3.3%)", "실지급액", ""].map(h => (
                      <th key={h} style={T.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedRun.items.map(item => (
                    <tr key={item.id} style={T.tr}>
                      <td style={T.td}>
                        <div style={{ fontWeight: 600 }}>{item.userName}</div>
                        <div style={{ fontSize: 12, color: "#9ca3af" }}>{item.loginId}</div>
                        {(item.breakdown as any)?.payType && (
                          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                            {payTypeLabel[(item.breakdown as any).payType as PayType]}
                            {(item.breakdown as any).hourlyRate && ` ${comma((item.breakdown as any).hourlyRate)}원/h`}
                            {(item.breakdown as any).dailyRate && ` ${comma((item.breakdown as any).dailyRate)}원/일`}
                          </div>
                        )}
                        {(item.breakdown as any)?.note && (
                          <div style={{ fontSize: 11, color: "#f59e0b" }}>⚠ {(item.breakdown as any).note}</div>
                        )}
                      </td>
                      <td style={{ ...T.td, textAlign: "center" }}>{item.workedDays}일</td>
                      <td style={{ ...T.td, textAlign: "center" }}>{fmtMin(item.workedMinutes)}</td>
                      <td style={{ ...T.td, fontWeight: 600, color: "#2563eb", textAlign: "right" }}>{comma(Math.round(item.grossPay))}원</td>
                      <td style={{ ...T.td, color: "#dc2626", textAlign: "right" }}>-{comma(Math.round(item.totalDeduction))}원</td>
                      <td style={{ ...T.td, fontWeight: 700, color: "#16a34a", textAlign: "right" }}>{comma(Math.round(item.netPay))}원</td>
                      <td style={T.td}>
                        {selectedRun.status === "DRAFT" && (
                          <button style={T.btnSecondary} onClick={() => {
                            setEditItem(item);
                            setEditGross(String(Math.round(item.grossPay)));
                            setEditDed(String(Math.round(item.totalDeduction)));
                          }}>수정</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedRun.status === "FINALIZED" && selectedRun.finalizedAt && (
            <p style={{ marginTop: 10, fontSize: 12, color: "#9ca3af", textAlign: "right" }}>
              확정일: {new Date(selectedRun.finalizedAt).toLocaleString("ko-KR")}
            </p>
          )}
        </>
      )}

      {/* ── 항목 수정 모달 ────────────────────────────────────── */}
      {editItem && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
            <p style={{ margin: "0 0 16px", fontWeight: 700, fontSize: 16, color: "#111827" }}>
              {editItem.userName} 급여 수정
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>지급액 (원)</label>
              <input type="number" value={editGross} onChange={e => setEditGross(e.target.value)} style={{ ...T.input, width: "100%" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>공제액 (원)</label>
              <input type="number" value={editDed} onChange={e => setEditDed(e.target.value)} style={{ ...T.input, width: "100%" }} />
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>
                실지급액: {comma(Math.max(0, Number(editGross) - Number(editDed)))}원
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={T.btnPrimary} onClick={handleSaveEdit}>저장</button>
              <button style={T.btnSecondary} onClick={() => setEditItem(null)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4,
};
