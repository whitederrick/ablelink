"use client";

// 직무지도원 평가 질문지 편집 (시스템 운영자) — 카테고리·문항·배점(100점) + 주관식 의견란.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, GripVertical, Wand2 } from "lucide-react";
import { T } from "../../_styles";

type Q = { text: string; maxScore: number };
type Cat = { name: string; questions: Q[] };

// 4개 카테고리 · 15문항 · 합계 100점 기본 양식
const DEFAULT_CATS: Cat[] = [
  { name: "전문성", questions: [
    { text: "장애 유형·특성에 대한 이해도", maxScore: 8 },
    { text: "직무 분석 및 과제 구성 역량", maxScore: 8 },
    { text: "훈련 계획 수립의 적절성", maxScore: 7 },
    { text: "문제 상황 대처 능력", maxScore: 7 },
  ] },
  { name: "성실성·태도", questions: [
    { text: "출근·근태의 성실성", maxScore: 7 },
    { text: "업무에 대한 책임감", maxScore: 6 },
    { text: "기록·문서 작성의 정확성", maxScore: 6 },
    { text: "적극성·자기개발 노력", maxScore: 6 },
  ] },
  { name: "의사소통·협력", questions: [
    { text: "훈련생과의 소통·라포 형성", maxScore: 7 },
    { text: "사업체 담당자와의 협업", maxScore: 6 },
    { text: "보호자 상담·소통", maxScore: 6 },
    { text: "기관 내 팀 협업", maxScore: 6 },
  ] },
  { name: "성과·윤리", questions: [
    { text: "훈련생 직무 적응 성과", maxScore: 7 },
    { text: "취업·고용 유지 기여도", maxScore: 7 },
    { text: "직업윤리·개인정보 보호 준수", maxScore: 6 },
  ] },
];

