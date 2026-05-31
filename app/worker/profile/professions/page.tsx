"use client";

// 보유 자격(직종) 관리 — 조회 + 추가 직종 증명 + 수정/삭제
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, Check, Clock, X, Trash2 } from "lucide-react";

const PROFS: { value: string; label: string; certHint: string }[] = [
  { value: "JOB_COACH", label: "직무지도원", certHint: "직무지도원 양성과정 수료증 번호" },
  { value: "CAREGIVER", label: "요양보호사", certHint: "요양보호사 국가자격증 번호" },
  { value: "ACTIVITY_ASSISTANT", label: "활동지원사", certHint: "활동지원사 교육과정 수료증 번호" },
];
const LABEL: Record<string, string> = Object.fromEntries(PROFS.map((p) => [p.value, p.label]));
const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  PENDING:  { label: "검증 대기", cls: "bg-amber-50 text-amber-600", icon: Clock },
  VERIFIED: { label: "검증 완료", cls: "bg-emerald-50 text-emerald-600", icon: Check },
  REJECTED: { label: "반려",     cls: "bg-rose-50 text-rose-500", icon: X },
};

interface Prof {
  id: string; profession: string; certNumber: string | null; experienceYears: number;
  isPrimary: boolean; verifyStatus: string; verifiedAt: string | null;
}

export default function ProfessionsPage() {
  const router = useRouter();
  const [list, setList] = useState<Prof[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ profession: "", certNumber: "", experienceYears: "" });
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/worker/professions");
      const d = await r.json();
      if (d.success) setList(d.professions);
      else if (r.status === 401) router.replace("/worker/login");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const held = new Set(list.filter((p) => p.verifyStatus !== "REJECTED").map((p) => p.profession));
  const addable = PROFS.filter((p) => !held.has(p.value));

  async function add() {
    setErr("");
    if (!form.profession) { setErr("직종을 선택해주세요."); return; }
    const r = await fetch("/api/worker/professions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profession: form.profession, certNumber: form.certNumber.trim() || null, experienceYears: Number(form.experienceYears) || 0 }),
    });
    const d = await r.json();
    if (d.success) { setAdding(false); setForm({ profession: "", certNumber: "", experienceYears: "" }); load(); }
    else setErr(d.message || "등록에 실패했습니다.");
  }

  async function remove(profession: string) {
    if (!confirm(`${LABEL[profession]} 자격을 삭제하시겠습니까?`)) return;
    const r = await fetch(`/api/worker/professions?profession=${profession}`, { method: "DELETE" });
    if ((await r.json()).success) load();
  }

  const inputCls = "h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:bg-white";

  return (
    <div className="min-h-dvh bg-slate-50 pb-10">
      <div className="mx-auto max-w-md">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-4">
          <button onClick={() => router.back()} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 active:scale-95"><ChevronLeft className="h-5 w-5" /></button>
          <h1 className="text-base font-black text-slate-900">보유 자격 관리</h1>
        </header>

        <div className="space-y-3 px-4 pt-4">
          <p className="text-xs font-semibold leading-relaxed text-slate-400">
            보유한 직종 자격을 등록·관리합니다. 추가하거나 수정하면 운영자 검증 후 활성화됩니다.
          </p>

          {loading ? (
            <p className="py-12 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
          ) : (
            <>
              {list.map((p) => {
                const st = STATUS[p.verifyStatus] ?? STATUS.PENDING;
                const Icon = st.icon;
                return (
                  <div key={p.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black text-slate-900">{LABEL[p.profession] ?? p.profession}</p>
                        {p.isPrimary && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">대표</span>}
                        <span className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-black ${st.cls}`}><Icon className="h-3 w-3" />{st.label}</span>
                      </div>
                      <button onClick={() => remove(p.profession)} className="text-slate-300 active:scale-90"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <p className="mt-1.5 text-xs font-semibold text-slate-400">자격번호: {p.certNumber || "미입력"} · 경력 {p.experienceYears}년</p>
                    {p.verifyStatus === "REJECTED" && (
                      <p className="mt-1 text-[11px] font-bold text-rose-500">반려됨 — 자격번호 확인 후 ‘자격 추가’에서 다시 제출해주세요.</p>
                    )}
                  </div>
                );
              })}
              {list.length === 0 && <p className="py-8 text-center text-sm font-semibold text-slate-300">등록된 자격이 없습니다.</p>}

              {/* 추가 */}
              {adding ? (
                <div className="rounded-2xl border border-sky-200 bg-white p-4">
                  <p className="mb-3 text-sm font-black text-slate-900">자격 추가</p>
                  <select value={form.profession} onChange={(e) => setForm((f) => ({ ...f, profession: e.target.value }))} className={`${inputCls} mb-2`}>
                    <option value="">직종 선택</option>
                    {addable.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <input value={form.certNumber} onChange={(e) => setForm((f) => ({ ...f, certNumber: e.target.value }))} className={`${inputCls} mb-2`} placeholder={PROFS.find((p) => p.value === form.profession)?.certHint || "자격번호"} />
                  <input value={form.experienceYears} onChange={(e) => setForm((f) => ({ ...f, experienceYears: e.target.value.replace(/\D/g, "") }))} className={inputCls} placeholder="경력 (년)" inputMode="numeric" />
                  {err && <p className="mt-2 text-xs font-semibold text-rose-500">{err}</p>}
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => { setAdding(false); setErr(""); }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-500 active:scale-95">취소</button>
                    <button onClick={add} className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95">등록</button>
                  </div>
                </div>
              ) : addable.length > 0 ? (
                <button onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white py-3.5 text-sm font-black text-slate-600 active:scale-[0.98]">
                  <Plus className="h-4 w-4" /> 자격 추가
                </button>
              ) : (
                <p className="py-2 text-center text-xs font-semibold text-slate-300">3개 직종을 모두 등록했습니다.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
