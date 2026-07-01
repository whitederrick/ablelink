"use client";

// components/Ticker.tsx
// 증권 시세판처럼 소식·안내가 좌로 계속 흘러가는 티커(marquee). 마우스 올리면 일시정지.
// 대시보드 헤더 등 가로 여백에 꽂아 쓴다. 내용은 콘텐츠 배열로 주입.

import Link from "next/link";

export type TickerItem = { badge?: string; text: string; href?: string };

export default function Ticker({
  items,
  className = "",
  /** 한 바퀴 도는 시간(초). 항목 많으면 늘려 자연스럽게 */
  durationSec = 32,
}: {
  items: TickerItem[];
  className?: string;
  durationSec?: number;
}) {
  if (!items.length) return null;
  // 끊김 없는 무한 루프를 위해 동일 세트를 2번 이어붙이고 -50% 이동
  const loop = [...items, ...items];

  return (
    <div
      className={`ticker group relative overflow-hidden rounded-xl border border-slate-100 bg-slate-50/70 ${className}`}
      style={{ maskImage: "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent)", WebkitMaskImage: "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent)" }}
    >
      <div className="ticker-track flex w-max items-center whitespace-nowrap py-2.5" style={{ animationDuration: `${durationSec}s` }}>
        {loop.map((it, i) => (
          <span key={i} className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            {it.badge && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{it.badge}</span>
            )}
            {it.href ? (
              <Link href={it.href} className="transition hover:text-slate-900">{it.text}</Link>
            ) : (
              <span>{it.text}</span>
            )}
            {/* 항목 구분선 */}
            <span className="mx-4 inline-block h-4 w-px bg-slate-300" aria-hidden="true" />
          </span>
        ))}
      </div>
      <style>{`
        .ticker-track { animation-name: ticker-scroll; animation-timing-function: linear; animation-iteration-count: infinite; }
        .ticker:hover .ticker-track { animation-play-state: paused; }
        @keyframes ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .ticker-track { animation: none; } }
      `}</style>
    </div>
  );
}
