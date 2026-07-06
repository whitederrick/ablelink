"use client";

import { useEffect, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

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
  siteId: string | null; siteName: string | null;
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
function digitsOnly(s: string) { return String(s ?? "").replace(/[^\d]/g, ""); }
function commaStr(s: string) { const n = digitsOnly(s); return n ? Number(n).toLocaleString("ko-KR") : ""; }
function fmtMin(m: number) {
  if (!m) return "-";
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
function pad2(n: number) { return String(n).padStart(2, "0"); }
function defaultYM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function ymd(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
const payTypeLabel: Record<PayType, string> = { MONTHLY: "월급", DAILY: "일급", HOURLY: "시급" };
// 4대보험 가입 유형(자동 판정) — 라벨 + 툴팁 설명
const TIER_LABEL: Record<string, string> = {
  DAILY_WORKER: "일용",
  ULTRA_SHORT: "초단시간",
  REGULAR: "일반",
  NONE: "사업소득",
};
const TIER_DESC: Record<string, string> = {
  DAILY_WORKER: "1개월 미만 고용 — 고용보험·산재 가입",
  ULTRA_SHORT: "월 60시간·8일 미만 — 산재만(계속근로 3개월↑ 시 고용보험)",
  REGULAR: "월 60시간 이상 또는 8일 이상 — 4대보험 전부 가입",
  NONE: "사업소득(3.3%) — 4대보험 비대상",
};

// 시급 입력 시 자동 계산 — 공단 기준 2명 이상 동시지도 시급은 120%, 주휴수당은 시급×8시간(주40시간 기준).
const RATE_2PLUS_MULTIPLIER = 1.2;
const WEEKLY_HOLIDAY_HOURS = 8;
const MIN_WAGE_2026 = 10320; // 2026 최저시급(원) — 급여 기준 등록 기본값
function auto2Plus(base: number) { return base > 0 ? String(Math.round(base * RATE_2PLUS_MULTIPLIER)) : ""; }
function autoWeeklyHoliday(base: number) { return base > 0 ? String(Math.round(base * WEEKLY_HOLIDAY_HOURS)) : ""; }

const RUN_STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT:     { label: "초안", tone: "amber" },
  FINALIZED: { label: "확정", tone: "emerald" },
};
const PAGE_SIZE = 10;
const DETAIL_PAGE_SIZE = 10;

type Tab = "contracts" | "runs" | "deductions";

// 기본값: 외부·시급, 2026 최저시급(시급/120%/주휴 자동), 적용기간 오늘~+1년.
function makeInitialForm() {
  const start = new Date();
  const end = new Date(); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
  return {
    workerId: "", siteId: "", workerType: "EXTERNAL" as WorkerType, payType: "HOURLY" as PayType,
    baseAmount: String(MIN_WAGE_2026), incomeType: "BUSINESS" as IncomeType,
    hourlyRate2Plus: auto2Plus(MIN_WAGE_2026), weeklyHolidayPay: autoWeeklyHoliday(MIN_WAGE_2026),
    effectiveFrom: ymd(start), effectiveTo: ymd(end),
  };
}

export default function PayrollPage() {
  const [tab, setTab] = useState<Tab>("runs");

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(makeInitialForm);
  const [siteOptions, setSiteOptions] = useState<{ id: string; name: string }[]>([]); // 선택 워커의 현장(다시급 override용)
  const [saving, setSaving] = useState(false);
  const [cQuery, setCQuery] = useState("");
  const [cTypeFilter, setCTypeFilter] = useState<string[]>([]);
  const [cPage, setCPage] = useState(1);
  // 급여 기준 프리필 — 선택 워커의 근로계약서에서 끌어온 임금 정보(자동 입력 + 불일치 경고용)
  const [contractHint, setContractHint] = useState<{ wageType: PayType | null; wageAmount: number; status: string } | null>(null);
  // 자동 입력값 항목별 확인 — 시급/2인+시급/주휴를 각각 녹색 ✓로 확인해야 저장 가능(저빈도 등록이라 검토 유도)
  const [confirmed, setConfirmed] = useState({ base: false, rate2: false, weekly: false });
  const needRate2 = form.payType === "HOURLY";
  const needWeekly = form.payType !== "MONTHLY";
  const amountsConfirmed = confirmed.base && (!needRate2 || confirmed.rate2) && (!needWeekly || confirmed.weekly);
  const confirmChip = (k: "base" | "rate2" | "weekly") =>
    confirmed[k] ? (
      <span className="inline-flex shrink-0 items-center text-[12px] font-black text-emerald-600">✓ 확인됨</span>
    ) : (
      <button type="button" onClick={() => setConfirmed(c => ({ ...c, [k]: true }))}
        className="inline-flex shrink-0 items-center rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-[12px] font-black text-emerald-600 transition hover:bg-emerald-100">✓ 확인</button>
    );

  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loadingDed, setLoadingDed] = useState(false);
  const [showDedForm, setShowDedForm] = useState(false);
  const [dedForm, setDedForm] = useState({ name: "", type: "FIXED" as DeductionType, amount: "" });
  const [savingDed, setSavingDed] = useState(false);
  const [dQuery, setDQuery] = useState("");
  const [dPage, setDPage] = useState(1);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [rQuery, setRQuery] = useState("");
  const [rStatusFilter, setRStatusFilter] = useState<string[]>([]);
  const [rPage, setRPage] = useState(1);
  const [rYear, setRYear] = useState(new Date().getFullYear()); // 급여 내역 조회 연도(기본 올해)
  const [calcYM, setCalcYM] = useState(defaultYM());
  const [calculating, setCalculating] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [editItem, setEditItem] = useState<RunItem | null>(null);
  const [payslipItem, setPayslipItem] = useState<{ id: string; name: string } | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  async function loadContracts() {
    setLoadingContracts(true);
    try {
      const res = await fetch("/api/admin/payroll/contracts");
      const d = await res.json();
      if (d.success) setContracts(d.data);
    } finally { setLoadingContracts(false); }
  }

  const [backfilling, setBackfilling] = useState(false);
  async function handleBackfill() {
    if (!confirm("서명된 근로계약서가 있는데 급여 기준이 없는 직무지도원에게, 계약 정보(시급·기간)로 급여 기준을 일괄 생성합니다.\n이미 있는 직무지도원은 건너뜁니다. 진행할까요?")) return;
    setBackfilling(true);
    try {
      const d = await fetch("/api/admin/payroll/contracts/backfill", { method: "POST" }).then(r => r.json());
      if (d.success) { showToast(`✅ 급여 기준 ${d.created}건 생성 (건너뜀 ${d.skipped}건)`); loadContracts(); }
      else alert(d.message || "일괄 생성 실패");
    } catch { alert("일괄 생성 실패"); }
    finally { setBackfilling(false); }
  }

  async function loadWorkers() {
    const res = await fetch("/api/admin/workers?pageSize=200");
    const d = await res.json();
    if (d.success) setWorkers((d.data || []).map((c: any) => ({ id: c.id, workerName: c.workerName })));
  }

  // 워커 선택 시: 근로계약서(서명 완료 우선·최신)에서 시급·기간 자동 프리필.
  // 급여 전용 필드(직무지도원 유형·소득유형·공제)는 건드리지 않는다. 실패 시 수동 입력 가능.
  async function onPickWorker(workerId: string) {
    setForm(f => ({ ...f, workerId, siteId: "" }));
    setContractHint(null);
    setSiteOptions([]);
    setConfirmed({ base: false, rate2: false, weekly: false }); // 워커 변경 → 자동값 재확인 필요
    if (!workerId) return;
    // 다시급: 이 워커의 현장 목록(진행중 배정) → 현장별 금액 override 선택지.
    fetch(`/api/admin/assignments?workerId=${workerId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.items)) {
          const active = new Set(["ASSIGNED", "CONFIRMED", "ACTIVE"]);
          const uniq = new Map<string, string>();
          for (const it of d.items) if (active.has(it.status) && it.site?.id) uniq.set(String(it.site.id), it.site.companyName);
          setSiteOptions([...uniq].map(([id, name]) => ({ id, name })));
        }
      }).catch(() => {});
    try {
      const res = await fetch(`/api/admin/contracts?workerId=${workerId}`);
      const d = await res.json();
      if (!d.success || !Array.isArray(d.items)) return;
      const rank = (s: string) => (s === "COMPLETED" ? 0 : s === "SIGNED" ? 1 : 2);
      const cand = (d.items as any[])
        .filter(c => c.status !== "CANCELLED" && c.wageAmount != null && Number(c.wageAmount) > 0)
        .sort((a, b) => rank(a.status) - rank(b.status) || new Date(b.contractStart).getTime() - new Date(a.contractStart).getTime())[0];
      // 근로계약서가 없으면 프리랜서(사업소득) 기본값 제안. 있으면 근로소득 기본.
      if (!cand) { setForm(f => ({ ...f, incomeType: "BUSINESS" })); return; }
      const wt = (cand.wageType as PayType | null) ?? null;
      const base = Number(cand.wageAmount) || 0;
      setContractHint({ wageType: wt, wageAmount: base, status: cand.status });
      setForm(f => {
        // 내부 직무지도원은 일급 고정 → 계약서 임금형태가 와도 DAILY 유지
        const payType: PayType = f.workerType === "INTERNAL" ? "DAILY" : (wt ?? f.payType);
        const isHourly = f.workerType === "EXTERNAL" && payType === "HOURLY";
        return {
          ...f,
          baseAmount: String(base),
          payType,
          // 근로계약서 존재 → 근로소득 기본(사용자가 명시적으로 바꿀 수 있음)
          incomeType: "EMPLOYMENT" as IncomeType,
          effectiveFrom: String(cand.contractStart).slice(0, 10),
          effectiveTo: String(cand.contractEnd).slice(0, 10),
          hourlyRate2Plus: isHourly ? auto2Plus(base) : f.hourlyRate2Plus,
          weeklyHolidayPay: f.workerType === "EXTERNAL" ? autoWeeklyHoliday(base) : f.weeklyHolidayPay,
        };
      });
    } catch { /* 프리필 실패 무시 — 수동 입력 가능 */ }
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

  useEffect(() => { setDetailPage(1); }, [selectedRun?.id]);

  async function handleSaveContract() {
    if (!form.workerId || !form.baseAmount || !form.effectiveFrom) {
      alert("직무지도원, 금액, 적용 시작일은 필수입니다."); return;
    }
    setSaving(true);
    try {
      const body: any = {
        workerId: form.workerId, siteId: form.siteId || null,
        workerType: form.workerType, payType: form.payType,
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
        setForm(makeInitialForm());
        setContractHint(null);
        setConfirmed({ base: false, rate2: false, weekly: false });
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
      if (d.success) {
        showToast(`✅ ${calcYM} 급여 계산 완료 — ${d.itemCount}명. 아래에 계산 결과(급여명세)를 열었습니다.`);
        loadRuns();
        if (d.id) loadRunDetail(d.id);   // 계산 직후 결과 상세(급여명세)로 바로 이동
      }
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

  // 월 급여를 메인으로, 급여 기준·공제는 설정(보조)로 뒤에 배치
  const TAB_ITEMS: { key: Tab; label: string; group?: "settings" }[] = [
    { key: "runs",       label: "📊 월 급여" },
    { key: "contracts",  label: "💰 급여 기준", group: "settings" },
    { key: "deductions", label: "⚙️ 공제",     group: "settings" },
  ];

  // ── 계약 탭: 검색·유형필터·페이징 ──
  const internalCnt = contracts.filter(c => c.workerType === "INTERNAL").length;
  const externalCnt = contracts.filter(c => c.workerType === "EXTERNAL").length;
  const contractsFiltered = useMemo(() => {
    const q = cQuery.trim().toLowerCase();
    return contracts
      .filter(c => cTypeFilter.length === 0 || cTypeFilter.includes(c.workerType))
      .filter(c => !q || c.workerName.toLowerCase().includes(q) || c.loginId.toLowerCase().includes(q));
  }, [contracts, cQuery, cTypeFilter]);
  const cTotalPages = Math.max(1, Math.ceil(contractsFiltered.length / PAGE_SIZE));
  const cPageItems = contractsFiltered.slice((cPage - 1) * PAGE_SIZE, cPage * PAGE_SIZE);
  useEffect(() => { setCPage(1); }, [cQuery, cTypeFilter]);
  const toggleCType = (v: string) => setCTypeFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  // ── 계산 탭: 검색·상태필터·페이징 ──
  // 조회 연도 옵션 = 내역에 존재하는 연도 ∪ 올해(내림차순)
  const rYearOptions = useMemo(() => {
    const ys = new Set<number>(runs.map(r => Number(r.yearMonth.slice(0, 4))).filter(Boolean));
    ys.add(new Date().getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [runs]);
  // 선택 연도 내역 — 통계 카드·필터 칩 카운트도 연도 기준
  const runsOfYear = useMemo(() => runs.filter(r => Number(r.yearMonth.slice(0, 4)) === rYear), [runs, rYear]);
  const draftCnt = runsOfYear.filter(r => r.status === "DRAFT").length;
  const finalizedCnt = runsOfYear.filter(r => r.status === "FINALIZED").length;
  const runsFiltered = useMemo(() => {
    const q = rQuery.trim().toLowerCase();
    return runsOfYear
      .filter(r => rStatusFilter.length === 0 || rStatusFilter.includes(r.status))
      .filter(r => !q || r.yearMonth.toLowerCase().includes(q))
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));  // 월별(최근 월 먼저)
  }, [runsOfYear, rQuery, rStatusFilter]);
  const rTotalPages = Math.max(1, Math.ceil(runsFiltered.length / PAGE_SIZE));
  const rPageItems = runsFiltered.slice((rPage - 1) * PAGE_SIZE, rPage * PAGE_SIZE);
  useEffect(() => { setRPage(1); }, [rQuery, rStatusFilter, rYear]);
  const toggleRStatus = (v: string) => setRStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  // ── 공제 탭: 검색·페이징 ──
  const deductionsFiltered = useMemo(() => {
    const q = dQuery.trim().toLowerCase();
    return deductions.filter(d => !q || d.name.toLowerCase().includes(q));
  }, [deductions, dQuery]);
  const dTotalPages = Math.max(1, Math.ceil(deductionsFiltered.length / PAGE_SIZE));
  const dPageItems = deductionsFiltered.slice((dPage - 1) * PAGE_SIZE, dPage * PAGE_SIZE);
  useEffect(() => { setDPage(1); }, [dQuery]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="급여 관리 (Pro+)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {TAB_ITEMS.filter(t => !t.group).map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                  tab === key ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}>
                {label}
              </button>
            ))}
            <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden="true" />
            <span className="text-[11px] font-bold text-slate-400">설정</span>
            {TAB_ITEMS.filter(t => t.group === "settings").map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`rounded-xl border px-3 py-2 text-[13px] font-semibold transition active:scale-95 ${
                  tab === key ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
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
          <StatCardRow
            cols={3}
            items={[
              { label: "전체 급여 기준", value: contracts.length },
              { label: "외부 직무지도원", value: externalCnt, tone: "sky" },
              { label: "내부 직무지도원", value: internalCnt, tone: "amber" },
            ]}
          />

          <ListToolbar
            query={cQuery}
            onQueryChange={setCQuery}
            placeholder="직무지도원·아이디 검색"
            filters={[
              { value: "EXTERNAL", label: "외부", count: externalCnt },
              { value: "INTERNAL", label: "내부", count: internalCnt },
            ] as FilterChip[]}
            selected={cTypeFilter}
            onToggleFilter={toggleCType}
            extra={
              !showForm ? (
                <div className="ml-auto flex gap-2">
                  <button className={T.btnSecondary} onClick={handleBackfill} disabled={backfilling}>
                    {backfilling ? "생성 중..." : "📋 계약서에서 일괄 생성"}
                  </button>
                  <button className={T.btnPrimary} onClick={() => { setForm(makeInitialForm()); setContractHint(null); setConfirmed({ base: false, rate2: false, weekly: false }); setShowForm(true); }}>
                    + 급여 기준 등록
                  </button>
                </div>
              ) : null
            }
          />

          {showForm && (
            <div className={T.modalOverlay} onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); setContractHint(null); setConfirmed({ base: false, rate2: false, weekly: false }); } }}>
              <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20">
                <p className="mb-5 text-base font-black text-slate-900">급여 기준 등록</p>
                <div className="space-y-5">
                  {/* 대상 — 소득유형·내부/외부는 근로계약·근태로 자동 판정(입력 제거) */}
                  <section>
                    <p className="mb-2 text-xs font-black text-slate-500">대상</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className={T.label}>직무지도원</label>
                        <select value={form.workerId} onChange={e => onPickWorker(e.target.value)} className={`w-full ${T.select}`}>
                          <option value="">선택</option>
                          {workers.map(c => <option key={c.id} value={c.id}>{c.workerName}</option>)}
                        </select>
                        {contractHint && (
                          <p className="text-[11px] font-bold text-emerald-600">✓ 근로계약서에서 자동 입력됨 (아래에서 확인)</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <label className={T.label}>급여 유형</label>
                        <select value={form.payType} disabled={!!form.siteId}
                          onChange={e => setForm(f => {
                            const pt = e.target.value as PayType;
                            const base = Number(f.baseAmount) || 0;
                            const isHourly = pt === "HOURLY";
                            return isHourly
                              ? { ...f, payType: pt, hourlyRate2Plus: auto2Plus(base), weeklyHolidayPay: autoWeeklyHoliday(base) }
                              : { ...f, payType: pt, hourlyRate2Plus: "" };
                          })} className={`w-full ${T.select} ${form.siteId ? "opacity-60" : ""}`}>
                          <option value="HOURLY">시급</option>
                          <option value="DAILY">일급</option>
                          <option value="MONTHLY">월급</option>
                        </select>
                        <p className="text-[11px] font-semibold text-slate-400">
                          {form.siteId ? "현장별 금액은 기관 기본 계약과 같은 급여유형이어야 합니다(잠금)." : "4대보험 대상 여부는 근태·소득유형으로 급여 계산 시 자동 판정됩니다."}
                        </p>
                      </div>
                    </div>
                    {/* 같은 기관 다시급 — 현장별 금액 override. '기관 전체(기본)' 또는 특정 현장 선택. */}
                    {siteOptions.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <label className={T.label}>적용 현장 <span className="font-semibold text-slate-400">(같은 기관 다시급)</span></label>
                        <select value={form.siteId} onChange={e => {
                          const sid = e.target.value;
                          if (!sid) { setForm(f => ({ ...f, siteId: "" })); return; }
                          // 현장 override 선택 시 기관 기본계약(siteId=null·현재 유효)에서 급여유형·소득유형 상속(잠금).
                          //  기본계약 없으면(A1)·월급제면(A5) 서버가 400 → UI에서 선제 차단.
                          const today = ymd(new Date());
                          const base = contracts.find(c => c.workerId === form.workerId && c.siteId == null && (c.effectiveTo == null || c.effectiveTo >= today));
                          if (!base) { alert("먼저 '기관 전체' 기본 급여 기준을 등록한 뒤 현장별 금액을 추가하세요."); return; }
                          if (base.payType === "MONTHLY") { alert("월급제는 현장과 무관하게 월 급여가 지급되어 현장별 금액을 설정할 수 없습니다."); return; }
                          setForm(f => ({ ...f, siteId: sid, payType: base.payType, incomeType: base.incomeType }));
                        }} className={`w-full ${T.select}`}>
                          <option value="">기관 전체 (기본 급여 기준)</option>
                          {siteOptions.map(s => <option key={s.id} value={s.id}>{s.name} — 이 현장만 다른 금액</option>)}
                        </select>
                        {form.siteId
                          ? <p className="text-[11px] font-bold text-sky-600">이 현장 출근일에만 아래 <b>금액</b>이 적용됩니다. 급여유형·소득유형·4대보험은 <b>기관 기본 계약</b>을 따릅니다(잠금).</p>
                          : <p className="text-[11px] font-semibold text-slate-400">현장을 선택하면 그 현장만 다른 시급/일급을 적용할 수 있습니다(다시급). <b>월급제·기본계약 없음</b>은 제외됩니다.</p>}
                      </div>
                    )}

                    {/* 소득 유형 — 근로소득/사업소득(프리랜서 3.3%) 명시 선택. 워커 선택 시 근로계약 유무로 기본값 제안. */}
                    <div className="mt-3 space-y-1.5">
                      <label className={T.label}>소득 유형</label>
                      <select value={form.incomeType} disabled={!!form.siteId} onChange={e => setForm(f => ({ ...f, incomeType: e.target.value as IncomeType }))} className={`w-full ${T.select} ${form.siteId ? "opacity-60" : ""}`}>
                        <option value="EMPLOYMENT">근로소득 (4대보험·근로소득세)</option>
                        <option value="BUSINESS">사업소득 · 프리랜서 (3.3% 원천징수)</option>
                      </select>
                      {form.incomeType === "BUSINESS" && contractHint && (
                        <p className="text-[11px] font-bold text-amber-600">⚠ 이 직무지도원은 근로계약서가 있습니다. 근로계약이 있으면 사업소득(3.3%)은 위법 소지가 있어, 급여 계산 시 근로소득으로 자동 처리됩니다.</p>
                      )}
                      <p className="text-[11px] font-semibold text-slate-400">근로계약 기반 고용은 <b>근로소득</b>, 근로계약 없이 위촉된 프리랜서는 <b>사업소득(3.3%)</b>을 선택하세요.</p>
                    </div>
                  </section>

                  {/* 금액 — 각 입력칸 옆에서 ✓ 확인(저빈도 등록이라 검토 유도) */}
                  <section>
                    <p className="mb-2 text-xs font-black text-slate-500">금액</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className={T.label}>{form.payType === "HOURLY" ? "시급 (원)" : form.payType === "DAILY" ? "일급 (원)" : "월급 (원)"}</label>
                        <div className="flex items-center gap-2">
                          <input type="text" inputMode="numeric" value={commaStr(form.baseAmount)}
                            onChange={e => {
                              const v = digitsOnly(e.target.value);
                              const base = Number(v) || 0;
                              const isHourly = form.payType === "HOURLY";
                              // 시급 직접 입력 시 2명+ 시급(120%)·주휴수당(시급×8) 자동 재계산
                              setForm(f => isHourly
                                ? { ...f, baseAmount: v, hourlyRate2Plus: auto2Plus(base), weeklyHolidayPay: autoWeeklyHoliday(base) }
                                : { ...f, baseAmount: v });
                              setConfirmed(c => isHourly ? { base: true, rate2: false, weekly: false } : { ...c, base: true });
                            }}
                            placeholder={form.payType === "HOURLY" ? "예: 10,320 (2026 최저임금)" : form.payType === "DAILY" ? "예: 25,000" : "예: 2,200,000"}
                            className={`min-w-0 flex-1 ${T.input}`} />
                          {confirmChip("base")}
                        </div>
                        {contractHint && contractHint.wageType === form.payType && Number(form.baseAmount) !== contractHint.wageAmount && (
                          <p className="text-[11px] font-semibold text-amber-600">⚠ 근로계약서 금액({comma(contractHint.wageAmount)}원)과 다릅니다. 확인하세요.</p>
                        )}
                      </div>

                      {form.payType === "HOURLY" && (
                        <div className="space-y-1.5">
                          <label className={T.label}>훈련생 2명 이상 시급 (원)</label>
                          <div className="flex items-center gap-2">
                            <input type="text" inputMode="numeric" value={commaStr(form.hourlyRate2Plus)}
                              onChange={e => { const v = digitsOnly(e.target.value); setForm(f => ({ ...f, hourlyRate2Plus: v })); setConfirmed(c => ({ ...c, rate2: true })); }}
                              placeholder="예: 12,384 (최저임금×120%)"
                              className={`min-w-0 flex-1 ${T.input}`} />
                            {confirmChip("rate2")}
                          </div>
                          <p className="text-[11px] font-semibold text-slate-400">※ 시급의 120% 자동 계산 (공단 기준·2명 이상 동시지도, 수정 가능)</p>
                        </div>
                      )}

                      {form.payType !== "MONTHLY" && (
                        <div className="space-y-1.5">
                          <label className={T.label}>주휴수당 (원)</label>
                          <div className="flex items-center gap-2">
                            <input type="text" inputMode="numeric" value={commaStr(form.weeklyHolidayPay)}
                              onChange={e => { const v = digitsOnly(e.target.value); setForm(f => ({ ...f, weeklyHolidayPay: v })); setConfirmed(c => ({ ...c, weekly: true })); }}
                              placeholder="시급 입력 시 자동 계산"
                              className={`min-w-0 flex-1 ${T.input}`} />
                            {confirmChip("weekly")}
                          </div>
                          <p className="text-[11px] font-semibold text-slate-400">※ 시급 × 8시간 자동 계산 (주 40시간 기준, 수정 가능)</p>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* 적용 기간 */}
                  <section>
                    <p className="mb-2 text-xs font-black text-slate-500">적용 기간</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className={T.label}>적용 시작일</label>
                        <input type="date" value={form.effectiveFrom} onChange={e => setForm(f => ({ ...f, effectiveFrom: e.target.value }))} className={`w-full ${T.input}`} />
                      </div>
                      <div className="space-y-1.5">
                        <label className={T.label}>적용 종료일 (기본 1년)</label>
                        <input type="date" value={form.effectiveTo} onChange={e => setForm(f => ({ ...f, effectiveTo: e.target.value }))} className={`w-full ${T.input}`} />
                      </div>
                    </div>
                  </section>
                </div>

                <div className="mt-6 flex items-center justify-end gap-2">
                  {!amountsConfirmed && (
                    <span className="mr-auto text-[12px] font-semibold text-slate-400">금액 항목을 각각 ✓ 확인하면 저장할 수 있습니다.</span>
                  )}
                  <button className={T.btnSecondary} onClick={() => { setShowForm(false); setContractHint(null); setConfirmed({ base: false, rate2: false, weekly: false }); }}>취소</button>
                  <button className={T.btnPrimary} onClick={handleSaveContract} disabled={saving || !amountsConfirmed}
                    title={!amountsConfirmed ? "금액 항목을 ✓ 확인해주세요." : undefined}>
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loadingContracts ? (
            <p className={T.empty}>로딩 중...</p>
          ) : contractsFiltered.length === 0 ? (
            <div className={T.tableWrap}><p className={T.tdCenter}>{contracts.length === 0 ? "등록된 급여 기준이 없습니다." : "조건에 맞는 급여 기준이 없습니다."}</p></div>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["직무지도원 성명(아이디)", "소득/급여유형", "금액", "적용 기간", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {cPageItems.map(c => (
                    <tr key={c.id} className={T.trBase}>
                      <td className={`${T.td} whitespace-nowrap`}>
                        {c.workerName} <span className="text-[13px] text-slate-500">({maskLoginId(c.loginId)})</span>
                        {c.siteId
                          ? <span className="ml-1.5 inline-flex items-center rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-bold text-sky-600">📍 {c.siteName ?? "현장"}</span>
                          : <span className="ml-1.5 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">기관 전체</span>}
                      </td>
                      <td className={T.td}>
                        <div className="flex flex-wrap gap-1">
                          <span className={`${T.badge} ${c.workerType === "INTERNAL" ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-600"}`}>
                            {c.workerType === "INTERNAL" ? "내부" : "외부"}
                          </span>
                          <span className={`${T.badge} ${c.incomeType === "EMPLOYMENT" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}>
                            {c.incomeType === "EMPLOYMENT" ? "근로소득" : "사업소득"}
                          </span>
                          <span className={`${T.badge} bg-slate-50 text-slate-600`}>{payTypeLabel[c.payType]}</span>
                        </div>
                      </td>
                      <td className={`${T.td}`}>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-semibold">
                            {comma(c.baseAmount)}원{c.payType === "HOURLY" ? "/h" : c.payType === "DAILY" ? "/일" : "/월"}
                          </span>
                          {c.hourlyRate2Plus != null && (
                            <span className="text-[13px] text-slate-500">2명+ {comma(c.hourlyRate2Plus)}원/h</span>
                          )}
                          {c.weeklyHolidayPay != null && (
                            <span className="text-[13px] text-slate-500">주휴 +{comma(c.weeklyHolidayPay)}원</span>
                          )}
                        </div>
                      </td>
                      <td className={`${T.td} whitespace-nowrap`}>{c.effectiveFrom} ~ {c.effectiveTo || "현재"}</td>
                      <td className={T.td}>
                        <button className={T.btnDanger} onClick={() => handleDeleteContract(c.id)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination className="border-t border-slate-100 px-4 py-3" page={cPage} totalPages={cTotalPages} total={contractsFiltered.length} onPageChange={setCPage} />
            </div>
          )}
        </div>
      )}

      {/* ── 공제 설정 탭 ── */}
      {tab === "deductions" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <p className="mb-1 font-black text-slate-900">위탁기관 공제 항목</p>
            <p>기본 공제(사업소득세 3.3% 또는 4대보험)에 추가로 위탁기관별 특이한 공제가 있는 경우 등록합니다.</p>
            <p className="mt-1 text-xs text-slate-400">비율 공제는 소수로 저장됩니다. UI에서는 % 단위로 입력하세요 (예: 1 입력 → 1%).</p>
          </div>

          <ListToolbar
            query={dQuery}
            onQueryChange={setDQuery}
            placeholder="공제 항목명 검색"
            extra={
              <button className={T.btnPrimary} onClick={() => setShowDedForm(v => !v)}>
                {showDedForm ? "취소" : "+ 공제 항목 추가"}
              </button>
            }
          />

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
          ) : deductionsFiltered.length === 0 ? (
            <div className={T.tableWrap}><p className={T.tdCenter}>{deductions.length === 0 ? "등록된 공제 항목이 없습니다." : "조건에 맞는 항목이 없습니다."}</p></div>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["항목명", "유형", "금액/비율", "상태", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {dPageItems.map(d => (
                    <tr key={d.id} className={T.trBase}>
                      <td className={T.td}>{d.name}</td>
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
              <Pagination className="border-t border-slate-100 px-4 py-3" page={dPage} totalPages={dTotalPages} total={deductionsFiltered.length} onPageChange={setDPage} />
            </div>
          )}
        </div>
      )}

      {/* ── 급여 계산 탭 - 목록 ── */}
      {tab === "runs" && !selectedRun && (
        <div className="space-y-4">
          {/* 대시보드 카운트 — 맨 위(다른 화면과 동일) */}
          <StatCardRow
            cols={3}
            items={[
              { label: `${rYear}년 계산`, value: runsOfYear.length },
              { label: "초안", value: draftCnt, tone: "amber" },
              { label: "확정", value: finalizedCnt, tone: "emerald" },
            ]}
          />

          {/* 계산 월(좌) + 조회 툴바(우) 한 줄 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="whitespace-nowrap text-sm font-semibold text-slate-600">계산 월</label>
              <input type="month" value={calcYM} onChange={e => setCalcYM(e.target.value)} className={`w-auto ${T.input}`} />
              <button className={T.btnPrimary} onClick={handleCalculate} disabled={calculating}>
                {calculating ? "계산 중..." : "⚡ 급여 계산 실행"}
              </button>
            </div>
            <select value={rYear} onChange={e => setRYear(Number(e.target.value))} className={`w-auto ${T.select}`} title="조회 연도">
              {rYearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <div className="min-w-[260px] flex-1">
              <ListToolbar
                query={rQuery}
                onQueryChange={setRQuery}
                placeholder="연월 검색 (예: 06)"
                filters={[
                  { value: "DRAFT", label: "초안", count: draftCnt },
                  { value: "FINALIZED", label: "확정", count: finalizedCnt },
                ] as FilterChip[]}
                selected={rStatusFilter}
                onToggleFilter={toggleRStatus}
              />
            </div>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-2.5 text-xs font-semibold text-sky-700">
            월 선택 → <b>계산</b>(출근부·근로계약 기준 자동) → 검토(필요 시 수정) → <b>확정</b> 시 직무지도원에게 <b>명세서가 자동 발급</b>됩니다. 소득세·4대보험은 자동 산정됩니다.
          </div>

          {loadingRuns ? (
            <p className={T.empty}>로딩 중...</p>
          ) : runsFiltered.length === 0 ? (
            <div className={T.tableWrap}><p className={T.tdCenter}>{runs.length === 0 ? "급여 계산 내역이 없습니다." : "조건에 맞는 계산 내역이 없습니다."}</p></div>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["연월", "상태", "대상 인원", "생성일", "확정일", ""].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rPageItems.map(r => (
                    <tr key={r.id} className={T.trBase}>
                      <td className={`${T.td} font-semibold`}>{r.yearMonth}</td>
                      <td className={T.td}><StatusBadge status={r.status} map={RUN_STATUS_BADGE} /></td>
                      <td className={T.td}>{r.itemCount}명</td>
                      <td className={T.td}>{r.createdAt.slice(0, 10)}</td>
                      <td className={T.td}>{r.finalizedAt ? r.finalizedAt.slice(0, 10) : "-"}</td>
                      <td className={T.td}>
                        <button onClick={() => loadRunDetail(r.id)} className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-bold text-slate-600 hover:bg-slate-50">상세 보기</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination className="border-t border-slate-100 px-4 py-3" page={rPage} totalPages={rTotalPages} total={runsFiltered.length} onPageChange={setRPage} />
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

          <StatCardRow
            cols={3}
            items={[
              { label: "총 지급액",   value: `${comma(selectedRun.totalGrossPay)}원`,  tone: "sky" },
              { label: "총 공제액",   value: `${comma(selectedRun.totalDeduction)}원`, tone: "rose" },
              { label: "총 실지급액", value: `${comma(selectedRun.totalNetPay)}원`,    tone: "emerald" },
            ]}
          />

          {/* 적용 기준(요율·세액표) 연도 배너 — run 내 전 항목 공통. 미설정 시 붉은 경고. */}
          {(() => {
            const firstIns = selectedRun.items.map(it => (it.breakdown as any)?.insurance).find(Boolean);
            const rateYear: number | null = firstIns?.rateYear ?? null;
            const taxYear: number | null = firstIns?.taxYear ?? null;
            const runYear = Number(selectedRun.yearMonth.slice(0, 4));
            const missing = !rateYear || !taxYear;
            return (
              <div className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${missing ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                <b>적용 기준</b> — 4대보험 요율{" "}
                {rateYear ? <span className="font-black text-slate-900">{rateYear}년</span> : <span className="font-black text-rose-700">미설정 → 4대보험 0원</span>}
                {" · "}소득세 간이세액표{" "}
                {taxYear ? <span className="font-black text-slate-900">{taxYear}년</span> : <span className="font-black text-rose-700">미설정 → 소득세 0원</span>}
                {rateYear != null && rateYear !== runYear && (
                  <span className="ml-1 font-bold text-rose-600">(급여연도 {runYear}년 요율 미등록 — {rateYear}년 요율 적용됨)</span>
                )}
              </div>
            );
          })()}

          {/* 국민연금 가입 검토 대상 — 계약 1개월 미만이나 월 8일↑/60h↑. 자동 공제 안 함, 위탁기관 담당자가 노무사·공단 확인. */}
          {(() => {
            const flagged = selectedRun.items.filter(it => (it.breakdown as any)?.insurance?.needsPensionReview);
            if (flagged.length === 0) return null;
            return (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <p className="font-black text-amber-800">🔔 국민연금 가입 검토 대상 {flagged.length}명</p>
                <p className="mt-1 font-semibold leading-relaxed text-amber-700">
                  {flagged.map(it => it.workerName).join(", ")} — 계약 1개월 미만이나 해당 월 근로일수 8일 이상 또는 60시간 이상입니다.
                  국민연금공단 안내상 사업장가입 대상이 될 수 있어 <b>공제·신고 전 노무사 또는 공단 확인</b>이 필요합니다. (현재 자동 공제하지 않습니다.)
                </p>
              </div>
            );
          })()}

          {loadingRun ? (
            <p className={T.empty}>로딩 중...</p>
          ) : (
            <div className={T.tableWrap}>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse">
                <thead>
                  <tr>{["직무지도원 성명(아이디)", "소득유형", "급여유형", "보험유형", "근무일수 (인정 일수)", "근무시간 (인정 시간)", "지급액", "공제액", "실지급액", ""].map(h => {
                    const i = h.indexOf(" ("); // " (인정 …)" 부분만 작게
                    return (
                      <th key={h} className={T.th}>
                        {i >= 0 ? <>{h.slice(0, i)}<span className="ml-0.5 text-[11px] font-semibold text-slate-400">{h.slice(i + 1)}</span></> : h}
                      </th>
                    );
                  })}</tr>
                </thead>
                <tbody>
                  {[...selectedRun.items].sort((a, b) => a.workerName.localeCompare(b.workerName, "ko")).slice((detailPage - 1) * DETAIL_PAGE_SIZE, detailPage * DETAIL_PAGE_SIZE).map(item => {
                    const bd = item.breakdown as any;
                    const incType: IncomeType = bd?.incomeType ?? "BUSINESS";
                    // P1-4 이상치: 급여 0원·급여 기준 없음·사업소득 충돌 경고 → 행 강조
                    const warn = bd?.incomeWarn as string | undefined;
                    const isZeroPay = Number(item.netPay) <= 0;
                    const noPayContract = bd?.note === "급여 계약 없음";
                    const anomalous = isZeroPay || noPayContract || !!warn;
                    return (
                      <tr key={item.id} className={`${T.trBase} ${anomalous ? "bg-amber-50/50" : ""}`}>
                        <td className={`${T.td} whitespace-nowrap`}>
                          <span className="font-semibold">{item.workerName} <span className="text-[13px] font-normal text-slate-500">({maskLoginId(item.loginId)})</span></span>
                          {isZeroPay && <span className="ml-1.5 inline-flex items-center rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-600">급여 0원</span>}
                          {bd?.note && <span className="ml-1.5 text-[11px] font-semibold text-amber-600">⚠ {bd.note}</span>}
                          {warn && <span className="ml-1.5 text-[11px] font-semibold text-rose-600">⚠ {warn}</span>}
                          {bd?.insurance?.needsPensionReview && <span className="ml-1.5 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700" title="계약 1개월 미만이나 월 8일↑/60h↑ — 국민연금 사업장가입 대상 여지. 노무사·공단 확인 후 공제(현재 자동 공제 안 함).">국민연금 검토</span>}
                        </td>
                        <td className={T.td}>
                          <span className={`${T.badge} ${incType === "EMPLOYMENT" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}>{incType === "EMPLOYMENT" ? "근로소득" : "사업소득"}</span>
                        </td>
                        <td className={`${T.td} whitespace-nowrap text-slate-700`}>{bd?.payType ? payTypeLabel[bd.payType as PayType] : "-"}</td>
                        <td className={T.td}>
                          {bd?.insurance ? (
                            <span className="cursor-help whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold text-slate-500" title={TIER_DESC[bd.insurance.tier] ?? ""}>{TIER_LABEL[bd.insurance.tier] ?? bd.insurance.tier}</span>
                          ) : "-"}
                        </td>
                        <td className={`${T.td} whitespace-nowrap text-slate-600`}>
                          {item.workedDays}일{bd?.insurance && <span className="ml-1 text-[10px] text-slate-400">(인정 {bd.insurance.monthlyDays}일)</span>}
                        </td>
                        <td className={`${T.td} whitespace-nowrap text-slate-600`}>
                          {fmtMin(item.workedMinutes)}{bd?.insurance && <span className="ml-1 text-[10px] text-slate-400">(인정 {bd.insurance.monthlyHours}h)</span>}
                        </td>
                        <td className={`${T.td} whitespace-nowrap font-black text-sky-600`}>{comma(item.grossPay)}원</td>
                        <td className={`${T.td} whitespace-nowrap`}>
                          <span className="cursor-help font-semibold text-rose-600"
                            title={Object.entries(bd?.deductionBreakdown ?? {}).map(([k, v]) => `${k} ${comma(v as number)}원`).join("\n") || "공제 없음"}>
                            -{comma(item.totalDeduction)}원
                          </span>
                        </td>
                        <td className={`${T.td} whitespace-nowrap font-black text-emerald-600`}>{comma(item.netPay)}원</td>
                        <td className={T.td}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-bold text-slate-600 hover:bg-slate-50"
                              onClick={() => setPayslipItem({ id: item.id, name: item.workerName })}>명세서</button>
                            {selectedRun.status === "DRAFT" && (
                              <button className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-bold text-slate-600 hover:bg-slate-50"
                                onClick={() => setEditItem(item)}>수정</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <Pagination className="border-t border-slate-100 px-4 py-3" page={detailPage}
                totalPages={Math.max(1, Math.ceil(selectedRun.items.length / DETAIL_PAGE_SIZE))}
                total={selectedRun.items.length} onPageChange={setDetailPage} />
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

      {payslipItem && (
        <div className={T.modalOverlay} onClick={e => { if (e.target === e.currentTarget) setPayslipItem(null); }}>
          <div className="flex h-[90vh] w-full max-w-3xl flex-col rounded-3xl bg-white p-4 shadow-2xl shadow-slate-950/20">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-sm font-black text-slate-900">{payslipItem.name} 급여명세서</p>
              <div className="flex gap-2">
                <a href={`/api/admin/payroll/items/${payslipItem.id}/payslip`} target="_blank" rel="noopener noreferrer" className={T.btnSecondary}>새 창</a>
                <button onClick={() => setPayslipItem(null)} className={T.btnSecondary}>닫기</button>
              </div>
            </div>
            <iframe src={`/api/admin/payroll/items/${payslipItem.id}/payslip`} className="w-full flex-1 rounded-xl border border-slate-200" title="급여명세서" />
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
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
    childUnder20: Number(bd.basicInfo?.childUnder20) || 0,
    withholdingRate: Number(bd.basicInfo?.withholdingRate) || 100,
  }));
  const [saving, setSaving] = useState(false);
  const [taxNote, setTaxNote] = useState("");
  const [bonusAmount, setBonusAmount] = useState(0);
  const [bonusMonths, setBonusMonths] = useState(1);
  const [bonusNote, setBonusNote] = useState("");

  const gross = payLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  // 상여 계산 기준 = 상여 외 급여(상여 라인 제외)
  const regularGross = payLines.filter(l => l.key !== "bonus").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const totalDed = deductLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const net = gross - totalDed;
  const totalHours = +payLines.reduce((s, l) => s + (Number(l.hours) || 0), 0).toFixed(1);

  const setPay = (i: number, f: keyof PayLine, v: any) =>
    setPayLines(prev => prev.map((l, idx) => idx === i ? { ...l, [f]: f === "name" || f === "method" ? v : Number(v) || 0 } : l));
  const setDed = (i: number, f: keyof DeductLine, v: any) =>
    setDeductLines(prev => prev.map((l, idx) => idx === i ? { ...l, [f]: f === "name" ? v : Number(v) || 0 } : l));

  async function refetchTax() {
    try {
      const qs = `pay=${gross}&dependents=${basic.dependents}&childUnder20=${basic.childUnder20}&rate=${basic.withholdingRate}&year=${year}`;
      const res = await fetch(`/api/admin/payroll/income-tax/lookup?${qs}`);
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
        const creditNote = d.childCredit ? ` − 자녀공제 ${comma(d.childCredit)}` : "";
        const rateNote = d.rate !== 100 ? ` × ${d.rate}%` : "";
        setTaxNote(`${d.year}년 간이세액표 (과세급여 ${comma(gross)}원·가족 ${basic.dependents}명): 표 ${comma(d.base)}${creditNote}${rateNote} → 소득세 ${comma(d.incomeTax)}원 / 주민세 ${comma(d.localTax)}원`);
      } else {
        setTaxNote("등록된 간이세액표가 없습니다. 시스템 관리자가 [시스템 설정 > 근로소득 간이세액표]에 등록해야 자동 조회됩니다. (소득세 수동 입력 가능)");
      }
    } catch { setTaxNote("조회 실패"); }
  }

  async function applyBonus() {
    if (!bonusAmount) { setBonusNote("상여 금액을 입력하세요."); return; }
    try {
      const qs = `bonus=${bonusAmount}&monthlyPay=${regularGross}&months=${bonusMonths}&dependents=${basic.dependents}&childUnder20=${basic.childUnder20}&rate=${basic.withholdingRate}&year=${year}`;
      const d = await fetch(`/api/admin/payroll/income-tax/bonus?${qs}`).then(r => r.json());
      if (!d.success || !d.hasTable) { setBonusNote("등록된 간이세액표가 없어 상여 세액을 계산할 수 없습니다. (시스템 관리자 등록 필요)"); return; }
      // 지급내역에 상여 라인 추가/갱신
      setPayLines(prev => [...prev.filter(l => l.key !== "bonus"), { key: "bonus", name: "상여", hours: 0, amount: bonusAmount, method: `지급대상기간 ${d.months}개월` }]);
      // 공제내역에 상여소득세·상여주민세 추가/갱신
      setDeductLines(prev => {
        const next = prev.filter(l => l.key !== "bonusTax" && l.key !== "bonusLocalTax");
        next.push({ key: "bonusTax", name: "상여소득세", amount: d.bonusTax });
        next.push({ key: "bonusLocalTax", name: "상여주민세", amount: d.bonusLocalTax });
        return next;
      });
      setBonusNote(`상여 ${comma(bonusAmount)}원 · ${d.months}개월: 월환산세액 ${comma(d.perMonthTax)} × ${d.months} − 기징수 ${comma(d.alreadyWithheld)} = 상여소득세 ${comma(d.bonusTax)}원 (주민세 ${comma(d.bonusLocalTax)}원)`);
    } catch { setBonusNote("계산 실패"); }
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
        <div className="mb-2 grid grid-cols-2 gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-4">
          <div><label className={T.label}>업무</label>
            <input value={basic.job} onChange={e => setBasic(b => ({ ...b, job: e.target.value }))} className={`w-full ${T.input}`} /></div>
          <div><label className={T.label}>배치형태</label>
            <input value={basic.placementType} onChange={e => setBasic(b => ({ ...b, placementType: e.target.value }))} className={`w-full ${T.input}`} /></div>
          <div><label className={T.label}>배치일</label>
            <input type="date" value={basic.placementDate} onChange={e => setBasic(b => ({ ...b, placementDate: e.target.value }))} className={`w-full ${T.input}`} /></div>
          <div><label className={T.label}>공제대상가족수</label>
            <input type="number" min={1} max={11} value={basic.dependents}
              onChange={e => setBasic(b => ({ ...b, dependents: Math.max(1, Math.min(11, Number(e.target.value) || 1)) }))}
              className={`w-full ${T.input}`} /></div>
          <div><label className={T.label}>8~20세 자녀수</label>
            <input type="number" min={0} value={basic.childUnder20}
              onChange={e => setBasic(b => ({ ...b, childUnder20: Math.max(0, Number(e.target.value) || 0) }))}
              className={`w-full ${T.input}`} /></div>
          <div><label className={T.label}>원천징수 비율</label>
            <select value={basic.withholdingRate} onChange={e => setBasic(b => ({ ...b, withholdingRate: Number(e.target.value) }))} className={`w-full ${T.select}`}>
              <option value={80}>80%</option><option value={100}>100%</option><option value={120}>120%</option>
            </select></div>
          <div className="flex items-end sm:col-span-2">
            <button onClick={refetchTax} className={`${T.btnPrimary} w-full`} title="과세급여·가족수·자녀수·비율로 소득세 자동 산정">소득세 자동 조회 (간이세액표)</button>
          </div>
        </div>
        {taxNote && <p className="mb-4 rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">{taxNote}</p>}
        {!taxNote && <p className="mb-4 text-[11px] font-semibold text-slate-400">※ 공제대상가족수=본인+배우자+자녀 등. 8~20세 자녀는 추가공제(1명 12,500·2명 29,160·3명↑ +25,000/명). 비율 80/100/120% 선택.</p>}

        {/* 상여 (지급대상기간 원천징수) */}
        <div className="mb-5 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <p className="mb-2 text-sm font-black text-slate-900">상여 (지급대상기간 원천징수)</p>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className={T.label}>상여 금액(원)</label>
              <input type="number" value={bonusAmount || ""} onChange={e => setBonusAmount(Number(e.target.value) || 0)} className={`w-40 ${T.input}`} /></div>
            <div><label className={T.label}>지급대상기간(월)</label>
              <input type="number" min={1} max={12} value={bonusMonths} onChange={e => setBonusMonths(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} className={`w-28 ${T.input}`} /></div>
            <button onClick={applyBonus} className={T.btnSecondary}>상여 세액 계산·반영</button>
          </div>
          {bonusNote && <p className="mt-2 text-xs font-semibold text-amber-700">{bonusNote}</p>}
          <p className="mt-1 text-[11px] font-semibold text-slate-400">
            상여외 급여 {comma(regularGross)}원 기준 · 공식 (㉮×월수)−기징수. 지급대상기간이 없으면 1월~지급월까지의 개월수를 입력. 계산 시 지급내역에 ‘상여’, 공제내역에 ‘상여소득세·상여주민세’가 추가됩니다.
          </p>
        </div>

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
