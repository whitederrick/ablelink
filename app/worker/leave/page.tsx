"use client";
// app/worker/leave/page.tsx
// 직무지도원 본인 연차 조회(읽기 전용) — 기관별 잔여 + 발생/사용 이력.
// 발생(1년 미만 월 개근 1일 등)은 자동 기록되며, 사용 등록·정정은 위탁기관 담당자가 처리.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CalendarCheck } from "lucide-react";

type Entry = {
  kind: string; kindLabel: string; days: number;
  effectiveDate: string; expiresAt: string | null; label: string | null;
};
type Group = { agencyId: string; agencyName: string; balance: number; entries: Entry[] };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const KIND_CLS: Record<string, string> = {
  ACCRUAL_MONTHLY: "text-emerald-600", ACCRUAL_ANNUAL: "text-emerald-600",
  USE: "text-sky-600", EXPIRE: "text-slate-400", PAYOUT: "text-amber-600", ADJUST: "text-rose-500",
};

export default function WorkerLeavePage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // 로드 실패를 '빈 상태'로 위장하지 않음(급여명세서와 동일)

  const runFetch = () => {
    fetch("/api/worker/leave")
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (d.success) setGroups(d.groups); else throw new Error(); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  const load = () => { setLoading(true); setError(false); runFetch(); };
  useEffect(() => { runFetch(); }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-3">
        <button onClick={() => router.push("/worker/home")} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-black text-slate-900">내 연차</h1>
      </header>

      <div className="mx-auto max-w-lg space-y-3 px-4 py-5">
        {loading ? (
          <p className="py-10 text-center text-sm font-semibold text-slate-400">불러오는 중...</p>
        ) : error ? (
          <div className="rounded-2xl border border-rose-100 bg-white py-12 text-center">
            <p className="text-sm font-semibold text-rose-500">연차 정보를 불러오지 못했습니다.</p>
            <button onClick={load} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white active:scale-95">다시 시도</button>
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white py-12 text-center">
            <CalendarCheck className="mx-auto h-10 w-10 text-slate-200" />
            <p className="mt-3 text-sm font-semibold text-slate-400">아직 연차 이력이 없습니다.</p>
            <p className="mt-1 px-6 text-xs font-medium text-slate-300">연차는 근로계약 후 1개월 개근 시마다 자동으로 쌓이며, 사용 등록은 위탁기관 담당자가 처리합니다.</p>
          </div>
        ) : groups.map(g => (
          <div key={g.agencyId} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            <div className="flex items-center justify-between border-b border-slate-50 px-4 py-3">
              <div>
                <p className="text-[13px] font-bold text-slate-400">{g.agencyName}</p>
                <p className="mt-0.5 text-lg font-black text-slate-900">잔여 {fmt(g.balance)}일</p>
              </div>
              <CalendarCheck className="h-7 w-7 text-emerald-500" />
            </div>
            <ul>
              {g.entries.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-2 border-b border-slate-50 px-4 py-2.5 last:border-0">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-slate-700">
                      {e.kindLabel}
                      <span className={`ml-1.5 font-black ${KIND_CLS[e.kind] ?? "text-slate-500"}`}>{e.days > 0 ? "+" : ""}{fmt(e.days)}일</span>
                    </p>
                    {e.label && <p className="truncate text-[11px] font-medium text-slate-400">{e.label}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-slate-400">{e.effectiveDate}</p>
                    {e.expiresAt && <p className="text-[10px] font-medium text-slate-300">{e.expiresAt} 소멸</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
