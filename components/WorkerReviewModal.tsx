"use client";

// 매칭된 인력 평가 모달 (에이전시/운영자) — 별점 + 후기, 기존 평가 조회/수정
import { useEffect, useState } from "react";

interface Review { id: string; rating: number; comment: string | null; by: string; createdAt: string }

export default function WorkerReviewModal({
  open, workerId, workerName, onClose,
}: { open: boolean; workerId: string; workerName: string; onClose: (changed?: boolean) => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setRating(5); setComment(""); setErr("");
    fetch(`/api/admin/worker-reviews?workerId=${workerId}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) { setReviews(d.reviews); setAvg(d.ratingAvg); setCount(d.ratingCount); } })
      .catch(() => {});
  }, [open, workerId]);

  if (!open) return null;

  async function submit() {
    setSubmitting(true); setErr("");
    try {
      const r = await fetch("/api/admin/worker-reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId, rating, comment: comment.trim() || undefined }),
      });
      const d = await r.json();
      if (d.success) onClose(true);
      else setErr(d.message || "평가 저장에 실패했습니다.");
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" onClick={() => onClose(false)}>
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-black text-slate-900">{workerName} 님 평가</p>
        {count > 0 && <p className="mt-0.5 text-xs font-bold text-amber-500">현재 평점 ★ {avg.toFixed(1)} ({count})</p>}

        {/* 별점 */}
        <div className="mt-4 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n)} className="text-3xl leading-none transition active:scale-90">
              <span className={n <= rating ? "text-amber-400" : "text-slate-200"}>★</span>
            </button>
          ))}
          <span className="ml-2 text-sm font-black text-slate-700">{rating}점</span>
        </div>

        <textarea
          value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
          placeholder="업무 태도·역량 등 후기를 남겨주세요 (선택)"
          className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
        />
        {err && <p className="mt-2 text-xs font-semibold text-rose-500">{err}</p>}

        {reviews.length > 0 && (
          <div className="mt-4 max-h-40 space-y-2 overflow-y-auto border-t border-slate-100 pt-3">
            {reviews.map((rv) => (
              <div key={rv.id} className="rounded-lg bg-slate-50 p-2.5">
                <p className="text-xs font-black text-amber-500">★ {rv.rating} <span className="text-slate-400">· {rv.by}</span></p>
                {rv.comment && <p className="mt-0.5 text-xs font-semibold text-slate-600">{rv.comment}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => onClose(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-500 active:scale-95">닫기</button>
          <button onClick={submit} disabled={submitting} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white active:scale-95 disabled:opacity-50">{submitting ? "저장 중…" : "평가 저장"}</button>
        </div>
      </div>
    </div>
  );
}
