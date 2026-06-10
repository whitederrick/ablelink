"use client";

// 시스템 설정 세부 섹션 컴포넌트 — 설정 메뉴를 세부 페이지로 분리하기 위해 추출.
import { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";

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

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6">
      <h2 className="mb-1 text-base font-black text-slate-900">근로소득 간이세액표</h2>
      <p className="mb-4 text-xs text-slate-500">
        매년 홈택스에서 받은 <b>엑셀(.xlsx) 원본을 그대로 업로드</b>하면 됩니다. ‘소득령 별표2’ + ‘간이세액표’가 한 파일에 여러 시트로 있어도
        자동으로 세액표 시트를 찾고 자녀공제(별표2)를 추출합니다. 급여계산 시 소득세 자동 조회(주민세=소득세 10%)에 사용됩니다.
      </p>

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
