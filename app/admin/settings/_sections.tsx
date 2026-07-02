"use client";

// 시스템 설정 세부 섹션 컴포넌트 — 설정 메뉴를 세부 페이지로 분리하기 위해 추출.
import { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { INSURANCE_RATE_DEFAULTS, insuranceRateDefaultForYear } from "@/lib/payroll/insuranceRateDefaults";
import Pagination from "../_components/Pagination";

const CAT_TONES = ["sky", "amber", "rose", "emerald", "violet", "slate"] as const;
const TONE_SWATCH: Record<string, string> = {
  sky: "bg-sky-100 text-sky-700", amber: "bg-amber-100 text-amber-700", rose: "bg-rose-100 text-rose-700",
  emerald: "bg-emerald-100 text-emerald-700", violet: "bg-violet-100 text-violet-700", slate: "bg-slate-200 text-slate-600",
};
type Category = { id: string; name: string; tone: string; sortOrder: number; isActive: boolean };

type ChildCredit = { c1: number; c2: number; extraPer: number };
type TaxYear = { year: number; rowCount: number; updatedAt: string; childCredit: ChildCredit | null };

export function IncomeTaxTableManager({ onToast }: { onToast: (m: string) => void }) {
  const [years, setYears] = useState<TaxYear[]>([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<{ ok: boolean; text: string } | null>(null);

  function showVerify(d: any) {
    const s = d.summary;
    const ccv = d.childCredit;
    const warns: string[] = [];
    if (!s || s.count < 100) warns.push("구간 수가 비정상적으로 적습니다");
    if (s && !s.monotonic) warns.push("구간 순서 이상(중복/역전)");
    if (s && s.maxDependents < 11) warns.push(`가족 열이 ${s?.maxDependents}개(보통 11)`);
    if (!ccv) warns.push("자녀공제 미인식 → 입력값/기본값 사용");
    const parts = [
      `${d.year}년 등록`,
      d.sheet ? `시트 '${d.sheet}'` : null,
      s ? `${s.count.toLocaleString()}구간` : null,
      s ? `급여 ${s.minPayK.toLocaleString()}~${s.maxPayK.toLocaleString()}천원` : null,
      s ? `가족 ${s.maxDependents}열` : null,
      ccv ? `자녀공제 ${ccv.c1.toLocaleString()}/${ccv.c2.toLocaleString()}/+${ccv.extraPer.toLocaleString()}` : "자녀공제 미인식",
    ].filter(Boolean);
    setVerify({ ok: warns.length === 0, text: parts.join(" · ") + (warns.length ? ` ⚠ ${warns.join(", ")}` : "") });
  }

  const load = () => fetch("/api/admin/payroll/income-tax").then(r => r.json())
    .then(d => { if (d.success) setYears(d.data); }).catch(() => {});
  useEffect(() => { load(); }, []);

  async function uploadExcel(file: File) {
    if (!Number.isInteger(Number(year))) { onToast("연도를 입력하세요."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("year", String(year));
      fd.append("file", file);
      const d = await fetch("/api/admin/payroll/income-tax/upload", { method: "POST", body: fd }).then(r => r.json());
      if (d.success) { onToast(`${d.year}년 간이세액표 ${d.rowCount}구간 저장(엑셀)`); showVerify(d); load(); }
      else onToast(d.message || "업로드 실패");
    } catch { onToast("업로드 실패"); }
    finally { setBusy(false); }
  }

  const nowY = new Date().getFullYear();
  const appliedTax = years.filter(y => y.year <= nowY).sort((a, b) => b.year - a.year)[0] ?? null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6">
      <h2 className="mb-1 text-base font-black text-slate-900">근로소득 간이세액표</h2>
      <p className="mb-4 text-xs text-slate-500">
        매년 홈택스에서 받은 <b>엑셀(.xlsx) 원본을 그대로 업로드</b>하면 됩니다. ‘소득령 별표2’ + ‘간이세액표’가 한 파일에 여러 시트로 있어도
        자동으로 세액표 시트를 찾고 자녀공제(별표2)를 추출합니다. 급여계산 시 소득세 자동 조회(주민세=소득세 10%)에 사용됩니다.
      </p>

      {years.length === 0 ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          ⚠ 등록된 간이세액표가 없습니다 — <u>소득세·주민세가 0원으로 계산됩니다.</u> 아래에서 홈택스 엑셀을 업로드하세요.
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          ✓ 간이세액표 반영 완료 — {appliedTax
            ? <>올해({nowY}년) 급여에 <span className="font-black text-emerald-800">{appliedTax.year}년 · {appliedTax.rowCount.toLocaleString()}구간</span> 적용 중</>
            : <>등록됨(단, 올해 이하 적용 연도 없음)</>}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="number" value={year} onChange={e => setYear(e.target.value)} placeholder="연도"
          className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400" />
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 ${busy ? "opacity-40 pointer-events-none" : ""}`}>
          {busy ? "처리 중…" : "엑셀(.xlsx) 원본 업로드"}
          <input type="file" accept=".xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadExcel(f); e.currentTarget.value = ""; }} />
        </label>
        <span className="text-xs font-semibold text-slate-400">연도 선택 후 엑셀 파일을 고르면 바로 등록됩니다.</span>
      </div>

      <p className="mb-1 text-[11px] font-semibold text-slate-400">
        ※ 8~20세 자녀공제는 파일의 ‘별표2’ 시트에서 자동으로 가져옵니다. 별표2를 인식하지 못하면 등록을 거부하니, 홈택스 원본(별표2 포함)을 올려주세요.
      </p>

      {years.length > 0 && (
        <div className="mb-1 mt-2 flex flex-wrap gap-1.5">
          {years.map(y => (
            <span key={y.year} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">
              {y.year}년 · {y.rowCount.toLocaleString()}구간
              {y.childCredit && <span className="text-slate-400">· 자녀공제 {y.childCredit.c1.toLocaleString()}/{y.childCredit.c2.toLocaleString()}/+{y.childCredit.extraPer.toLocaleString()}</span>}
            </span>
          ))}
        </div>
      )}

      {verify && (
        <div className={`mt-2 rounded-xl px-3 py-2 text-xs font-semibold ${verify.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {verify.ok ? "✓ 검증 통과 · " : "⚠ 확인 필요 · "}{verify.text}
        </div>
      )}
    </div>
  );
}

export function AnnouncementCategoryManager({ onToast }: { onToast: (m: string) => void }) {
  const [cats, setCats] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [newTone, setNewTone] = useState<string>("sky");
  const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/admin/announcement-categories").then(r => r.json())
    .then(d => { if (d.success) setCats(d.categories); }).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!newName.trim()) { onToast("카테고리 이름을 입력하세요."); return; }
    setBusy(true);
    try {
      const d = await fetch("/api/admin/announcement-categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), tone: newTone }),
      }).then(r => r.json());
      if (d.success) { setNewName(""); setNewTone("sky"); onToast("카테고리를 추가했습니다."); load(); }
      else onToast(d.message || "추가 실패");
    } finally { setBusy(false); }
  }
  async function patch(id: string, body: any) {
    const d = await fetch(`/api/admin/announcement-categories/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(r => r.json());
    if (d.success) load(); else onToast(d.message || "변경 실패");
  }
  async function remove(c: Category) {
    if (!confirm(`'${c.name}' 카테고리를 삭제할까요? 이 카테고리로 지정된 공지는 기본 표시로 돌아갑니다.`)) return;
    const d = await fetch(`/api/admin/announcement-categories/${c.id}`, { method: "DELETE" }).then(r => r.json());
    if (d.success) { onToast("삭제했습니다."); load(); } else onToast(d.message || "삭제 실패");
  }
  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    const a = cats[i], b = cats[j];
    await Promise.all([
      fetch(`/api/admin/announcement-categories/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: b.sortOrder }) }),
      fetch(`/api/admin/announcement-categories/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: a.sortOrder }) }),
    ]);
    load();
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6">
      <h2 className="mb-1 text-base font-black text-slate-900">공지 카테고리 관리</h2>
      <p className="mb-4 text-xs text-slate-500">매니저가 공지 작성 시 선택하는 카테고리를 전역으로 관리합니다. 비활성 카테고리는 새 작성에서 숨겨집니다.</p>

      {/* 추가 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="새 카테고리 이름"
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          className="h-10 flex-1 min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400" />
        <div className="flex gap-1">
          {CAT_TONES.map(t => (
            <button key={t} onClick={() => setNewTone(t)} title={t}
              className={`h-7 w-7 rounded-lg border-2 ${TONE_SWATCH[t]} ${newTone === t ? "border-slate-900" : "border-transparent"}`} />
          ))}
        </div>
        <button onClick={add} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
          <Plus className="h-4 w-4" /> 추가
        </button>
      </div>

      {/* 목록 */}
      {cats.length === 0 ? (
        <p className="text-sm font-semibold text-slate-300">등록된 카테고리가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {cats.map((c, i) => (
            <div key={c.id} className={`flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 p-3 ${c.isActive ? "bg-white" : "bg-slate-50 opacity-70"}`}>
              <GripVertical className="h-4 w-4 text-slate-300" />
              <input defaultValue={c.name} onBlur={e => { const v = e.target.value.trim(); if (v && v !== c.name) patch(c.id, { name: v }); }}
                className="h-9 w-36 rounded-lg border border-slate-200 px-2.5 text-sm font-bold text-slate-900 outline-none focus:border-sky-400" />
              <div className="flex gap-1">
                {CAT_TONES.map(t => (
                  <button key={t} onClick={() => patch(c.id, { tone: t })} title={t}
                    className={`h-6 w-6 rounded-md border-2 ${TONE_SWATCH[t]} ${c.tone === t ? "border-slate-900" : "border-transparent"}`} />
                ))}
              </div>
              <span className={`ml-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black ${TONE_SWATCH[c.tone]}`}>{c.name}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button disabled={i === 0} onClick={() => move(i, -1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 disabled:opacity-30">↑</button>
                <button disabled={i === cats.length - 1} onClick={() => move(i, 1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 disabled:opacity-30">↓</button>
                <button onClick={() => patch(c.id, { isActive: !c.isActive })}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-black ${c.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-white text-slate-400"}`}>
                  {c.isActive ? "활성" : "비활성"}
                </button>
                <button onClick={() => remove(c)} className="rounded-lg border border-rose-200 px-2 py-1 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Rate = {
  id: string; year: number;
  nationalPension: number; healthInsurance: number; longTermCare: number;
  employmentInsurance: number; industrialAccident: number; total: number;
};

