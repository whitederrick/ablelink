"use client";

import { useEffect, useState } from "react";
import { T } from "../_styles";

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

type Tab = "contracts" | "runs";

export default function PayrollPage() {
  const [tab, setTab] = useState<Tab>("contracts");

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ userId: "", payType: "HOURLY" as PayType, baseAmount: "", effectiveFrom: "", effectiveTo: "" });
  const [saving, setSaving] = useState(false);

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

  async function loadContracts() {
    setLoadingContracts(true);
    try {
      const res = await fetch("/api/admin/payroll/contracts");
      const d = await res.json();
      if (d.success) setContracts(d.data);
    } finally { setLoadingContracts(false); }
  }

  async function loadCoaches() {
    const res = await fetch("/api/admin/coaches?pageSize=200");
    const d = await res.json();
    if (d.success) setCoaches((d.data || []).map((c: any) => ({ id: c.id, userName: c.userName })));
  }

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

  async function handleSaveContract() {
    if (!form.userId || !form.baseAmount || !form.effectiveFrom) {
      alert("직무지도원, 금액, 적용 시작일은 필수입니다."); return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payroll/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, baseAmount: Number(form.baseAmount) }),
      });
      const d = await res.json();
      if (d.success) {
        setShowForm(false);
        setForm({ userId: "", payType: "HOURLY", baseAmount: "", effectiveFrom: "", effectiveTo: "" });
        loadContracts();
      } else alert(d.message);
    } finally { setSaving(false); }
  }

  async function handleDeleteContract(id: string) {
    if (!confirm("계약을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/admin/payroll/contracts/${id}`, { method: "DELETE" });
    const d = await res.json();
    if (d.success) loadContracts(); else alert(d.message);
  }

  async function handleCalculate() {
    if (!confirm(`${calcYM} 급여를 계산할까요?\n기존 DRAFT 데이터가 있으면 재계산됩니다.`)) return;
    setCalculating(true);
    try {
      const res = await fetch("/api/admin/payroll/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth: calcYM }),
      });
      const d = await res.json();
      if (d.success) { loadRuns(); alert(`${d.itemCount}명 계산 완료`); }
      else alert(d.message);
    } finally { setCalculating(false); }
  }

  async function loadRunDetail(runId: string) {
    setLoadingRun(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}`);
      const d = await res.json();
      if (d.success) setSelectedRun(d.data);
    } finally { setLoadingRun(false); }
  }

  async function handleSaveEdit() {
    if (!editItem || !selectedRun) return;
    const res = await fetch(`/api/admin/payroll/runs/${selectedRun.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
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

  const TAB_ITEMS: { key: Tab; label: string }[] = [
    { key: "contracts", label: "💰 급여 계약" },
    { key: "runs",      label: "📊 급여 계산" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={T.pageTitle}>급여 관리</h1>
        <div className="flex gap-2">
          {TAB_ITEMS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                tab === key ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 계약 탭 */}
      {tab === "contracts" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className={T.btnPrimary} onClick={() => setShowForm(v => !v)}>
              {showForm ? "취소" : "+ 계약 등록"}
            </button>
          </div>

          {showForm && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="mb-4 text-sm font-black text-slate-900">급여 계약 등록</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={T.label}>직무지도원</label>
                  <select value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} className={`w-full ${T.select}`}>
                    <option value="">선택</option>
                    {coaches.map(c => <option key={c.id} value={c.id}>{c.userName}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>급여 유형</label>
                  <select value={form.payType} onChange={e => setForm(f => ({ ...f, payType: e.target.value as PayType }))} className={`w-full ${T.select}`}>
                    <option value="HOURLY">시급</option>
                    <option value="DAILY">일급</option>
                    <option value="MONTHLY">월급</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>금액 (원)</label>
                  <input type="number" value={form.baseAmount}
                    onChange={e => setForm(f => ({ ...f, baseAmount: e.target.value }))}
                    placeholder={form.payType === "HOURLY" ? "예: 12000" : form.payType === "DAILY" ? "예: 96000" : "예: 2200000"}
                    className={`w-full ${T.input}`} />
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>적용 시작일</label>
                  <input type="date" value={form.effectiveFrom} onChange={e => setForm(f => ({ ...f, effectiveFrom: e.target.value }))} className={`w-full ${T.input}`} />
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>적용 종료일 (선택)</label>
                  <input type="date" value={form.effectiveTo} onChange={e => setForm(f => ({ ...f, effectiveTo: e.target.value }))} className={`w-full ${T.input}`} />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button className={T.btnPrimary} onClick={handleSaveContract} disabled={saving}>
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button className={T.btnSecondary} onClick={() => setShowForm(false)}>취소</button>
              </div>
            </div>
          )}

          {loadingContracts ? (
            <p className={T.empty}>로딩 중...</p>
          ) : contracts.length === 0 ? (
            <div className={T.tableWrap}><p className={T.tdCenter}>등록된 급여 계약이 없습니다.</p></div>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["직무지도원", "급여 유형", "금액", "적용 기간", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <tr key={c.id} className={T.trBase}>
                      <td className={T.td}>
                        <div className="font-black text-slate-900">{c.userName}</div>
                        <div className="text-xs text-slate-400">{c.loginId}</div>
                      </td>
                      <td className={T.td}>
                        <span className={`${T.badge} bg-sky-50 text-sky-600`}>{payTypeLabel[c.payType]}</span>
                      </td>
                      <td className={`${T.td} font-black text-slate-900`}>
                        {comma(c.baseAmount)}원{c.payType === "HOURLY" ? "/시간" : c.payType === "DAILY" ? "/일" : "/월"}
                      </td>
                      <td className={`${T.td} text-xs text-slate-500`}>{c.effectiveFrom} ~ {c.effectiveTo || "현재"}</td>
                      <td className={T.td}>
                        <button className={T.btnDanger} onClick={() => handleDeleteContract(c.id)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 급여 계산 탭 - 목록 */}
      {tab === "runs" && !selectedRun && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="space-y-1.5">
              <label className={T.label}>계산 월</label>
              <input type="month" value={calcYM} onChange={e => setCalcYM(e.target.value)} className={`w-auto ${T.input}`} />
            </div>
            <button className={T.btnPrimary} onClick={handleCalculate} disabled={calculating}>
              {calculating ? "계산 중..." : "⚡ 급여 계산"}
            </button>
            <p className="self-center text-xs font-semibold text-slate-400">
              출퇴근 기록과 급여 계약을 기반으로 자동 계산합니다. 기존 DRAFT는 재계산됩니다.
            </p>
          </div>

          {loadingRuns ? (
            <p className={T.empty}>로딩 중...</p>
          ) : runs.length === 0 ? (
            <div className={T.tableWrap}><p className={T.tdCenter}>급여 계산 내역이 없습니다.</p></div>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["연월", "상태", "대상 인원", "생성일", "확정일", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.id} className={T.trBase}>
                      <td className={`${T.td} font-black text-slate-900`}>{r.yearMonth}</td>
                      <td className={T.td}>
                        {r.status === "FINALIZED"
                          ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>확정</span>
                          : <span className={`${T.badge} bg-amber-50 text-amber-600`}>초안</span>}
                      </td>
                      <td className={`${T.td} text-slate-600`}>{r.itemCount}명</td>
                      <td className={`${T.td} text-xs text-slate-400`}>{r.createdAt.slice(0, 10)}</td>
                      <td className={`${T.td} text-xs text-slate-400`}>{r.finalizedAt ? r.finalizedAt.slice(0, 10) : "-"}</td>
                      <td className={T.td}>
                        <button className={T.btnSecondary} onClick={() => loadRunDetail(r.id)}>상세 보기</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 급여 실행 상세 */}
      {tab === "runs" && selectedRun && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button className={T.btnSecondary} onClick={() => setSelectedRun(null)}>← 목록</button>
            <h2 className="text-base font-black text-slate-900">
              {selectedRun.yearMonth} 급여명세
              <span className={`ml-2 text-sm font-semibold ${selectedRun.status === "FINALIZED" ? "text-emerald-600" : "text-amber-600"}`}>
                ● {selectedRun.status === "FINALIZED" ? "확정" : "초안"}
              </span>
            </h2>
            {selectedRun.status === "DRAFT" && (
              <button className="ml-auto rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white transition hover:bg-emerald-700 active:scale-95 disabled:opacity-60"
                onClick={handleFinalize} disabled={finalizing}>
                {finalizing ? "처리 중..." : "✅ 급여 확정"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "총 지급액",   value: selectedRun.totalGrossPay,  cls: "text-sky-600" },
              { label: "총 공제액",   value: selectedRun.totalDeduction,  cls: "text-rose-600" },
              { label: "총 실지급액", value: selectedRun.totalNetPay,     cls: "text-emerald-600" },
            ].map((c, i) => (
              <div key={i} className={T.summaryCard}>
                <p className={`text-xl font-black leading-none ${c.cls}`}>{comma(Math.round(c.value))}원</p>
                <p className={T.summaryLabel}>{c.label}</p>
              </div>
            ))}
          </div>

          {loadingRun ? (
            <p className={T.empty}>로딩 중...</p>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["직무지도원", "근무일수", "근무시간", "지급액", "공제액(3.3%)", "실지급액", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {selectedRun.items.map(item => (
                    <tr key={item.id} className={T.trBase}>
                      <td className={T.td}>
                        <div className="font-black text-slate-900">{item.userName}</div>
                        <div className="text-xs text-slate-400">{item.loginId}</div>
                        {(item.breakdown as any)?.payType && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {payTypeLabel[(item.breakdown as any).payType as PayType]}
                            {(item.breakdown as any).hourlyRate && ` ${comma((item.breakdown as any).hourlyRate)}원/h`}
                            {(item.breakdown as any).dailyRate && ` ${comma((item.breakdown as any).dailyRate)}원/일`}
                          </div>
                        )}
                        {(item.breakdown as any)?.note && (
                          <div className="mt-0.5 text-[11px] font-semibold text-amber-600">⚠ {(item.breakdown as any).note}</div>
                        )}
                      </td>
                      <td className={`${T.td} text-center text-slate-600`}>{item.workedDays}일</td>
                      <td className={`${T.td} text-center text-slate-600`}>{fmtMin(item.workedMinutes)}</td>
                      <td className={`${T.td} text-right font-black text-sky-600`}>{comma(Math.round(item.grossPay))}원</td>
                      <td className={`${T.td} text-right text-rose-600`}>-{comma(Math.round(item.totalDeduction))}원</td>
                      <td className={`${T.td} text-right font-black text-emerald-600`}>{comma(Math.round(item.netPay))}원</td>
                      <td className={T.td}>
                        {selectedRun.status === "DRAFT" && (
                          <button className={T.btnSecondary} onClick={() => {
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
            <p className="text-right text-xs font-semibold text-slate-400">
              확정일: {new Date(selectedRun.finalizedAt).toLocaleString("ko-KR")}
            </p>
          )}
        </div>
      )}

      {/* 항목 수정 모달 */}
      {editItem && (
        <div className={T.modalOverlay} onClick={() => setEditItem(null)}>
          <div className={T.modalContent} onClick={e => e.stopPropagation()}>
            <h2 className="mb-5 text-base font-black text-slate-900">{editItem.userName} 급여 수정</h2>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className={T.label}>지급액 (원)</label>
                <input type="number" value={editGross} onChange={e => setEditGross(e.target.value)} className={`w-full ${T.input}`} />
              </div>
              <div className="space-y-1.5">
                <label className={T.label}>공제액 (원)</label>
                <input type="number" value={editDed} onChange={e => setEditDed(e.target.value)} className={`w-full ${T.input}`} />
                <p className="text-xs font-semibold text-slate-400">
                  실지급액: {comma(Math.max(0, Number(editGross) - Number(editDed)))}원
                </p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button className={T.btnPrimary} onClick={handleSaveEdit}>저장</button>
              <button className={T.btnSecondary} onClick={() => setEditItem(null)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
