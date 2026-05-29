"use client";

import { useEffect, useState, useCallback } from "react";
import { Building2, Users, MapPin, ChevronDown } from "lucide-react";

type Agency = {
  id: string;
  name: string;
  planType: string;
  trialEndsAt: string | null;
  createdAt: string;
  managerCount: number;
  siteCount: number;
};

const PLAN_COLORS: Record<string, string> = {
  FREE:     "bg-slate-100 text-slate-600",
  TRIAL:    "bg-amber-100 text-amber-700",
  STARTER:  "bg-sky-100 text-sky-700",
  STANDARD: "bg-violet-100 text-violet-700",
  PRO:      "bg-emerald-100 text-emerald-700",
};
const PLANS = ["FREE", "TRIAL", "STARTER", "STANDARD", "PRO"];

export default function AgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [editId, setEditId]     = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState("");
  const [editTrial, setEditTrial] = useState("");
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/system/agencies")
      .then(r => r.json())
      .then(d => { if (d.success) setAgencies(d.agencies); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(a: Agency) {
    setEditId(a.id);
    setEditPlan(a.planType);
    setEditTrial(a.trialEndsAt ? a.trialEndsAt.slice(0, 10) : "");
  }

  async function savePlan() {
    if (!editId) return;
    setProcessing(true);
    const res = await fetch(`/api/admin/system/agencies/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planType:   editPlan,
        trialEndsAt: editTrial || null,
      }),
    });
    const data = await res.json();
    setProcessing(false);
    if (data.success) { showToast(data.message); setEditId(null); load(); }
    else showToast(data.message || "실패");
  }

  const filtered = agencies.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">에이전시 관리</h1>
          <p className="mt-0.5 text-sm text-slate-500">전체 {agencies.length}개 에이전시 · 플랜 변경 가능</p>
        </div>
      </div>

      <div className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="에이전시 이름 검색..."
          className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
              <p className="text-sm text-slate-400">에이전시가 없습니다.</p>
            </div>
          ) : filtered.map(a => (
            <div key={a.id} className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 flex-shrink-0">
                  <Building2 className="h-5 w-5 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-slate-900">{a.name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-black ${PLAN_COLORS[a.planType] ?? "bg-slate-100 text-slate-600"}`}>
                      {a.planType}
                    </span>
                    {a.trialEndsAt && (
                      <span className="text-[10px] text-slate-400">체험 ~{new Date(a.trialEndsAt).toLocaleDateString("ko-KR")}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{a.managerCount}명</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{a.siteCount}개소</span>
                    <span>가입 {new Date(a.createdAt).toLocaleDateString("ko-KR")}</span>
                  </div>
                </div>
                <button onClick={() => editId === a.id ? setEditId(null) : openEdit(a)}
                  className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 active:scale-95 flex-shrink-0">
                  플랜 변경 <ChevronDown className={`h-3 w-3 transition ${editId === a.id ? "rotate-180" : ""}`} />
                </button>
              </div>

              {editId === a.id && (
                <div className="mt-4 flex items-end gap-3 border-t border-slate-100 pt-4">
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-500">플랜</label>
                    <select value={editPlan} onChange={e => setEditPlan(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
                      {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  {editPlan === "TRIAL" && (
                    <div className="flex-1">
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">체험 종료일</label>
                      <input type="date" value={editTrial} onChange={e => setEditTrial(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setEditId(null)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 active:scale-95">
                      취소
                    </button>
                    <button onClick={savePlan} disabled={processing}
                      className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white active:scale-95 disabled:opacity-60">
                      {processing ? "..." : "저장"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
