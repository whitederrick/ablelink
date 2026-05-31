"use client";

// 직무지도 매칭 — 내 신청 목록 (워커/user)
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: "검토 대기", cls: "bg-amber-50 text-amber-600" },
  ACCEPTED:  { label: "수락됨",   cls: "bg-emerald-50 text-emerald-600" },
  REJECTED:  { label: "반려",     cls: "bg-rose-50 text-rose-500" },
  WITHDRAWN: { label: "취소됨",   cls: "bg-slate-100 text-slate-400" },
};

interface App {
  id: string; status: string; message: string | null; createdAt: string;
  post: { id: string; title: string; companyName: string; profession: string; region: string | null; status: string };
}

export default function MyApplicationsPage() {
  const router = useRouter();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/recruit/applications");
      const d = await r.json();
      if (d.success) setApps(d.applications);
      else if (r.status === 401) router.replace("/worker/login");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function withdraw(id: string) {
    if (!confirm("신청을 취소하시겠습니까?")) return;
    const r = await fetch(`/api/recruit/applications?id=${id}`, { method: "DELETE" });
    const d = await r.json();
    if (d.success) load();
    else alert(d.message || "취소에 실패했습니다.");
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="mx-auto max-w-md">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur">
          <button onClick={() => router.back()} className="rounded-lg p-1 active:scale-90" aria-label="뒤로">
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </button>
          <h1 className="text-base font-black text-slate-900">내 직무지도 신청</h1>
        </header>

        <div className="space-y-3 px-4 pt-4">
          {loading ? (
            <p className="py-16 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
          ) : apps.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold text-slate-300">아직 신청한 공고가 없습니다.</p>
              <button onClick={() => router.push("/recruit")} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white active:scale-95">공고 둘러보기</button>
            </div>
          ) : (
            apps.map((a) => {
              const st = STATUS[a.status] ?? { label: a.status, cls: "bg-slate-100 text-slate-400" };
              return (
                <div key={a.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-600">{PROF_LABEL[a.post.profession] ?? a.post.profession}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-black ${st.cls}`}>{st.label}</span>
                  </div>
                  <button onClick={() => router.push(`/recruit/${a.post.id}`)} className="mt-2 block text-left">
                    <p className="text-sm font-black text-slate-900">{a.post.title}</p>
                    <p className="text-xs font-bold text-slate-500">{a.post.companyName}{a.post.region ? ` · ${a.post.region}` : ""}</p>
                  </button>
                  {a.message && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs font-semibold text-slate-500">{a.message}</p>}
                  <p className="mt-2 text-[11px] font-semibold text-slate-300">{a.createdAt.slice(0, 10)} 신청</p>
                  {(a.status === "PENDING") && (
                    <button onClick={() => withdraw(a.id)} className="mt-2 text-xs font-bold text-rose-500 active:scale-95">신청 취소</button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
