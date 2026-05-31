"use client";

// 직무지도 매칭 — 공고 신청자 목록 + 수락/반려 (에이전시 매니저)
import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { T } from "../../_styles";
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
interface PostInfo { id: string; title: string; companyName: string; status: string; headcount: number; }

export default function ManagerRecruitApplicantsPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params.id);
  const [post, setPost] = useState<PostInfo | null>(null);
  const [apps, setApps] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/recruit-posts/${id}/applications`);
      const d = await r.json();
      if (d.success) { setPost(d.post); setApps(d.applications); }
      else if (r.status === 401) router.replace("/manager/login");
    } finally { setLoading(false); }
  }, [id, router]);

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
      load();
    } else alert(d.message || "처리에 실패했습니다.");
  }

  return (
    <div className="p-6">
      <button onClick={() => router.push("/manager/recruit")} className="mb-3 text-sm font-bold text-slate-400 hover:text-slate-600">← 공고 목록</button>
      <div className="mb-5">
        <h1 className={T.pageTitle}>{post ? post.title : "신청자"}</h1>
        <p className={T.pageSub}>{post ? `${post.companyName} · ${post.headcount}명 모집 · 신청 ${apps.length}건` : ""}</p>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className={T.empty}>불러오는 중…</p>
        ) : apps.length === 0 ? (
          <div className={T.card}><p className="py-8 text-center text-sm font-semibold text-slate-300">아직 신청자가 없습니다.</p></div>
        ) : (
          apps.map((a) => {
            const st = STATUS[a.status] ?? { label: a.status, cls: "bg-slate-100 text-slate-400" };
            const primary = a.worker.professions.find((p) => p.isPrimary) ?? a.worker.professions[0];
            return (
              <div key={a.id} className={T.card}>
                <div className="flex items-start justify-between">
                  <div>
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

      <WorkerReviewModal
        open={!!reviewTarget}
        workerId={reviewTarget?.id ?? ""}
        workerName={reviewTarget?.name ?? ""}
        onClose={(changed) => { setReviewTarget(null); if (changed) load(); }}
      />
    </div>
  );
}
