"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, CheckCircle2 } from "lucide-react";

// 지원고용 훈련생 종합 평가기록부
// evalType = "TRAINING", label1 = "사전훈련", label2 = "현장훈련"

const SECTIONS = [
  { code: "WORK_ATTITUDE", label: "근무태도", items: [
    "결근, 지각, 조퇴 등을 하지 않는다",
    "결근, 지각, 조퇴 등을 할 때는 연락을 취한다",
    "휴식시간과 근무시간을 잘 지킨다",
    "주의사항을 잘 듣고 그대로 이행한다",
    "외모를 깨끗하고 단정하게 유지한다",
  ]},
  { code: "INTERPERSONAL", label: "대인관계", items: [
    "상황에 맞는 적절한 경어를 사용한다",
    "주위동료와 협조를 잘한다",
    "상사, 동료, 고객에게 인사를 잘한다",
    "질문에 적절한 답변을 할 수 있다",
    "다른 사람의 이야기를 잘 청취한다.",
  ]},
  { code: "WORK_STYLE", label: "작업태도", items: [
    "적극적으로 업무에 참여한다",
    "지시없이 스스로 자신의 일을 수행한다",
    "열심히 작업에 몰두한다",
    "목표량을 완수하면 다른 일거리를 찾는다",
    "잘못을 지적할 때 호의적으로 반응한다",
  ]},
  { code: "WORK_PERFORMANCE", label: "작업수행", items: [
    "도구나 기계를 잘 다룬다.",
    "지시한 방법대로 작업을 수행한다(정확성)",
    "근무시간동안 산만하지 않고, 꾸준히 일한다.",
    "주어진 작업량을 완수한다.",
    "직무를 수행할수록, 속도와 정확성이 증가한다.(숙련성)",
  ]},
];

type ScoreRow = { initial: string; final: string };
type Scores = Record<string, ScoreRow[]>;
type Comments = Record<string, string>;

function defaultScores(): Scores {
  return Object.fromEntries(SECTIONS.map(s => [s.code, Array.from({ length: 5 }, () => ({ initial: "", final: "" }))]));
}
function calcTotal(scores: Scores, field: "initial" | "final") {
  return Object.values(scores).flat().reduce((sum, r) => sum + (parseInt(r[field]) || 0), 0);
}

