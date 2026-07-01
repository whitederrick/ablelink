"use client";

// components/AdSlot.tsx
// 재사용 광고/프로모션 슬롯 — 매니저·직무지도원 등 어디서든 꽂아 쓴다.
// 여러 광고를 넘겨주면 일정 간격으로 자동 로테이션(캐러셀)한다.
// 콘텐츠 방식(내부 정적 이미지+링크 / 내부 프로모션 / 향후 외부 광고망)을 이 슬롯에 바꿔 끼우는 구조.
// contents 비었으면 플레이스홀더(빈 광고 자리)를 렌더한다.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

export type AdLayout = "TEXT" | "IMAGE" | "OVERLAY" | "TITLE";
export type AdContent = {
  title: string;
  description?: string;
  imageUrl?: string;
  href?: string;
  /** 배지 문구(예: "광고", "소식", "PRO") */
  badge?: string;
  /** 카드 레이아웃 */
  layout?: AdLayout;
  /** 오버레이 글자색: LIGHT(흰) | DARK(어두움) */
  textColor?: "LIGHT" | "DARK";
  /** href가 외부 링크면 새 탭으로 */
  external?: boolean;
};

export default function AdSlot({
  contents = [],
  className = "",
  label = "광고",
  /** 자동 전환 간격(ms). 광고가 2개 이상일 때만 동작 */
  intervalMs = 5000,
}: {
  contents?: AdContent[];
  className?: string;
  label?: string;
  intervalMs?: number;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (contents.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % contents.length), intervalMs);
    return () => clearInterval(t);
  }, [contents.length, intervalMs]);

  // 콘텐츠 미설정 → 플레이스홀더(향후 정적/프로모션/외부 광고를 이 슬롯에 연결)
  if (contents.length === 0) {
    return (
      <div
        className={`flex h-full min-h-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 p-3 text-center ${className}`}
        aria-label="광고 영역"
      >
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{label}</span>
        <p className="text-xs font-semibold text-emerald-700/70">이 공간에 소식·프로모션이 표시됩니다</p>
      </div>
    );
  }

  const c = contents[idx % contents.length];
  const hasImage = !!c.imageUrl;
  // 이미지 없으면 무조건 텍스트형. 이미지 있고 layout 미지정이면 오버레이 기본.
  const layout: AdLayout = !hasImage ? "TEXT" : (c.layout ?? "OVERLAY");

  // 로테이션 인디케이터(광고 2개 이상)
  const dots = contents.length > 1 && (
    <div className="flex items-center gap-1">
      {contents.map((_, i) => (
        <button key={i} type="button" onClick={(e) => { e.preventDefault(); setIdx(i); }} aria-label={`광고 ${i + 1}`}
          className={`h-1.5 rounded-full transition-all ${i === idx % contents.length ? "w-4 " + (layout === "TEXT" ? "bg-slate-700" : "bg-white") : "w-1.5 " + (layout === "TEXT" ? "bg-slate-300" : "bg-white/50")}`} />
      ))}
    </div>
  );

  let card: ReactNode;
  if (layout === "TEXT") {
    // 텍스트형: 이미지 없이 배지·제목·설명
    card = (
      <div className="flex h-full min-h-0 flex-col justify-center overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
        <span className="mb-1.5 w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{c.badge ?? label}</span>
        <h3 className="text-sm font-black leading-tight text-slate-900">{c.title}</h3>
        {c.description && <p className="mt-1 line-clamp-3 text-xs font-semibold leading-relaxed text-slate-500">{c.description}</p>}
        {dots && <div className="mt-auto pt-3">{dots}</div>}
      </div>
    );
  } else {
    // 이미지 배경형(IMAGE / OVERLAY / TITLE). 오버레이 글자색은 textColor로.
    const dark = c.textColor === "DARK";
    card = (
      <div className="relative h-full min-h-0 overflow-hidden rounded-2xl bg-slate-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        {layout !== "IMAGE" && (
          <>
            <div className={`absolute inset-0 bg-gradient-to-t ${dark ? "from-white/85 via-white/35 to-transparent" : "from-black/75 via-black/25 to-transparent"}`} />
            <div className="absolute inset-x-0 bottom-0 p-3.5">
              {c.badge && <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm ${dark ? "bg-black/10 text-slate-900" : "bg-white/25 text-white"}`}>{c.badge}</span>}
              <h3 className={`text-sm font-black leading-tight drop-shadow ${dark ? "text-slate-900 [text-shadow:none]" : "text-white"}`}>{c.title}</h3>
              {layout === "OVERLAY" && c.description && <p className={`mt-0.5 line-clamp-2 text-xs font-semibold leading-relaxed ${dark ? "text-slate-700" : "text-white/85"}`}>{c.description}</p>}
            </div>
          </>
        )}
        {dots && <div className="absolute right-3 top-3">{dots}</div>}
      </div>
    );
  }

  const wrap = `block h-full transition hover:opacity-90 ${className}`;
  if (!c.href) return <div className={`h-full ${className}`}>{card}</div>;
  return c.external ? (
    <a href={c.href} target="_blank" rel="noopener noreferrer" className={wrap}>{card}</a>
  ) : (
    <Link href={c.href} className={wrap}>{card}</Link>
  );
}
