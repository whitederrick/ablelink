"use client";

// 워커 공지사항 — 공지 + 알림(전체/그룹/개별) 통합 목록. 클릭 시 팝업 상세 + 읽음 처리.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Megaphone, X } from "lucide-react";

type Item = {
  id: string; title: string; body: string;
  type: string; kind: string; yearMonth: string | null;
  link: string | null; read: boolean; createdAt: string;
};

const KIND: Record<string, { label: string; cls: string }> = {
  ANNOUNCEMENT:      { label: "공지", cls: "bg-indigo-100 text-indigo-700" },
  NOTICE_ALL:        { label: "전체", cls: "bg-slate-200 text-slate-700" },
  NOTICE_GROUP:      { label: "그룹", cls: "bg-violet-100 text-violet-700" },
  NOTICE_INDIVIDUAL: { label: "개별", cls: "bg-emerald-100 text-emerald-700" },
};
const TYPE_CLS: Record<string, string> = {
  WARN: "bg-amber-50 text-amber-600",
  REJECT: "bg-rose-50 text-rose-600",
  INFO: "bg-sky-50 text-sky-600",
};
const TYPE_LABEL: Record<string, string> = { WARN: "주의", REJECT: "반려", INFO: "안내" };

export default function WorkerNoticesBoard() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Item | null>(null);

  useEffect(() => {
    fetch("/api/worker/notices")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setItems(d.notices);
          // 홈 알림에서 넘어온 딥링크(?open=<id>) → 해당 알림 상세 자동 표시
          const openId = new URLSearchParams(window.location.search).get("open");
          if (openId) {
            const target = (d.notices as Item[]).find(n => n.id === openId);
            if (target) openItem(target);
          }
        } else if (d.message?.includes("인증")) router.replace("/worker/login");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function openItem(it: Item) {
    setSelected(it);
    if (!it.read) {
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, read: true } : x));
      fetch("/api/worker/notices/read", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id }),
      }).catch(() => {});
    }
  }

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
              <p className="text-sm font-semibold">공지·알림이 없습니다.</p>
            </div>
          ) : (
            items.map(it => {
              const kind = KIND[it.kind] ?? KIND.NOTICE_INDIVIDUAL;
              return (
                <button
                  key={it.id}
                  onClick={() => openItem(it)}
                  className="w-full rounded-2xl border border-slate-100 bg-white p-4 text-left transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${kind.cls}`}>{kind.label}</span>
                    {it.type !== "INFO" && (
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${TYPE_CLS[it.type] ?? TYPE_CLS.INFO}`}>
                        {TYPE_LABEL[it.type] ?? "안내"}
                      </span>
                    )}
                    {!it.read && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-label="안읽음" />}
                    <span className="ml-auto text-[10px] font-semibold text-slate-300">{it.createdAt.slice(0, 10)}</span>
                  </div>
                  <p className={`mt-1.5 text-sm font-black ${it.read ? "text-slate-500" : "text-slate-900"}`}>{it.title}</p>
                  <p className="mt-1 line-clamp-1 text-xs font-semibold leading-relaxed text-slate-400">{it.body}</p>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* 상세 팝업 */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${(KIND[selected.kind] ?? KIND.NOTICE_INDIVIDUAL).cls}`}>
                  {(KIND[selected.kind] ?? KIND.NOTICE_INDIVIDUAL).label}
                </span>
                {selected.type !== "INFO" && (
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${TYPE_CLS[selected.type] ?? TYPE_CLS.INFO}`}>
                    {TYPE_LABEL[selected.type] ?? "안내"}
                  </span>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-1 text-slate-400 active:scale-90"><X className="h-5 w-5" /></button>
            </div>
            <h2 className="text-lg font-black text-slate-900">{selected.title}</h2>
            <p className="mt-1 text-[11px] font-semibold text-slate-400">{new Date(selected.createdAt).toLocaleString("ko-KR")}</p>
            <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-700">{selected.body}</p>
            {selected.link && (
              <button
                onClick={() => router.push(selected.link!)}
                className="mt-5 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-black text-white active:scale-[0.98]"
              >
                바로가기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
