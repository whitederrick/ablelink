"use client";

import { useEffect, useState } from "react";
import { Settings, CheckCircle2, Plus, Trash2, GripVertical } from "lucide-react";
import PageHeader from "../_components/PageHeader";

const CAT_TONES = ["sky", "amber", "rose", "emerald", "violet", "slate"] as const;
const TONE_SWATCH: Record<string, string> = {
  sky: "bg-sky-100 text-sky-700", amber: "bg-amber-100 text-amber-700", rose: "bg-rose-100 text-rose-700",
  emerald: "bg-emerald-100 text-emerald-700", violet: "bg-violet-100 text-violet-700", slate: "bg-slate-200 text-slate-600",
};
type Category = { id: string; name: string; tone: string; sortOrder: number; isActive: boolean };

type TaxYear = { year: number; rowCount: number; updatedAt: string };

function IncomeTaxTableManager({ onToast }: { onToast: (m: string) => void }) {
  const [years, setYears] = useState<TaxYear[]>([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/admin/payroll/income-tax").then(r => r.json())
    .then(d => { if (d.success) setYears(d.data); }).catch(() => {});
  useEffect(() => { load(); }, []);

  async function save() {
    if (!text.trim()) { onToast("간이세액표를 붙여넣어 주세요."); return; }
    setBusy(true);
    try {
      const d = await fetch("/api/admin/payroll/income-tax", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: Number(year), text }),
      }).then(r => r.json());
      if (d.success) { onToast(`${d.year}년 간이세액표 ${d.rowCount}구간 저장`); setText(""); load(); }
      else onToast(d.message || "저장 실패");
    } finally { setBusy(false); }
  }

  async function uploadExcel(file: File) {
    if (!Number.isInteger(Number(year))) { onToast("연도를 입력하세요."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("year", String(year));
      fd.append("file", file);
      const d = await fetch("/api/admin/payroll/income-tax/upload", { method: "POST", body: fd }).then(r => r.json());
      if (d.success) { onToast(`${d.year}년 간이세액표 ${d.rowCount}구간 저장(엑셀)`); load(); }
      else onToast(d.message || "업로드 실패");
    } catch { onToast("업로드 실패"); }
    finally { setBusy(false); }
  }

  return (
    <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-6">
      <h2 className="mb-1 text-base font-black text-slate-900">근로소득 간이세액표</h2>
      <p className="mb-4 text-xs text-slate-500">
        매년 홈택스(근로소득 간이세액표)에서 표를 받아 등록합니다. 엑셀에서 데이터 영역을 복사(탭 구분)해 아래에 붙여넣으세요.
        에이전시 급여계산 시 소득세 자동 조회(주민세=소득세 10%)에 사용되며, 관리자가 수동 보정할 수 있습니다.
      </p>

      {years.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {years.map(y => (
            <span key={y.year} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">
              {y.year}년 · {y.rowCount.toLocaleString()}구간
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input type="number" value={year} onChange={e => setYear(e.target.value)} placeholder="연도"
          className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400" />
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 ${busy ? "opacity-40 pointer-events-none" : ""}`}>
          엑셀(.xlsx) 업로드
          <input type="file" accept=".xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadExcel(f); e.currentTarget.value = ""; }} />
        </label>
        <span className="text-xs font-semibold text-slate-400">또는 아래에 붙여넣기 →</span>
        <button onClick={save} disabled={busy} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
          {busy ? "저장 중…" : "붙여넣기 등록"}
        </button>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
        placeholder={"권장: 위 '엑셀(.xlsx) 업로드' 사용. \n또는 홈택스 표를 복사해 여기에 붙여넣기(탭/공백 구분, 빈칸 '-' 무관).\n각 행: 월급여(이상,천원) 월급여(미만,천원) 가족1명 가족2명 …"}
        className="mt-2 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs text-slate-800 outline-none focus:border-sky-400" />
    </div>
  );
}

function AnnouncementCategoryManager({ onToast }: { onToast: (m: string) => void }) {
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
    <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-6">
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

interface SettingItem {
  key: string;
  label: string;
  desc: string;
  value: string;
  type: "number" | "text" | "readonly";
  warning?: string;
}

interface ConfigItem {
  key: string; label: string; description: string;
  type: "number" | "string"; value: string; min?: number; max?: number;
}

export default function SettingsPage() {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast]   = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  function loadConfigs() {
    fetch("/api/admin/system/config").then(r=>r.json()).then(d=>{
      if (d.success) {
        setConfigs(d.items);
        setDraft(Object.fromEntries(d.items.map((c: ConfigItem) => [c.key, c.value])));
      }
    }).catch(()=>{});
  }
  useEffect(()=>{ loadConfigs(); },[]);

  async function saveConfig(key: string) {
    setSavingKey(key);
    try {
      const d = await fetch("/api/admin/system/config", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: draft[key] }),
      }).then(r=>r.json());
      if (d.success) { showToast("저장되었습니다."); loadConfigs(); }
      else showToast(d.message || "저장 실패");
    } catch { showToast("오류가 발생했습니다."); }
    finally { setSavingKey(null); }
  }

  const ENV_SETTINGS: SettingItem[] = [
    { key:"ADMIN_SESSION_SECRET",     label:"Admin 세션 시크릿",       desc:"관리자 JWT 서명 키",           value:"설정됨 (보안상 미표시)", type:"readonly" },
    { key:"WORKER_SESSION_SECRET",    label:"Worker 세션 시크릿",      desc:"직무지도원 JWT 서명 키",       value:"설정됨 (보안상 미표시)", type:"readonly" },
    { key:"DATABASE_URL",             label:"데이터베이스 URL",         desc:"Supabase PostgreSQL 연결",     value:"설정됨 (보안상 미표시)", type:"readonly" },
    { key:"NEXT_PUBLIC_TOSS_CLIENT_KEY", label:"Toss 클라이언트 키",  desc:"결제 클라이언트 키",          value:"Vercel 환경변수에서 확인", type:"readonly" },
    { key:"GOOGLE_GEMINI_API_KEY",    label:"Gemini API 키",           desc:"AI 일지 생성에 사용",          value:"설정됨 (보안상 미표시)", type:"readonly" },
    { key:"GROQ_API_KEY",             label:"Groq API 키",             desc:"STT 음성 변환에 사용",         value:"설정됨 (보안상 미표시)", type:"readonly" },
  ];

  return (
    <div>
      <PageHeader title="시스템 설정" sub="운영 파라미터 및 환경 변수 현황" />

      {/* 운영 파라미터 (DB 저장 — 즉시 적용) */}
      <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-6">
        <h2 className="mb-1 text-base font-black text-slate-900">운영 파라미터</h2>
        <p className="mb-4 text-xs text-slate-500">DB에 저장되어 재배포 없이 즉시 적용됩니다.</p>
        <div className="space-y-4">
          {configs.length === 0 ? (
            <p className="text-sm font-semibold text-slate-300">불러오는 중...</p>
          ) : configs.map(c => {
            const changed = (draft[c.key] ?? "") !== c.value;
            return (
              <div key={c.key} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black text-slate-900">{c.label}</p>
                  <code className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">{c.key}</code>
                </div>
                <p className="mt-0.5 mb-2 text-xs text-slate-500">{c.description}</p>
                <div className="flex items-center gap-2">
                  <input
                    type={c.type === "number" ? "number" : "text"}
                    min={c.min} max={c.max}
                    value={draft[c.key] ?? ""}
                    onChange={e => setDraft(p => ({ ...p, [c.key]: e.target.value }))}
                    className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"
                  />
                  <button onClick={() => saveConfig(c.key)} disabled={!changed || savingKey === c.key}
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
                    {savingKey === c.key ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 근로소득 간이세액표 */}
      <IncomeTaxTableManager onToast={showToast} />

      {/* 공지 카테고리 관리 */}
      <AnnouncementCategoryManager onToast={showToast} />

      {/* 환경변수 현황 */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-400"/>
          <h2 className="text-base font-black text-slate-900">환경변수 현황</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Vercel 대시보드에서 관리</span>
        </div>
        <div className="space-y-3">
          {ENV_SETTINGS.map(s=>(
            <div key={s.key} className="flex items-start gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500"/>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black text-slate-900">{s.label}</p>
                  <code className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">{s.key}</code>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{s.desc}</p>
                <p className="mt-1 text-xs font-semibold text-slate-400">{s.value}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          · 환경변수 변경: Vercel 대시보드 → 프로젝트 → Settings → Environment Variables<br/>
          · 변경 후 반드시 Redeploy가 필요합니다.
        </p>
      </div>

      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