// 4대보험 + 산재 요율(연도별). 입력은 %(예: 4.5), 저장은 분수(0.045). 급여 계산이 grossPay×요율로 공제.
export function InsuranceRatesManager({ onToast }: { onToast: (m: string) => void }) {
  const FIELDS = [
    { key: "nationalPension", label: "국민연금", required: true },
    { key: "healthInsurance", label: "건강보험", required: true },
    { key: "longTermCare", label: "장기요양", required: true },
    { key: "employmentInsurance", label: "고용보험", required: true },
    { key: "industrialAccident", label: "산재(사업주)", required: false },
  ] as const;
  type FKey = (typeof FIELDS)[number]["key"];
  const EMPTY = { nationalPension: "", healthInsurance: "", longTermCare: "", employmentInsurance: "", industrialAccident: "" };

  const [rows, setRows] = useState<Rate[]>([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [f, setF] = useState<Record<FKey, string>>({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [prefillNote, setPrefillNote] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = () => fetch("/api/admin/payroll/insurance-rates").then(r => r.json())
    .then(d => { if (d.success) setRows(d.data); }).catch(() => {});
  useEffect(() => { load(); }, []);

  // 연도 변경 시: 저장된 요율이 있으면 그걸(분수→%) 프리필, 없으면 공식 참고 기본값을 프리필(저장 전 확인).
  function pickYear(y: string) {
    setYear(y);
    const r = rows.find(x => String(x.year) === y);
    if (r) {
      setPrefillNote("");
      setF({
        nationalPension: String(+(r.nationalPension * 100).toFixed(4)),
        healthInsurance: String(+(r.healthInsurance * 100).toFixed(4)),
        longTermCare: String(+(r.longTermCare * 100).toFixed(4)),
        employmentInsurance: String(+(r.employmentInsurance * 100).toFixed(4)),
        industrialAccident: String(+(r.industrialAccident * 100).toFixed(4)),
      });
      return;
    }
    const def = insuranceRateDefaultForYear(Number(y));
    if (def) {
      setF({
        nationalPension: String(def.nationalPension),
        healthInsurance: String(def.healthInsurance),
        longTermCare: String(def.longTermCare),
        employmentInsurance: String(def.employmentInsurance),
        industrialAccident: "",
      });
      setPrefillNote(`${y}년 공식 참고 기본값을 자동으로 채웠습니다 — 저장 전 확인하세요${def.note ? ` · ${def.note}` : ""}`);
    } else {
      setF({ ...EMPTY });
      setPrefillNote("");
    }
  }

  async function save() {
    const yr = Number(year);
    if (!Number.isInteger(yr)) { onToast("연도를 입력하세요."); return; }
    const pct = (s: string) => (s.trim() === "" ? null : Number(s) / 100);
    for (const fld of FIELDS) {
      if (fld.required && pct(f[fld.key]) == null) { onToast(`${fld.label} 요율을 입력하세요.`); return; }
    }
    const body = {
      year: yr,
      nationalPension: pct(f.nationalPension),
      healthInsurance: pct(f.healthInsurance),
      longTermCare: pct(f.longTermCare),
      employmentInsurance: pct(f.employmentInsurance),
      industrialAccident: pct(f.industrialAccident) ?? 0,
    };
    setBusy(true);
    try {
      const d = await fetch("/api/admin/payroll/insurance-rates", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then(r => r.json());
      if (d.success) { onToast(`${yr}년 보험요율 저장`); load(); }
      else onToast(d.message || "저장 실패");
    } catch { onToast("저장 실패"); }
    finally { setBusy(false); }
  }

  // 목록의 특정 연도 행을 그 값 그대로 저장·적용(참고값이면 그 값으로 등록). 폼에도 반영.
  async function applyYear(y: number, np: number, hi: number, ltc: number, ei: number, ia: number | null) {
    if (!confirm(`${y}년 요율을 저장·적용합니다.`)) return;
    setBusy(true);
    try {
      const d = await fetch("/api/admin/payroll/insurance-rates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: y, nationalPension: np / 100, healthInsurance: hi / 100, longTermCare: ltc / 100, employmentInsurance: ei / 100, industrialAccident: (ia ?? 0) / 100 }),
      }).then(r => r.json());
      if (d.success) { onToast(`${y}년 요율 저장·적용`); pickYear(String(y)); load(); }
      else onToast(d.message || "저장 실패");
    } catch { onToast("저장 실패"); }
    finally { setBusy(false); }
  }

  // 목록 = DB에 저장된 연도만(최신이 위). 기본값 테이블은 폼 프리필·seed 전용(목록에 섞지 않음).
  // 지금 급여계산에 실제 적용되는 연도 = 저장된 연도 중 올해 이하 최신(computeRun의 year≤급여연도 최신 선택과 동일).
  const nowYear = new Date().getFullYear();
  const appliedCandidates = rows.map(r => r.year).filter(y => y <= nowYear);
  const appliedYear = appliedCandidates.length ? Math.max(...appliedCandidates) : null;
  type Row2 = { year: number; np: number; hi: number; ltc: number; ei: number; ia: number; total: number; note?: string };
  const listRows: Row2[] = rows
    .map(r => ({ year: r.year, np: r.nationalPension * 100, hi: r.healthInsurance * 100, ltc: r.longTermCare * 100, ei: r.employmentInsurance * 100, ia: r.industrialAccident * 100, total: r.total * 100, note: INSURANCE_RATE_DEFAULTS[r.year]?.note }))
    .sort((a, b) => b.year - a.year);
  const totalPages = Math.max(1, Math.ceil(listRows.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = listRows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const fmt = (n: number) => +n.toFixed(4); // 자연 자릿수 표기(뒤 0 제거, 장기요양 4자리·연금 2자리 등 그대로)

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6">
      <h2 className="mb-1 text-base font-black text-slate-900">4대보험 요율</h2>
      <p className="mb-4 text-xs text-slate-500">
        연도별 근로자 부담 요율(국민연금·건강·장기요양·고용)과 <b>산재(전액 사업주 부담)</b>를 입력합니다. 단위는 <b>%</b>(예: 4.5).
        급여 계산 시 가입 유형(일용/초단시간/일반)에 따라 해당 보험만 자동 공제됩니다. 산재는 워커 공제에서 제외(표기용).
        <br />연도를 입력하면 <b>공식 참고 기본값</b>이 자동으로 채워집니다(저장 전 확인). <b>장기요양</b>은 과세급여 기준 실효율(예: 0.4591)로 넣습니다.
      </p>

      {rows.length === 0 && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          ⚠ 저장된 요율이 없습니다 — <u>현재 4대보험이 0원으로 계산됩니다.</u> 아래 표에서 <b>최신 연도를 선택해 반드시 저장</b>하세요.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-black text-slate-500">연도</label>
          <input type="number" value={year} onChange={e => pickYear(e.target.value)} placeholder="연도"
            className="h-10 w-24 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400" />
        </div>
        {FIELDS.map(fld => (
          <div key={fld.key}>
            <label className="mb-1 block text-[11px] font-black text-slate-500">
              {fld.label}{fld.required && <span className="text-rose-500">*</span>} (%)
            </label>
            <input type="number" step="0.001" value={f[fld.key]}
              onChange={e => setF(p => ({ ...p, [fld.key]: e.target.value }))}
              placeholder={fld.key === "industrialAccident" ? "예: 0.7" : "예: 4.5"}
              className="h-10 w-24 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400" />
          </div>
        ))}
        <button onClick={save} disabled={busy}
          className="h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>

      {prefillNote && (
        <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          ⚠ {prefillNote}
        </div>
      )}

      <p className="mb-2 mt-3 text-[12px] font-semibold text-slate-500">
        연도별 요율(최신이 위, DB 저장분). <span className="font-black text-emerald-700">저장됨</span>=DB에 저장된 값,
        <span className="font-black text-rose-600"> 적용됨</span>=<b className="text-rose-600">{nowYear}년 급여계산에 실제 적용되는 연도</b>.
        각 행 <b>‘선택 및 적용’</b>으로 그 연도 값으로 저장·적용합니다.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[12px] font-black text-slate-500">
              {["연도", "주요 변경 사항", "구분", "국민연금", "건강", "장기요양", "고용", "산재", "근로자합", "관리"].map(h => (
                <th key={h} className="border-b border-slate-100 px-3 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <tr key={r.year} className="cursor-pointer border-b border-slate-50 last:border-b-0 hover:bg-slate-50" onClick={() => pickYear(String(r.year))}>
                <td className="whitespace-nowrap px-3 py-1.5 text-left font-black text-slate-900">{r.year}</td>
                <td className="px-3 py-1.5 text-left font-bold text-rose-600">{r.note ?? ""}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-left">
                  <div className="flex flex-nowrap items-center justify-start gap-1">
                    <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-700">저장됨</span>
                    {r.year === appliedYear && (
                      <span className="whitespace-nowrap rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-black text-white">적용됨</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-left text-slate-700">{fmt(r.np)}%</td>
                <td className="px-3 py-1.5 text-left text-slate-700">{fmt(r.hi)}%</td>
                <td className="px-3 py-1.5 text-left text-slate-700">{fmt(r.ltc)}%</td>
                <td className="px-3 py-1.5 text-left text-slate-700">{fmt(r.ei)}%</td>
                <td className="px-3 py-1.5 text-left text-slate-500">{fmt(r.ia)}%</td>
                <td className="px-3 py-1.5 text-left font-black text-sky-600">{fmt(r.total)}%</td>
                <td className="px-3 py-1.5 text-left">
                  <button onClick={(e) => { e.stopPropagation(); applyYear(r.year, r.np, r.hi, r.ltc, r.ei, r.ia); }} disabled={busy}
                    className={`inline-flex h-6 items-center whitespace-nowrap rounded-lg border px-2.5 text-[12px] font-bold disabled:opacity-40 ${r.year === appliedYear ? "border-slate-950 bg-slate-950 text-white hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                    선택 및 적용
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination className="mt-3" page={curPage} totalPages={totalPages} total={listRows.length} onPageChange={setPage} />
    </div>
  );
}
