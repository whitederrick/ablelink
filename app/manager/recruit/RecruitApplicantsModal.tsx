"use client";

// 직무지도 매칭 — 공고 지원자 현황 모달 (목록 '신청 N건' 클릭 또는 상세 모달에서 열림)
// 구 /manager/recruit/[id] 페이지를 모달화. 수락/반려/평가 동작 동일.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { T } from "../_styles";
import WorkerReviewModal from "@/components/WorkerReviewModal";

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: "대기", cls: "bg-amber-50 text-amber-600" },
  ACCEPTED:  { label: "수락", cls: "bg-emerald-50 text-emerald-600" },
  REJECTED:  { label: "반려", cls: "bg-rose-50 text-rose-500" },
  WITHDRAWN: { label: "취소", cls: "bg-slate-100 text-slate-400" },
};

interface Applicant {
  id: string; status: string; message: string | null; createdAt: string;
  worker: { id: string; name: string; phoneNumber: string; bio: string | null; residenceAddress: string | null; ratingAvg: number; ratingCount: number; professions: { profession: string; experienceYears: number; isPrimary: boolean; verifyStatus: string }[] };
}

export default function RecruitApplicantsModal({ postId, postTitle, onClose, onChanged }: {
  postId: string; postTitle: string; onClose: () => void; onChanged?: () => void;
}) {
  const router = useRouter();
  const [apps, setApps] = useState<Applicant[]>([]);
  const [headcount, setHeadcount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/recruit-posts/${postId}/applications`, { cache: "no-store" });
      const d = await r.json();
      if (d.success) { setApps(d.applications); setHeadcount(d.post?.headcount ?? null); }
      else if (r.status === 401) router.replace("/manager/login");
    } finally { setLoading(false); }
  }, [postId, router]);

  useEffect(() => { load(); }, [load]);

  async function decide(appId: string, action: "accept" | "reject") {
    const r = await fetch(`/api/admin/recruit-applications/${appId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    const d = await r.json();
    if (d.success) {
      if (action === "accept") {
        alert(d.autoAssigned
          ? "수락되었습니다. 해당 인력이 현장에 자동 배정되어 활성 인력으로 편입되었습니다."
          : "수락되었습니다.");
      }
      await load();
      onChanged?.();
    } else alert(d.message || "처리에 실패했습니다.");
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
        <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
          {/* 헤더 */}
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black text-slate-900">지원자 현황</h2>
              <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-400">
                {postTitle}{headcount != null ? ` · ${headcount}명 모집` : ""} · 신청 {apps.length}건
              </p>
            </div>
            <button onClick={onClose} className="shrink-0 rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" /></div>
            ) : apps.length === 0 ? (
              <div className={T.card}><p className="py-8 text-center text-sm font-semibold text-slate-300">아직 신청자가 없습니다.</p></div>
            ) : (
              apps.map((a) => {
                const st = STATUS[a.status] ?? { label: a.status, cls: "bg-slate-100 text-slate-400" };
                const primary = a.worker.professions.find((p) => p.isPrimary) ?? a.worker.professions[0];
                return (
                  <div key={a.id} className={T.card}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-black text-slate-900">{a.worker.name}</p>
                          <span className={`${T.badge} ${st.cls}`}>{st.label}</span>
                        </div>
                        <p className="mt-0.5 text-xs font-semibold text-slate-400">{a.worker.phoneNumber}{a.worker.residenceAddress ? ` · ${a.worker.residenceAddress}` : ""}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-500">
                          {primary && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-600">{PROF_LABEL[primary.profession] ?? primary.profession} · {primary.experienceYears}년</span>}
                          {primary && (primary.verifyStatus === "VERIFIED"
                            ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-600">자격 검증완료</span>
                            : primary.verifyStatus === "REJECTED"
                            ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-500">자격 반려</span>
                            : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-600">자격 검증대기</span>)}
                          {a.worker.ratingCount > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-600">★ {a.worker.ratingAvg.toFixed(1)} ({a.worker.ratingCount})</span>}
                        </div>
                        {a.message && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm font-semibold text-slate-600">{a.message}</p>}
                      </div>
                      {a.status === "PENDING" ? (
                        <div className="flex flex-shrink-0 gap-2">
                          <button onClick={() => decide(a.id, "reject")} className={T.btnSecondary}>반려</button>
                          <button onClick={() => decide(a.id, "accept")} className={T.btnPrimary}>수락</button>
                        </div>
                      ) : a.status === "ACCEPTED" ? (
                        <button onClick={() => setReviewTarget({ id: a.worker.id, name: a.worker.name })} className={`flex-shrink-0 ${T.btnSecondary}`}>평가</button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-slate-300">{a.createdAt.slice(0, 10)} 신청</p>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-5 flex justify-end">
            <button onClick={onClose} className={T.btnSecondary}>닫기</button>
          </div>
        </div>
      </div>

      <WorkerReviewModal
        open={!!reviewTarget}
        workerId={reviewTarget?.id ?? ""}
        workerName={reviewTarget?.name ?? ""}
        onClose={(changed) => { setReviewTarget(null); if (changed) load(); }}
      />
    </>
  );
}
