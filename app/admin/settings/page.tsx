"use client";

import { useEffect, useState } from "react";
import { Settings, CheckCircle2 } from "lucide-react";
import PageHeader from "../_components/PageHeader";


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
      <PageHeader title="운영 설정값" sub="DB 운영 파라미터(즉시 적용) 및 환경 변수 현황" />

      <div className="grid items-start gap-6 lg:grid-cols-2">
      {/* 운영 파라미터 (DB 저장 — 즉시 적용) */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6">
        <h2 className="mb-1 text-base font-black text-slate-900">운영 파라미터</h2>
        <p className="mb-4 text-xs text-slate-500">DB에 저장되어 재배포 없이 즉시 적용됩니다.</p>
        <div className="space-y-4">
          {configs.length === 0 ? (
            <p className="text-sm font-semibold text-slate-300">불러오는 중...</p>
          ) : configs.map(c => {
            const changed = (draft[c.key] ?? "") !== c.value;
            return (
              <div key={c.key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black text-slate-900">{c.label}</p>
                    <code className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">{c.key}</code>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{c.description}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <input
                    type={c.type === "number" ? "number" : "text"}
                    min={c.min} max={c.max}
                    value={draft[c.key] ?? ""}
                    onChange={e => setDraft(p => ({ ...p, [c.key]: e.target.value }))}
                    className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"
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
      </div>

      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
