"use client";

import { useEffect, useState } from "react";
import { Settings, AlertTriangle, CheckCircle2 } from "lucide-react";

interface SettingItem {
  key: string;
  label: string;
  desc: string;
  value: string;
  type: "number" | "text" | "readonly";
  warning?: string;
}

export default function SettingsPage() {
  const [autoFinalize, setAutoFinalize] = useState("60");
  const [saved, setSaved]   = useState(false);
  const [toast, setToast]   = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  useEffect(()=>{
    fetch("/api/admin/system/stats").then(r=>r.json()).catch(()=>{});
  },[]);

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
      <div className="mb-6"><h1 className="text-xl font-black text-slate-900">시스템 설정</h1>
        <p className="mt-0.5 text-sm text-slate-500">운영 파라미터 및 환경 변수 현황</p></div>

      {/* 운영 파라미터 */}
      <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-6">
        <h2 className="mb-4 text-base font-black text-slate-900">운영 파라미터</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-black text-slate-700">자동 마감 시간 (분)</label>
            <p className="mb-2 text-xs text-slate-500">퇴근 처리 후 N분이 지나면 자동으로 최종 확정됩니다. 환경변수 AUTO_FINALIZE_MINUTES에서 설정.</p>
            <div className="flex items-center gap-3">
              <input type="number" min="10" max="1440" value={autoFinalize} onChange={e=>setAutoFinalize(e.target.value)}
                className="w-32 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/>
              <span className="text-sm text-slate-500">분 (현재 환경변수 기준값: AUTO_FINALIZE_MINUTES)</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0"/>
              <p className="text-[11px] font-semibold text-amber-700">실제 적용은 Vercel 환경변수 AUTO_FINALIZE_MINUTES를 변경해야 합니다.</p>
            </div>
          </div>
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

      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
