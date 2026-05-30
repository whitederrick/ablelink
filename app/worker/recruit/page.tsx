"use client";

// 직무지도 매칭 — 공급측(워커/user) 공고 검색·조회
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search, MapPin, Clock, Users, ClipboardList } from "lucide-react";

const PROFESSIONS: { value: string; label: string }[] = [
  { value: "", label: "전체" },
  { value: "JOB_COACH", label: "직무지도원" },
  { value: "CAREGIVER", label: "요양보호사" },
  { value: "ACTIVITY_ASSISTANT", label: "활동지원사" },
];
const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};
const APP_LABEL: Record<string, string> = {
  PENDING: "신청됨", ACCEPTED: "수락됨", REJECTED: "반려", WITHDRAWN: "취소됨",
};

interface Post {
  id: string; title: string; companyName: string; profession: string;
  taskName: string | null; address: string; region: string | null;
  workHours: string | null; workDays: string | null; payInfo: string | null;
  headcount: number; createdAt: string; applicationCount: number;
  myApplication: { id: string; status: string } | null;
}

export default function RecruitBrowsePage() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [profession, setProfession] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (profession) sp.set("profession", profession);
    try {
      const r = await fetch(`/api/recruit/posts?${sp.toString()}`);
      const d = await r.json();
      if (d.success) setPosts(d.posts);
      else if (r.status === 401) router.replace("/worker/login");
    } finally { setLoading(false); }
  }, [q, profession, router]);

  useEffect(() => { load(); }, [profession]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="mx-auto max-w-md">
        {/* 헤더 */}
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur">
          <button onClick={() => router.back()} className="rounded-lg p-1 active:scale-90" aria-label="뒤로">
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </button>
          <h1 className="text-base font-black text-slate-900">직무지도 찾기</h1>
          <button
            onClick={() => router.push("/worker/recruit/applications")}
            className="ml-auto flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 active:scale-95"
          >
            <ClipboardList className="h-3.5 w-3.5" /> 내 신청
          </button>
        </header>

        {/* 검색 */}
        <div className="px-4 pt-4">
          <div className="flex gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && load()}
                placeholder="사업체명·과제·지역 검색"
                className="h-11 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-300"
              />
            </div>
            <button onClick={load} className="rounded-xl bg-slate-950 px-4 text-sm font-black text-white active:scale-95">검색</button>
          </div>
          {/* 직종 필터 */}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {PROFESSIONS.map((p) => (
              <button
                key={p.value}
                onClick={() => setProfession(p.value)}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-black transition active:scale-95 ${
                  profession === p.value ? "bg-sky-500 text-white" : "bg-white text-slate-500 border border-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 목록 */}
        <div className="space-y-3 px-4 pt-4">
          {loading ? (
            <p className="py-16 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
          ) : posts.length === 0 ? (
            <p className="py-16 text-center text-sm font-semibold text-slate-300">모집 중인 공고가 없습니다.</p>
          ) : (
            posts.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/worker/recruit/${p.id}`)}
                className="w-full rounded-2xl border border-slate-100 bg-white p-4 text-left transition active:scale-[0.98]"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-600">{PROF_LABEL[p.profession] ?? p.profession}</span>
                  {p.myApplication && (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-600">{APP_LABEL[p.myApplication.status]}</span>
                  )}
                </div>
                <p className="mt-2 text-sm font-black text-slate-900">{p.title}</p>
                <p className="text-xs font-bold text-slate-500">{p.companyName}{p.taskName ? ` · ${p.taskName}` : ""}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-400">
                  {p.region && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.region}</span>}
                  {p.workHours && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{p.workHours}</span>}
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{p.headcount}명 모집 · 신청 {p.applicationCount}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
