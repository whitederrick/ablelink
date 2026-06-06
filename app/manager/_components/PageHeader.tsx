// app/manager/_components/PageHeader.tsx
// 매니저 콘솔 전 화면 공통 페이지 헤더 — 타이틀·부제·액션 버튼 위치/크기/폰트를 단일 기준으로 통일.
// 모든 페이지가 이 컴포넌트를 사용 → 버튼 위치(우상단)·타이틀(text-lg) 항상 동일.

import type { ReactNode } from "react";

export default function PageHeader({
  title,
  sub,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-black text-slate-900">{title}</h1>
        {sub != null && sub !== "" && (
          <p className="mt-0.5 text-sm font-semibold text-slate-400">{sub}</p>
        )}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
