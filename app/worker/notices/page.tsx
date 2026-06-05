"use client";

// 워커 공지 게시판 — 운영자/소속기관 공지 열람(읽기 전용).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Pin, Megaphone } from "lucide-react";

type Item = {
  id: string; scope: "AGENCY" | "SYSTEM"; scopeLabel: string;
  title: string; body: string; type: string; pinned: boolean; createdAt: string;
};

const TYPE_CLS: Record<string, string> = {
  URGENT: "bg-rose-50 text-rose-600",
  WARN: "bg-amber-50 text-amber-600",
  MAINTENANCE: "bg-amber-50 text-amber-600",
  INFO: "bg-sky-50 text-sky-600",
};
const TYPE_LABEL: Record<string, string> = { URGENT: "긴급", WARN: "주의", MAINTENANCE: "점검", INFO: "안내" };

export default function WorkerNoticesBoard() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/worker/announcements")
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.announcements); else if (d.message?.includes("인증")) router.replace("/worker/login"); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <div className="min-h-dvh bg-slate-50 pb-10">
      <div className="mx-auto max-w-md">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur">
          <button onClick={() => router.back()} className="rounded-lg p-1 active:scale-90" aria-label="뒤로">
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </button>
          <h1 className="text-base font-black text-slate-900">공지사항</h1>
        </header>

        <div className="space-y-2.5 px-4 pt-4">
          {loading ? (
            <p className="py-16 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-300">
              <Megaphone className="h-8 w-8" />
              <p className="text-sm font-semibold">등록된 공지가 없습니다.</p>
            </div>
          ) : (
            items.map(it => {
              const expanded = open === it.id;
              return (
                <button
                  key={it.id}
                  onClick={() => setOpen(expanded ? null : it.id)}
                  className="w-full rounded-2xl border border-slate-100 bg-white p-4 text-left transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-1.5">
                    {it.pinned && <Pin className="h-3 w-3 flex-shrink-0 fill-rose-500 text-rose-500" />}
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${TYPE_CLS[it.type] ?? TYPE_CLS.INFO}`}>
                      {TYPE_LABEL[it.type] ?? "안내"}
                    </span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{it.scopeLabel}</span>
                    <span className="ml-auto text-[10px] font-semibold text-slate-300">{it.createdAt.slice(0, 10)}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-black text-slate-900">{it.title}</p>
                  <p className={`mt-1 whitespace-pre-line text-xs font-semibold leading-relaxed text-slate-500 ${expanded ? "" : "line-clamp-2"}`}>
                    {it.body}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
