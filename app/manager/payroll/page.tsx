"use client";

import { useEffect, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";

function maskLoginId(id: string) {
  if (!id) return "";
  if (id.includes("@")) {
    const [local, domain] = id.split("@");
    if (local.length <= 2) return id;
    return `${local[0]}${"*".repeat(Math.min(local.length - 2, 4))}${local[local.length - 1]}@${domain}`;
  }
  const digits = id.replace(/\D/g, "");
  if (digits.length >= 10)
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  return id;
}

type PayType = "MONTHLY" | "DAILY" | "HOURLY";
type IncomeType = "BUSINESS" | "EMPLOYMENT";
type WorkerType = "INTERNAL" | "EXTERNAL";
type RunStatus = "DRAFT" | "FINALIZED";
type DeductionType = "FIXED" | "PERCENTAGE";

interface Contract {
  id: string; workerId: string; workerName: string; loginId: string;
  workerType: WorkerType; payType: PayType; baseAmount: number; incomeType: IncomeType;
  hourlyRate2Plus: number | null; weeklyHolidayPay: number | null;
  effectiveFrom: string; effectiveTo: string | null;
}

interface Deduction {
  id: string; name: string; type: DeductionType; amount: number; isActive: boolean;
}

interface RunSummary {
  id: string; yearMonth: string; status: RunStatus;
  itemCount: number; createdAt: string; finalizedAt: string | null;
}

interface RunItem {
  id: string; workerId: string; workerName: string; loginId: string;
  grossPay: number; totalDeduction: number; netPay: number;
  workedDays: number; workedMinutes: number; breakdown: any;
}

interface RunDetail extends RunSummary {
  items: RunItem[];
  totalGrossPay: number; totalDeduction: number; totalNetPay: number;
}

interface Worker { id: string; workerName: string; }

function comma(n: number) { return Math.round(n).toLocaleString("ko-KR"); }
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
const incomeTypeLabel: Record<IncomeType, string> = { BUSINESS: "사업소득(3.3%)", EMPLOYMENT: "근로소득(4대보험)" };

type Tab = "contracts" | "runs" | "deductions";

const initialForm = {
  workerId: "", workerType: "EXTERNAL" as WorkerType, payType: "HOURLY" as PayType,
  baseAmount: "", incomeType: "BUSINESS" as IncomeType,
  hourlyRate2Plus: "", weeklyHolidayPay: "", effectiveFrom: "", effectiveTo: "",
};

export default function PayrollPage() {
  const [tab, setTab] = useState<Tab>("contracts");

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);

  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loadingDed, setLoadingDed] = useState(false);
  const [showDedForm, setShowDedForm] = useState(false);
  const [dedForm, setDedForm] = useState({ name: "", type: "FIXED" as DeductionType, amount: "" });
  const [savingDed, setSavingDed] = useState(false);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [calcYM, setCalcYM] = useState(defaultYM());
  const [calculating, setCalculating] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [editItem, setEditItem] = useState<RunItem | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  async function loadContracts() {
    setLoadingContracts(true);
    try {
      const res = await fetch("/api/admin/payroll/contracts");
      const d = await res.json();
      if (d.success) setContracts(d.data);
    } finally { setLoadingContracts(false); }
  }

  async function loadWorkers() {
    const res = await fetch("/api/admin/workers?pageSize=200");
    const d = await res.json();
    if (d.success) setWorkers((d.data || []).map((c: any) => ({ id: c.id, workerName: c.workerName })));
  }

  async function loadRuns() {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/admin/payroll/runs");
      const d = await res.json();
      if (d.success) setRuns(d.data);
    } finally { setLoadingRuns(false); }
  }

  async function loadDeductions() {
    setLoadingDed(true);
    try {
      const res = await fetch("/api/admin/payroll/deductions");
      const d = await res.json();
      if (d.success) setDeductions(d.data);
    } finally { setLoadingDed(false); }
  }

  useEffect(() => {
    if (tab === "contracts") { loadContracts(); loadWorkers(); }
    else if (tab === "runs") loadRuns();
    else loadDeductions();
  }, [tab]);

  async function handleSaveContract() {
    if (!form.workerId || !form.baseAmount || !form.effectiveFrom) {
      alert("직무지도원, 금액, 적용 시작일은 필수입니다."); return;
    }
    setSaving(true);
    try {
      const body: any = {
        workerId: form.workerId, workerType: form.workerType, payType: form.payType,
        baseAmount: Number(form.baseAmount), incomeType: form.incomeType,
        effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo || null,
      };
      if (form.payType === "HOURLY" && form.hourlyRate2Plus) {
        body.hourlyRate2Plus = Number(form.hourlyRate2Plus);
      }
      if (form.weeklyHolidayPay) body.weeklyHolidayPay = Number(form.weeklyHolidayPay);

      const res = await fetch("/api/admin/payroll/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.success) {
        setShowForm(false);
        setForm(initialForm);
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

  async function handleSaveDeduction() {
    if (!dedForm.name || !dedForm.amount) { alert("항목명과 금액/비율은 필수입니다."); return; }
    if (dedForm.type === "PERCENTAGE" && (Number(dedForm.amount) < 0 || Number(dedForm.amount) > 100)) {
      alert("비율은 0~100 사이로 입력하세요 (예: 1 = 1%)."); return;
    }
    setSavingDed(true);
    try {
      const amount = dedForm.type === "PERCENTAGE" ? Number(dedForm.amount) / 100 : Number(dedForm.amount);
      const res = await fetch("/api/admin/payroll/deductions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: dedForm.name, type: dedForm.type, amount }),
      });
      const d = await res.json();
      if (d.success) {
        setShowDedForm(false);
        setDedForm({ name: "", type: "FIXED", amount: "" });
        loadDeductions();
      } else alert(d.message);
    } finally { setSavingDed(false); }
  }

  async function handleDeleteDeduction(id: string) {
    if (!confirm("공제 항목을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/admin/payroll/deductions/${id}`, { method: "DELETE" });
    const d = await res.json();
    if (d.success) loadDeductions(); else alert(d.message);
  }

  async function toggleDeductionActive(ded: Deduction) {
    const res = await fetch(`/api/admin/payroll/deductions/${ded.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !ded.isActive }),
    });
    const d = await res.json();
    if (d.success) loadDeductions(); else alert(d.message);
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

  function handleEditSaved(updated: RunItem) {
    setSelectedRun(prev => prev ? {
      ...prev,
      items: prev.items.map((i: RunItem) => i.id === updated.id ? updated : i),
      totalGrossPay: prev.items.reduce((s, i) => s + (i.id === updated.id ? updated.grossPay : i.grossPay), 0),
      totalDeduction: prev.items.reduce((s, i) => s + (i.id === updated.id ? updated.totalDeduction : i.totalDeduction), 0),
      totalNetPay: prev.items.reduce((s, i) => s + (i.id === updated.id ? updated.netPay : i.netPay), 0),
    } : null);
    setEditItem(null);
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
    { key: "deductions", label: "⚙️ 공제 설정" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="급여 관리 (Pro+)"
        actions={
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
        }
      />

      {/* ── 계약 탭 ── */}
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
                  <select value={form.workerId} onChange={e => setForm(f => ({ ...f, workerId: e.target.value }))} className={`w-full ${T.select}`}>
                    <option value="">선택</option>
                    {workers.map(c => <option key={c.id} value={c.id}>{c.workerName}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>직무지도원 유형</label>
                  <select value={form.workerType} onChange={e => {
                    const ct = e.target.value as WorkerType;
                    setForm(f => ({
                      ...f, workerType: ct,
                      payType: ct === "INTERNAL" ? "DAILY" : (f.payType === "DAILY" ? "HOURLY" : f.payType),
                      incomeType: ct === "INTERNAL" ? "BUSINESS" : f.incomeType,
                      hourlyRate2Plus: ct === "INTERNAL" ? "" : f.hourlyRate2Plus,
                      weeklyHolidayPay: ct === "INTERNAL" ? "" : f.weeklyHolidayPay,
                    }));
                  }} className={`w-full ${T.select}`}>
                    <option value="EXTERNAL">외부 직무지도원</option>
                    <option value="INTERNAL">내부 직무지도원 (일급 고정)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>소득 유형</label>
                  <select value={form.incomeType} disabled={form.workerType === "INTERNAL"}
                    onChange={e => setForm(f => ({ ...f, incomeType: e.target.value as IncomeType }))} className={`w-full ${T.select} disabled:opacity-50`}>
                    <option value="BUSINESS">사업소득 (3.3% 공제)</option>
                    <option value="EMPLOYMENT">근로소득 (4대보험)</option>
                  </select>
                  {form.workerType === "INTERNAL" && (
                    <p className="text-[11px] font-semibold text-slate-400">※ 내부 직무지도원은 사업소득만 적용</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>급여 유형</label>
                  <select value={form.payType} disabled={form.workerType === "INTERNAL"}
                    onChange={e => setForm(f => ({ ...f, payType: e.target.value as PayType }))} className={`w-full ${T.select} disabled:opacity-50`}>
                    {form.workerType === "EXTERNAL" && <option value="HOURLY">시급</option>}
                    <option value="DAILY">일급</option>
                    {form.workerType === "EXTERNAL" && <option value="MONTHLY">월급</option>}
                  </select>
                  {form.workerType === "INTERNAL" && (
                    <p className="text-[11px] font-semibold text-slate-400">※ 내부 직무지도원은 일급만 적용</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>{form.payType === "HOURLY" ? "시급 (원)" : form.payType === "DAILY" ? "일급 (원)" : "월급 (원)"}</label>
                  <input type="number" value={form.baseAmount}
                    onChange={e => setForm(f => ({ ...f, baseAmount: e.target.value }))}
                    placeholder={form.payType === "HOURLY" ? "예: 10030 (2025 최저임금)" : form.payType === "DAILY" ? "예: 25000" : "예: 2200000"}
                    className={`w-full ${T.input}`} />
                </div>

                {form.workerType === "EXTERNAL" && form.payType === "HOURLY" && (
                  <div className="space-y-1.5">
                    <label className={T.label}>훈련생 2명 이상 시급 (원)</label>
                    <input type="number" value={form.hourlyRate2Plus}
                      onChange={e => setForm(f => ({ ...f, hourlyRate2Plus: e.target.value }))}
                      placeholder="예: 12036 (최저임금×120%)"
                      className={`w-full ${T.input}`} />
                    <p className="text-[11px] font-semibold text-slate-400">※ 공단 기준: 2명 이상 동시 지도 시 최저시급의 120%</p>
                  </div>
                )}

                {form.workerType === "EXTERNAL" && (
                  <div className="space-y-1.5">
                    <label className={T.label}>주휴수당 (원, 선택)</label>
                    <input type="number" value={form.weeklyHolidayPay}
                      onChange={e => setForm(f => ({ ...f, weeklyHolidayPay: e.target.value }))}
                      placeholder="해당되는 경우만 입력"
                      className={`w-full ${T.input}`} />
                    <p className="text-[11px] font-semibold text-slate-400">※ 주 5일 근무 시 법적 주휴수당 (월 급여 계산 시 가산)</p>
                  </div>
                )}

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
                  <tr>{["직무지도원", "소득/급여유형", "금액", "적용 기간", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <tr key={c.id} className={T.trBase}>
                      <td className={T.td}>
                        <div className="font-black text-slate-900">{c.workerName}</div>
                        <div className="text-xs text-slate-400">{maskLoginId(c.loginId)}</div>
                      </td>
                      <td className={T.td}>
                        <div className="flex flex-wrap gap-1">
                          <span className={`${T.badge} ${c.workerType === "INTERNAL" ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-600"}`}>
                            {c.workerType === "INTERNAL" ? "내부" : "외부"}
                          </span>
                          <span className={`${T.badge} ${c.incomeType === "EMPLOYMENT" ? "bg-purple-50 text-purple-600" : "bg-sky-50 text-sky-600"}`}>
                            {c.incomeType === "EMPLOYMENT" ? "근로소득" : "사업소득"}
                          </span>
                          <span className={`${T.badge} bg-slate-50 text-slate-600`}>{payTypeLabel[c.payType]}</span>
                        </div>
                      </td>
                      <td className={`${T.td}`}>
                        <div className="font-black text-slate-900">
                          {comma(c.baseAmount)}원{c.payType === "HOURLY" ? "/h" : c.payType === "DAILY" ? "/일" : "/월"}
                        </div>
                        {c.hourlyRate2Plus != null && (
                          <div className="text-[11px] text-slate-500">2명+: {comma(c.hourlyRate2Plus)}원/h</div>
                        )}
                        {c.weeklyHolidayPay != null && (
                          <div className="text-[11px] text-slate-500">주휴: +{comma(c.weeklyHolidayPay)}원</div>
                        )}
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

      {/* ── 공제 설정 탭 ── */}
      {tab === "deductions" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <p className="mb-1 font-black text-slate-900">에이전시 공제 항목</p>
            <p>기본 공제(사업소득세 3.3% 또는 4대보험)에 추가로 에이전시별 특이한 공제가 있는 경우 등록합니다.</p>
            <p className="mt-1 text-xs text-slate-400">비율 공제는 소수로 저장됩니다. UI에서는 % 단위로 입력하세요 (예: 1 입력 → 1%).</p>
          </div>

          <div className="flex justify-end">
            <button className={T.btnPrimary} onClick={() => setShowDedForm(v => !v)}>
              {showDedForm ? "취소" : "+ 공제 항목 추가"}
            </button>
          </div>

          {showDedForm && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="mb-4 text-sm font-black text-slate-900">공제 항목 등록</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className={T.label}>항목명</label>
                  <input type="text" value={dedForm.name} onChange={e => setDedForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="예: 교통비 공제, 식비 공제" className={`w-full ${T.input}`} />
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>유형</label>
                  <select value={dedForm.type} onChange={e => setDedForm(f => ({ ...f, type: e.target.value as DeductionType }))} className={`w-full ${T.select}`}>
                    <option value="FIXED">고정 금액 (원)</option>
                    <option value="PERCENTAGE">비율 (%)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={T.label}>{dedForm.type === "FIXED" ? "금액 (원)" : "비율 (%)"}</label>
                  <input type="number" value={dedForm.amount} onChange={e => setDedForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder={dedForm.type === "FIXED" ? "예: 50000" : "예: 1 (= 1%)"}
                    className={`w-full ${T.input}`} />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button className={T.btnPrimary} onClick={handleSaveDeduction} disabled={savingDed}>
                  {savingDed ? "저장 중..." : "저장"}
                </button>
                <button className={T.btnSecondary} onClick={() => setShowDedForm(false)}>취소</button>
              </div>
            </div>
          )}

          {loadingDed ? (
            <p className={T.empty}>로딩 중...</p>
          ) : deductions.length === 0 ? (
            <div className={T.tableWrap}><p className={T.tdCenter}>등록된 공제 항목이 없습니다.</p></div>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["항목명", "유형", "금액/비율", "상태", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {deductions.map(d => (
                    <tr key={d.id} className={T.trBase}>
                      <td className={`${T.td} font-black text-slate-900`}>{d.name}</td>
                      <td className={T.td}>
                        <span className={`${T.badge} bg-slate-50 text-slate-600`}>
                          {d.type === "FIXED" ? "고정" : "비율"}
                        </span>
                      </td>
                      <td className={`${T.td} text-slate-700`}>
                        {d.type === "FIXED" ? `${comma(d.amount)}원` : `${(d.amount * 100).toFixed(2)}%`}
                      </td>
                      <td className={T.td}>
                        <button onClick={() => toggleDeductionActive(d)}
                          className={`${T.badge} cursor-pointer border-0 transition hover:opacity-70 ${d.isActive ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                          {d.isActive ? "활성" : "비활성"}
                        </button>
                      </td>
                      <td className={T.td}>
                        <button className={T.btnDanger} onClick={() => handleDeleteDeduction(d.id)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 급여 계산 탭 - 목록 ── */}
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
              출퇴근 기록·급여 계약·공제 설정을 기반으로 자동 계산합니다.
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

      {/* ── 급여 실행 상세 ── */}
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
                <p className={`text-xl font-black leading-none ${c.cls}`}>{comma(c.value)}원</p>
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
                  <tr>{["직무지도원", "근무일수", "근무시간", "지급액", "공제액", "실지급액", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {selectedRun.items.map(item => {
                    const bd = item.breakdown as any;
                    const incType: IncomeType = bd?.incomeType ?? "BUSINESS";
                    const dedBreakdown: Record<string, number> = bd?.deductionBreakdown ?? {};
                    return (
                      <tr key={item.id} className={T.trBase}>
                        <td className={T.td}>
                          <div className="font-black text-slate-900">{item.workerName}</div>
                          <div className="text-xs text-slate-400">{maskLoginId(item.loginId)}</div>
                          {bd?.payType && (
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              <span className={`mr-1 ${T.badge} ${incType === "EMPLOYMENT" ? "bg-purple-50 text-purple-600" : "bg-sky-50 text-sky-600"}`}>
                                {incType === "EMPLOYMENT" ? "근로소득" : "사업소득"}
                              </span>
                              {payTypeLabel[bd.payType as PayType]}
                              {bd.hourlyRate && ` ${comma(bd.hourlyRate)}원/h`}
                              {bd.used2PlusRate && ` (2명+ 적용)`}
                              {bd.dailyRate && ` ${comma(bd.dailyRate)}원/일`}
                              {bd.weeklyHolidayPay && ` +주휴${comma(bd.weeklyHolidayPay)}원`}
                            </div>
                          )}
                          {bd?.note && (
                            <div className="mt-0.5 text-[11px] font-semibold text-amber-600">⚠ {bd.note}</div>
                          )}
                        </td>
                        <td className={`${T.td} text-center text-slate-600`}>{item.workedDays}일</td>
                        <td className={`${T.td} text-center text-slate-600`}>{fmtMin(item.workedMinutes)}</td>
                        <td className={`${T.td} text-right font-black text-sky-600`}>{comma(item.grossPay)}원</td>
                        <td className={`${T.td} text-right`}>
                          <div className="text-rose-600 font-semibold">-{comma(item.totalDeduction)}원</div>
                          <div className="text-[10px] text-slate-400 space-y-0.5">
                            {Object.entries(dedBreakdown).map(([k, v]) => (
                              <div key={k}>{k}: {comma(v)}원</div>
                            ))}
                          </div>
                        </td>
                        <td className={`${T.td} text-right font-black text-emerald-600`}>{comma(item.netPay)}원</td>
                        <td className={T.td}>
                          <div className="flex items-center justify-end gap-1.5">
                            <a className={T.btnSecondary} href={`/api/admin/payroll/items/${item.id}/payslip`}
                              target="_blank" rel="noopener noreferrer">명세서</a>
                            {selectedRun.status === "DRAFT" && (
                              <button className={T.btnSecondary} onClick={() => setEditItem(item)}>수정</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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

      {/* ── 급여명세 그리드 편집 ── */}
      {editItem && selectedRun && (
        <PayslipGridEditor
          item={editItem}
          runId={selectedRun.id}
          year={Number(selectedRun.yearMonth.slice(0, 4))}
          onClose={() => setEditItem(null)}
          onSaved={handleEditSaved}
        />
      )}
    </div>
  );
}

// ── 급여명세 그리드 편집기 (샘플 양식: 지급내역·공제내역 라인아이템 + 부양가족수 소득세 자동조회) ──
type PayLine = { key: string; name: string; hours: number; amount: number; method?: string };
type DeductLine = { key: string; name: string; amount: number };

function PayslipGridEditor({ item, runId, year, onClose, onSaved }: {
  item: RunItem; runId: string; year: number; onClose: () => void; onSaved: (i: RunItem) => void;
}) {
  const bd = (item.breakdown ?? {}) as any;
  const [payLines, setPayLines] = useState<PayLine[]>(() =>
    Array.isArray(bd.payLines) && bd.payLines.length
      ? bd.payLines.map((l: any) => ({ key: l.key ?? "", name: l.name ?? "", hours: Number(l.hours) || 0, amount: Number(l.amount) || 0, method: l.method ?? "" }))
      : [{ key: "base", name: "기본급", hours: 0, amount: Math.round(item.grossPay), method: "" }]);
  const [deductLines, setDeductLines] = useState<DeductLine[]>(() =>
    Array.isArray(bd.deductLines) && bd.deductLines.length
      ? bd.deductLines.map((l: any) => ({ key: l.key ?? "", name: l.name ?? "", amount: Number(l.amount) || 0 }))
      : []);
  const [basic, setBasic] = useState(() => ({
    job: bd.basicInfo?.job ?? "직무지도",
    placementType: bd.basicInfo?.placementType ?? "",
    placementDate: bd.basicInfo?.placementDate ?? "",
    dependents: Number(bd.basicInfo?.dependents) || 1,
  }));
  const [saving, setSaving] = useState(false);
  const [taxNote, setTaxNote] = useState("");

  const gross = payLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const totalDed = deductLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const net = gross - totalDed;
  const totalHours = +payLines.reduce((s, l) => s + (Number(l.hours) || 0), 0).toFixed(1);

  const setPay = (i: number, f: keyof PayLine, v: any) =>
    setPayLines(prev => prev.map((l, idx) => idx === i ? { ...l, [f]: f === "name" || f === "method" ? v : Number(v) || 0 } : l));
  const setDed = (i: number, f: keyof DeductLine, v: any) =>
    setDeductLines(prev => prev.map((l, idx) => idx === i ? { ...l, [f]: f === "name" ? v : Number(v) || 0 } : l));

  async function refetchTax() {
    try {
      const res = await fetch(`/api/admin/payroll/income-tax/lookup?pay=${gross}&dependents=${basic.dependents}&year=${year}`);
      const d = await res.json();
      if (d.success && d.hasTable) {
        setDeductLines(prev => {
          let next = [...prev];
          const setOrAdd = (key: string, name: string, amount: number) => {
            const idx = next.findIndex(l => l.key === key);
            if (idx >= 0) next[idx] = { ...next[idx], amount };
            else next = [{ key, name, amount }, ...next];
          };
          setOrAdd("localTax", "주민세", d.localTax);
          setOrAdd("incomeTax", "소득세", d.incomeTax);
          return next;
        });
        setTaxNote(`${d.year}년 간이세액표 적용 (과세급여 ${comma(gross)}원·가족 ${basic.dependents}명): 소득세 ${comma(d.incomeTax)}원 / 주민세 ${comma(d.localTax)}원`);
      } else {
        setTaxNote("등록된 간이세액표가 없습니다. 운영자에게 등록을 요청하거나 소득세를 수동 입력하세요.");
      }
    } catch { setTaxNote("조회 실패"); }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/payroll/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, payLines, deductLines, basicInfo: basic }),
      });
      const d = await res.json();
      if (d.success) onSaved(d.item); else alert(d.message);
    } finally { setSaving(false); }
  }

  return (
    <div className={T.modalOverlay} onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-8 shadow-2xl shadow-slate-950/20" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">{item.workerName} 급여명세 편집</h2>
          <span className="text-sm font-semibold text-slate-400">근무 {item.workedDays}일 · {fmtMin(item.workedMinutes)}</span>
        </div>

        {/* 기본사항 */}
        <div className="mb-5 grid grid-cols-2 gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-4">
          <div><label className={T.label}>업무</label>
            <input value={basic.job} onChange={e => setBasic(b => ({ ...b, job: e.target.value }))} className={`w-full ${T.input}`} /></div>
          <div><label className={T.label}>배치형태</label>
            <input value={basic.placementType} onChange={e => setBasic(b => ({ ...b, placementType: e.target.value }))} className={`w-full ${T.input}`} /></div>
          <div><label className={T.label}>배치일</label>
            <input type="date" value={basic.placementDate} onChange={e => setBasic(b => ({ ...b, placementDate: e.target.value }))} className={`w-full ${T.input}`} /></div>
          <div><label className={T.label}>공제대상가족수</label>
            <div className="flex gap-1.5">
              <input type="number" min={1} max={11} value={basic.dependents}
                onChange={e => setBasic(b => ({ ...b, dependents: Math.max(1, Math.min(11, Number(e.target.value) || 1)) }))}
                className={`w-full ${T.input}`} />
              <button onClick={refetchTax} className={`${T.btnSecondary} whitespace-nowrap`} title="과세급여·가족수로 소득세 재조회">세액조회</button>
            </div>
          </div>
        </div>
        {taxNote && <p className="mb-4 rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">{taxNote}</p>}

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 지급내역 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900">지급내역</h3>
              <button onClick={() => setPayLines(p => [...p, { key: `c${Date.now()}`, name: "", hours: 0, amount: 0 }])}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50">+ 항목</button>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[1fr_64px_100px_28px] gap-1 bg-slate-50 px-2 py-1.5 text-[11px] font-black text-slate-400">
                <span>임금항목</span><span className="text-right">시간</span><span className="text-right">금액</span><span></span>
              </div>
              {payLines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_64px_100px_28px] items-center gap-1 border-t border-slate-50 px-2 py-1">
                  <input value={l.name} onChange={e => setPay(i, "name", e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-semibold outline-none focus:border-sky-400" />
                  <input type="number" value={l.hours || ""} onChange={e => setPay(i, "hours", e.target.value)} className="h-8 rounded-lg border border-slate-200 px-1.5 text-right text-xs outline-none focus:border-sky-400" />
                  <input type="number" value={l.amount || ""} onChange={e => setPay(i, "amount", e.target.value)} className="h-8 rounded-lg border border-slate-200 px-1.5 text-right text-xs font-semibold outline-none focus:border-sky-400" />
                  <button onClick={() => setPayLines(p => p.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-rose-500">✕</button>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_64px_100px_28px] gap-1 border-t border-slate-200 bg-slate-50 px-2 py-2 text-xs font-black">
                <span className="text-slate-600">총시간/급여총액</span><span className="text-right text-slate-600">{totalHours}</span><span className="text-right text-sky-700">{comma(gross)}</span><span></span>
              </div>
            </div>
          </div>

          {/* 공제내역 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900">공제내역</h3>
              <button onClick={() => setDeductLines(p => [...p, { key: `c${Date.now()}`, name: "", amount: 0 }])}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50">+ 항목</button>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[1fr_100px_28px] gap-1 bg-slate-50 px-2 py-1.5 text-[11px] font-black text-slate-400">
                <span>공제항목</span><span className="text-right">금액</span><span></span>
              </div>
              {deductLines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_28px] items-center gap-1 border-t border-slate-50 px-2 py-1">
                  <input value={l.name} onChange={e => setDed(i, "name", e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-semibold outline-none focus:border-sky-400" />
                  <input type="number" value={l.amount || ""} onChange={e => setDed(i, "amount", e.target.value)} className="h-8 rounded-lg border border-slate-200 px-1.5 text-right text-xs font-semibold outline-none focus:border-sky-400" />
                  <button onClick={() => setDeductLines(p => p.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-rose-500">✕</button>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_100px_28px] gap-1 border-t border-slate-200 bg-slate-50 px-2 py-2 text-xs font-black">
                <span className="text-slate-600">공제합계</span><span className="text-right text-rose-600">{comma(totalDed)}</span><span></span>
              </div>
            </div>
          </div>
        </div>

        {/* 당월지급액 */}
        <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-950 px-5 py-4">
          <span className="text-sm font-black text-slate-300">당월 지급액</span>
          <span className="text-2xl font-black text-white">{comma(net)}원</span>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className={T.btnSecondary} onClick={onClose}>취소</button>
          <button className={T.btnPrimary} onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}
