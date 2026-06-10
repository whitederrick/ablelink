"use client";

// 직무지도원 평가 질문지 관리 (시스템 운영자) — 목록 + 생성/활성/삭제. 편집은 상세 페이지.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import { StatCardRow } from "../_components/StatCard";

type Form = {
  id: string; title: string; description: string; isActive: boolean; includeOpinion: boolean;
  categoryCount: number; questionCount: number; totalScore: number; updatedAt: string;
};

export default function EvalFormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/system/eval-forms").then(r => r.json())
      .then(d => { if (d.success) setForms(d.forms); }).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!newTitle.trim()) { showToast("제목을 입력해주세요."); return; }
    setProcessing(true);
    const res = await fetch("/api/admin/system/eval-forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle.trim() }) });
    const d = await res.json(); setProcessing(false);
    if (d.success) { router.push(`/admin/eval-forms/${d.id}`); }
    else showToast(d.message || "생성 실패");
  }

  async function toggleActive(f: Form) {
    setProcessing(true);
    const res = await fetch(`/api/admin/system/eval-forms/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-active", isActive: !f.isActive }) });
    const d = await res.json(); setProcessing(false);
    if (d.success) { showToast(d.message); load(); } else showToast(d.message || "실패");
  }

  async function remove(f: Form) {
    if (!confirm(`'${f.title}' 질문지를 삭제하시겠습니까? (문항 전체 삭제)`)) return;
    setProcessing(true);
    const res = await fetch(`/api/admin/system/eval-forms/${f.id}`, { method: "DELETE" });
    const d = await res.json(); setProcessing(false);
    if (d.success) { showToast("삭제되었습니다."); load(); } else showToast(d.message || "실패");
  }

  const activeCnt = forms.filter(f => f.isActive).length;

  return (
    <div>
      <PageHeader
        title="직무지도원 평가 관리"
        sub="직무지도원 평가에 사용할 질문지를 등록·관리합니다. 카테고리·문항·배점(100점 만점)과 주관식 의견란을 구성하세요."
        actions={<button onClick={() => setCreating(true)} className={`${T.btnPrimary} inline-flex items-center gap-1.5`}><Plus className="h-4 w-4" />평가표 등록</button>}
      />

      <StatCardRow
        className="mb-5"
        cols={2}
        items={[
          { label: "전체 질문지", value: forms.length },
          { label: "활성 질문지", value: activeCnt, tone: "emerald" },
        ]}
      />

      {creating && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus placeholder="질문지 제목 (예: 2026 직무지도원 평가표)"
            onKeyDown={e => e.key === "Enter" && create()}
            className={`flex-1 ${T.input}`} />
          <button onClick={create} disabled={processing} className={T.btnPrimary}>{processing ? "생성 중…" : "생성 후 편집"}</button>
          <button onClick={() => { setCreating(false); setNewTitle(""); }} className={T.btnSecondary}>취소</button>
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" /></div>
      ) : forms.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white"><p className="text-sm text-slate-400">등록된 질문지가 없습니다. ‘새 질문지’로 만들어보세요.</p></div>
      ) : (
        <div className="space-y-2">
          {forms.map(f => (
            <div key={f.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button onClick={() => router.push(`/admin/eval-forms/${f.id}`)} className="truncate text-[15px] font-black text-slate-900 hover:text-sky-600 hover:underline">{f.title}</button>
                  {f.isActive && <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>활성</span>}
                </div>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  카테고리 {f.categoryCount} · 문항 {f.questionCount} · 배점 합계 <span className={f.totalScore === 100 ? "font-bold text-emerald-600" : "font-bold text-amber-600"}>{f.totalScore}</span>/100
                  {f.includeOpinion ? " · 주관식 의견 포함" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button onClick={() => toggleActive(f)} disabled={processing} title={f.isActive ? "비활성화" : "활성으로 설정"}
                  className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-bold active:scale-95 ${f.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />{f.isActive ? "활성" : "활성화"}
                </button>
                <button onClick={() => router.push(`/admin/eval-forms/${f.id}`)} title="편집"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 active:scale-95"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(f)} title="삭제"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50 active:scale-95"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
