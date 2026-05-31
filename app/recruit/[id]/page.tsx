"use client";

// 직무지도 매칭 — 공고 상세 + 신청 (워커/user)
import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronLeft, MapPin, Clock, CalendarDays, Users, Banknote, Building2 } from "lucide-react";

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};
const APP_LABEL: Record<string, string> = {
  PENDING: "신청 완료 (검토 대기)", ACCEPTED: "수락됨 🎉", REJECTED: "반려됨", WITHDRAWN: "신청 취소됨",
};

interface Post {
  id: string; title: string; companyName: string; profession: string;
  taskName: string | null; address: string; detailAddress: string | null;
  region: string | null; workHours: string | null; workDays: string | null;
  payInfo: string | null; headcount: number; description: string | null;
  status: string; agencyName: string | null; contactName: string | null; contactPhone: string | null;
  myApplication: { id: string; status: string } | null;
}

export default function RecruitDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params.id);
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [showApply, setShowApply] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/recruit/posts/${id}`);
      const d = await r.json();
      if (d.success) setPost(d.post);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function apply() {
    setSubmitting(true);
    try {
      const r = await fetch("/api/recruit/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recruitPostId: id, message: message.trim() || undefined }),
      });
      const d = await r.json();
      if (d.success) { setShowApply(false); setMessage(""); await load(); }
      else alert(d.message || "신청에 실패했습니다.");
    } finally { setSubmitting(false); }
  }

  if (loading) return <Shell><p className="py-16 text-center text-sm font-semibold text-slate-300">불러오는 중…</p></Shell>;
  if (!post) return <Shell><p className="py-16 text-center text-sm font-semibold text-slate-300">공고를 찾을 수 없습니다.</p></Shell>;

  const applied = !!post.myApplication && post.myApplication.status !== "WITHDRAWN";
  const closed = post.status !== "OPEN";

  return (
    <Shell>
      <div className="px-4 pt-4">
        <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-600">{PROF_LABEL[post.profession] ?? post.profession}</span>
        {closed && <span className="ml-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">마감</span>}
        <h1 className="mt-2 text-lg font-black leading-snug text-slate-900">{post.title}</h1>
        <p className="mt-0.5 text-sm font-bold text-slate-500">{post.companyName}</p>
        {post.agencyName && <p className="text-xs font-semibold text-slate-400">{post.agencyName}</p>}

        <div className="mt-4 space-y-2.5 rounded-2xl border border-slate-100 bg-white p-4">
          {post.taskName && <Row icon={<Building2 className="h-4 w-4" />} label="직무지도 과제(사업명)" value={post.taskName} />}
          <Row icon={<MapPin className="h-4 w-4" />} label="위치" value={`${post.address}${post.detailAddress ? " " + post.detailAddress : ""}`} />
          {post.workHours && <Row icon={<Clock className="h-4 w-4" />} label="근무시간" value={post.workHours} />}
          {post.workDays && <Row icon={<CalendarDays className="h-4 w-4" />} label="근무요일" value={post.workDays} />}
          {post.payInfo && <Row icon={<Banknote className="h-4 w-4" />} label="급여" value={post.payInfo} />}
          <Row icon={<Users className="h-4 w-4" />} label="모집 인원" value={`${post.headcount}명`} />
        </div>

        {post.description && (
          <div className="mt-3 rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-1 text-xs font-black text-slate-700">상세 설명</p>
            <p className="whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-600">{post.description}</p>
          </div>
        )}

        {(post.contactName || post.contactPhone) && (
          <div className="mt-3 rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-1 text-xs font-black text-slate-700">담당자</p>
            <p className="text-sm font-semibold text-slate-600">{post.contactName ?? ""} {post.contactPhone ?? ""}</p>
          </div>
        )}
      </div>

      {/* 신청 버튼 / 상태 */}
      <div className="sticky bottom-0 mt-6 border-t border-slate-100 bg-white/90 px-4 py-3 backdrop-blur">
        {post.myApplication && post.myApplication.status !== "WITHDRAWN" ? (
          <div className="rounded-xl bg-amber-50 py-3 text-center text-sm font-black text-amber-700">{APP_LABEL[post.myApplication.status]}</div>
        ) : closed ? (
          <div className="rounded-xl bg-slate-100 py-3 text-center text-sm font-black text-slate-400">마감된 공고입니다</div>
        ) : (
          <button onClick={() => setShowApply(true)} className="min-h-12 w-full rounded-2xl bg-slate-950 text-sm font-black text-white active:scale-[0.98]">
            직무지도 신청하기
          </button>
        )}
      </div>

      {/* 신청 모달 */}
      {showApply && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setShowApply(false)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-black text-slate-900">직무지도 신청</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">{post.companyName} · {post.title}</p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="간단한 자기소개나 지원 동기를 남겨주세요 (선택)"
              className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setShowApply(false)} className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 active:scale-[0.97]">취소</button>
              <button onClick={apply} disabled={submitting} className="min-h-11 flex-1 rounded-xl bg-slate-950 text-sm font-black text-white active:scale-[0.97] disabled:opacity-50">
                {submitting ? "신청 중…" : "신청"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-md">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur">
          <button onClick={() => router.back()} className="rounded-lg p-1 active:scale-90" aria-label="뒤로">
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </button>
          <h1 className="text-base font-black text-slate-900">공고 상세</h1>
        </header>
        {children}
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="flex-1">
        <p className="text-[11px] font-black text-slate-400">{label}</p>
        <p className="text-sm font-semibold text-slate-700">{value}</p>
      </div>
    </div>
  );
}