export default function EvalFormEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [includeOpinion, setIncludeOpinion] = useState(true);
  const [isActive, setIsActive] = useState(false);
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/system/eval-forms/${id}`).then(r => r.json())
      .then(d => {
        if (d.success) { setTitle(d.form.title); setDescription(d.form.description); setIncludeOpinion(d.form.includeOpinion); setIsActive(d.form.isActive); setCats(d.form.categories); }
        else if (d.message) showToast(d.message);
      }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const catTotal = (c: Cat) => c.questions.reduce((s, q) => s + (Number(q.maxScore) || 0), 0);
  const grandTotal = cats.reduce((s, c) => s + catTotal(c), 0);
  const questionCount = cats.reduce((s, c) => s + c.questions.length, 0);

  // 카테고리/문항 조작
  const addCat = () => setCats(p => [...p, { name: "", questions: [] }]);
  const removeCat = (ci: number) => setCats(p => p.filter((_, i) => i !== ci));
  const renameCat = (ci: number, name: string) => setCats(p => p.map((c, i) => i === ci ? { ...c, name } : c));
  const addQ = (ci: number) => setCats(p => p.map((c, i) => i === ci ? { ...c, questions: [...c.questions, { text: "", maxScore: 0 }] } : c));
  const removeQ = (ci: number, qi: number) => setCats(p => p.map((c, i) => i === ci ? { ...c, questions: c.questions.filter((_, j) => j !== qi) } : c));
  const editQ = (ci: number, qi: number, patch: Partial<Q>) => setCats(p => p.map((c, i) => i === ci ? { ...c, questions: c.questions.map((q, j) => j === qi ? { ...q, ...patch } : q) } : c));

  function loadDefault() {
    if (cats.length > 0 && !confirm("현재 카테고리·문항을 기본 양식(4카테고리·15문항·100점)으로 교체합니다. 계속할까요?")) return;
    setCats(JSON.parse(JSON.stringify(DEFAULT_CATS)));
  }

  async function save(thenActivate = false) {
    if (!title.trim()) { showToast("제목을 입력해주세요."); return; }
    setSaving(true);
    const res = await fetch(`/api/admin/system/eval-forms/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description, includeOpinion, categories: cats }),
    });
    const d = await res.json();
    if (!d.success) { setSaving(false); showToast(d.message || "저장 실패"); return; }
    if (thenActivate && !isActive) {
      await fetch(`/api/admin/system/eval-forms/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-active", isActive: true }) });
      setIsActive(true);
    }
    setSaving(false);
    showToast(thenActivate ? "저장 후 활성 질문지로 설정했습니다." : "저장되었습니다.");
    load();
  }

  if (loading) return <div className="flex h-60 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" /></div>;

  return (
    <div className="space-y-5">
      <div>
        <button onClick={() => router.push("/admin/eval-forms")} className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" />평가 질문지 목록
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-black text-slate-900">질문지 편집</h1>
            {isActive && <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>활성</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadDefault} className={`${T.btnSecondary} inline-flex items-center gap-1.5`}><Wand2 className="h-4 w-4" />기본 양식 불러오기</button>
            <button onClick={() => save(false)} disabled={saving} className={T.btnSecondary}>{saving ? "저장 중…" : "저장"}</button>
            <button onClick={() => save(true)} disabled={saving} className={T.btnPrimary}>저장 후 활성화</button>
          </div>
        </div>
      </div>

      {/* 기본 정보 + 점수 요약 */}
      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className={`${T.card} space-y-3`}>
          <div>
            <label className={T.label}>질문지 제목</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={`w-full ${T.input}`} placeholder="예: 2026 직무지도원 평가표" />
          </div>
          <div>
            <label className={T.label}>설명 (선택)</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className={`w-full ${T.input}`} placeholder="질문지 용도·평가 시점 등" />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <input type="checkbox" checked={includeOpinion} onChange={e => setIncludeOpinion(e.target.checked)} className="h-4 w-4 accent-slate-950" />
            <span className="text-sm font-semibold text-slate-700">평가자 주관식 의견란 포함</span>
          </label>
        </div>
        <div className={`${T.card} text-center`}>
          <p className="text-xs font-semibold text-slate-400">배점 합계</p>
          <p className={`mt-1 text-4xl font-black leading-none ${grandTotal === 100 ? "text-emerald-600" : "text-amber-600"}`}>{grandTotal}<span className="text-lg text-slate-300">/100</span></p>
          <p className="mt-2 text-[13px] font-semibold text-slate-500">카테고리 {cats.length} · 문항 {questionCount}</p>
          {grandTotal !== 100 && <p className="mt-1 text-[13px] font-bold text-amber-600">합계가 100점이 되도록 배점을 조정하세요</p>}
        </div>
      </div>

      {/* 카테고리·문항 편집 */}
      <div className="space-y-3">
        {cats.map((c, ci) => (
          <div key={ci} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
              <input value={c.name} onChange={e => renameCat(ci, e.target.value)} placeholder={`카테고리 ${ci + 1} 이름`}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-black text-slate-900 outline-none focus:border-sky-400" />
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[13px] font-black ${catTotal(c) > 0 ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-400"}`}>소계 {catTotal(c)}점</span>
              <button onClick={() => removeCat(ci)} title="카테고리 삭제" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-1.5">
              {c.questions.map((q, qi) => (
                <div key={qi} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-center text-[13px] font-semibold text-slate-400">{qi + 1}</span>
                  <input value={q.text} onChange={e => editQ(ci, qi, { text: e.target.value })} placeholder="문항 내용"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 outline-none focus:border-sky-400" />
                  <div className="flex shrink-0 items-center gap-1">
                    <input type="number" min={0} value={q.maxScore} onChange={e => editQ(ci, qi, { maxScore: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                      className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm font-bold text-slate-800 outline-none focus:border-sky-400" />
                    <span className="text-[13px] text-slate-400">점</span>
                  </div>
                  <button onClick={() => removeQ(ci, qi)} title="문항 삭제" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <button onClick={() => addQ(ci)} className="mt-1 inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-[13px] font-bold text-slate-500 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />문항 추가</button>
            </div>
          </div>
        ))}
        <button onClick={addCat} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50"><Plus className="h-4 w-4" />카테고리 추가</button>
      </div>

      {includeOpinion && (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-sm font-black text-slate-700">평가자 주관식 의견란</p>
          <p className="mt-1 text-[13px] text-slate-500">평가 시 점수 외에 자유 서술 의견을 입력할 수 있는 칸이 표시됩니다. (질문지에 포함됨)</p>
          <div className="mt-2 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-[13px] text-slate-300">자유 의견 입력란 (평가 화면에서 표시)</div>
        </div>
      )}

      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