function TrainingEvalInner() {
  const router = useRouter();
  const params = useSearchParams();
  const traineeId   = params.get("traineeId") || "";
  const traineeName = params.get("traineeName") || "훈련생";
  const periodStart = params.get("periodStart") || "";
  const periodEnd   = params.get("periodEnd") || "";

  const [scores, setScores]       = useState<Scores>(defaultScores());
  const [comments, setComments]   = useState<Comments>({});
  const [evalId, setEvalId]       = useState<string | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState("");

  useEffect(() => {
    if (!traineeId) { setLoading(false); return; }
    fetch(`/api/worker/evaluation?traineeId=${traineeId}&evalType=TRAINING&periodStart=${periodStart}&periodEnd=${periodEnd}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.evaluation) {
          if (d.evaluation.scores)      setScores(d.evaluation.scores as Scores);
          if (d.evaluation.comments)    setComments(d.evaluation.comments as Comments);
          if (d.evaluation.id)          setEvalId(d.evaluation.id);
          if (d.evaluation.isConfirmed) setIsConfirmed(d.evaluation.isConfirmed);
        }
      })
      .finally(() => setLoading(false));
  }, [traineeId, periodStart, periodEnd]);

  const setScore = useCallback((code: string, idx: number, field: "initial" | "final", val: string) => {
    setScores(prev => {
      const next = { ...prev, [code]: [...prev[code]] };
      next[code][idx] = { ...next[code][idx], [field]: val };
      return next;
    });
  }, []);

  const setComment = useCallback((code: string, val: string) => {
    setComments(prev => ({ ...prev, [code]: val }));
  }, []);

  async function save() {
    if (!traineeId) return;
    setSaving(true);
    const res = await fetch("/api/worker/evaluation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traineeId, evalType: "TRAINING", periodStart, periodEnd, scores, comments }),
    });
    const d = await res.json();
    setSaving(false);
    if (d.success) {
      if (d.id) setEvalId(d.id);
      setToast("저장되었습니다."); setTimeout(() => setToast(""), 2500);
    } else setToast("저장 실패: " + (d.message || ""));
  }

  async function confirm() {
    if (!evalId) { setToast("먼저 저장해주세요."); return; }
    if (!window.confirm("평가를 최종 확정하시겠습니까?\n확정 후에는 수정할 수 없습니다.")) return;
    setSaving(true);
    const res = await fetch(`/api/worker/evaluation/${evalId}/confirm`, { method: "PATCH" });
    const d   = await res.json();
    setSaving(false);
    if (d.success) { setIsConfirmed(true); setToast("확정되었습니다."); setTimeout(() => setToast(""), 2500); }
    else setToast(d.message || "확정 실패");
  }

  if (loading) return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50 pb-20">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-4">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-base font-black text-slate-900">지원고용 훈련생 종합 평가기록부</h1>
          <p className="text-xs font-semibold text-slate-400">{traineeName} · {periodStart} ~ {periodEnd}</p>
        </div>
      </header>

      {/* 안내 */}
      <div className="mx-4 mt-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
        <p className="text-xs font-semibold text-sky-700">
          <span className="font-black">사전훈련</span> 단계와 <span className="font-black">현장훈련</span> 단계 각각 평가합니다.
        </p>
        <p className="mt-1 text-[11px] text-sky-600">채점 기준: 우수 5점 · 양호 4점 · 보통 3점 · 미흡 2점 · 불량 1점</p>
      </div>

      <div className="mx-auto max-w-md space-y-3 px-4 py-3">
        {SECTIONS.map(sec => (
          <div key={sec.code} className="rounded-2xl border border-slate-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-black text-slate-900">{sec.label}</span>
              <span className="text-xs font-semibold text-slate-400">
                사전: {sec.items.reduce((s, _, i) => s + (parseInt(scores[sec.code]?.[i]?.initial) || 0), 0)}점 /
                현장: {sec.items.reduce((s, _, i) => s + (parseInt(scores[sec.code]?.[i]?.final) || 0), 0)}점
              </span>
            </div>
            <div className="space-y-3">
              {sec.items.map((item, idx) => (
                <div key={idx} className="border-b border-slate-50 pb-3 last:border-b-0 last:pb-0">
                  <p className="mb-2 text-xs font-semibold leading-relaxed text-slate-700">{idx + 1}. {item}</p>
                  <div className="flex gap-4">
                    {[
                      { label: "사전훈련", field: "initial" as const },
                      { label: "현장훈련", field: "final" as const },
                    ].map(({ label, field }) => (
                      <div key={field} className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400">{label}</span>
                        <select value={scores[sec.code]?.[idx]?.[field] || ""}
                          onChange={e => setScore(sec.code, idx, field, e.target.value)}
                          className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-900 outline-none focus:border-sky-400">
                          <option value="">-</option>
                          {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v}점</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold text-slate-400">평가소견</p>
              <textarea value={comments[sec.code] || ""} onChange={e => setComment(sec.code, e.target.value)}
                placeholder="평가소견을 입력하세요"
                className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700 outline-none focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                rows={3} />
            </div>
          </div>
        ))}

        {/* 총점 */}
        <div className="rounded-2xl bg-slate-950 px-5 py-4">
          <p className="mb-3 text-xs font-black text-slate-400">총점 (만점 100점)</p>
          <div className="flex gap-5">
            <div className="flex-1 rounded-xl bg-slate-800 px-4 py-3 text-center">
              <p className="text-[11px] font-semibold text-slate-400">사전훈련</p>
              <p className="text-2xl font-black text-white">{calcTotal(scores, "initial")}점</p>
            </div>
            <div className="flex-1 rounded-xl bg-slate-800 px-4 py-3 text-center">
              <p className="text-[11px] font-semibold text-slate-400">현장훈련</p>
              <p className="text-2xl font-black text-white">{calcTotal(scores, "final")}점</p>
            </div>
          </div>
        </div>

        {isConfirmed ? (
          <div className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-black text-white">
            <CheckCircle2 className="h-5 w-5" />확정 완료
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !traineeId}
              className="min-h-14 flex-1 rounded-2xl bg-slate-700 text-base font-black text-white transition active:scale-[0.97] disabled:opacity-60">
              {saving ? "저장 중..." : "저장"}
            </button>
            <button onClick={confirm} disabled={saving || !evalId}
              className="min-h-14 flex-[2] rounded-2xl bg-slate-950 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-60">
              최종 확정
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function TrainingEvalPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm font-semibold text-slate-400">로딩 중...</div>}>
      <TrainingEvalInner />
    </Suspense>
  );
}
