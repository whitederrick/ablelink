"use client";

// 후보자(워커) — 구직중 공개 토글 + 받은 제안함 (방향 B)
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

const PROF_LABEL: Record<string, string> = { JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사" };
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:  { label: "응답 대기", cls: "bg-amber-50 text-amber-600" },
  ACCEPTED: { label: "수락함",   cls: "bg-emerald-50 text-emerald-600" },
  DECLINED: { label: "거절함",   cls: "bg-slate-100 text-slate-400" },
};

interface Offer {
  id: string; agencyName: string; profession: string | null; siteName: string | null;
  message: string | null; status: string; createdAt: string;
}

export default function OffersPage() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, o] = await Promise.all([
        fetch("/api/worker/recruit/availability").then((r) => r.json()),
        fetch("/api/worker/recruit/offers").then((r) => r.json()),
      ]);
      if (a.success) setOpen(a.openToOffers);
      if (o.success) setOffers(o.offers);
      else if (!a.success) router.replace("/worker/login");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    await fetch("/api/worker/recruit/availability", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openToOffers: next }) });
  }

  async function decide(id: string, action: "accept" | "decline") {
    const r = await fetch("/api/worker/recruit/offers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
    if ((await r.json()).success) load();
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="mx-auto max-w-md">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur">
          <button onClick={() => router.back()} className="rounded-lg p-1 active:scale-90"><ChevronLeft className="h-5 w-5 text-slate-500" /></button>
          <h1 className="text-base font-black text-slate-900">받은 제안</h1>
        </header>

        {/* 구직중 토글 */}
        <div className="mx-4 mt-4 flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-4">
          <div>
            <p className="text-sm font-black text-slate-900">구직 중 (제안 받기)</p>
            <p className="text-xs font-semibold text-slate-400">켜면 에이전시가 내 프로필을 보고 제안할 수 있어요.</p>
          </div>
          <button onClick={toggle} className={`relative h-7 w-12 flex-shrink-0 rounded-full transition ${open ? "bg-sky-500" : "bg-slate-200"}`}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${open ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        <div className="space-y-3 px-4 pt-4">
          {loading ? (
            <p className="py-12 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
          ) : offers.length === 0 ? (
            <p className="py-12 text-center text-sm font-semibold text-slate-300">아직 받은 제안이 없습니다.{!open && " 구직 중을 켜보세요."}</p>
          ) : (
            offers.map((o) => {
              const st = STATUS[o.status] ?? STATUS.PENDING;
              return (
                <div key={o.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black text-slate-900">{o.agencyName}</p>
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-black ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">
                    {o.profession ? PROF_LABEL[o.profession] : "직무"}{o.siteName ? ` · ${o.siteName}` : ""}
                  </p>
                  {o.message && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm font-semibold text-slate-600">{o.message}</p>}
                  <p className="mt-2 text-[11px] font-semibold text-slate-300">{o.createdAt.slice(0, 10)}</p>
                  {o.status === "PENDING" && (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => decide(o.id, "decline")} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-500 active:scale-95">거절</button>
                      <button onClick={() => decide(o.id, "accept")} className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95">수락</button>
                    </div>
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
