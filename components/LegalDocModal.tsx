"use client";

// components/LegalDocModal.tsx
// 법적 고지(약관·개인정보처리방침·환불정책·요금안내) 링크 — 실제 페이지(href)는 유지하되,
// 탭하면 화면 전환 없이 모달로 본문을 띄운다. 직무지도원은 전부 스마트폰이라 새 탭/페이지 전환이 어색.
//  · href 유지 → PG(포트원) 심사·검색엔진에는 실제 링크로 노출.
//  · 좌클릭 → 모달, ⌘/Ctrl·중클릭 → 브라우저 기본 동작(새 탭)으로 폴백.
//  · 문장 안에 그대로 삽입 가능: <LegalDocLink doc="privacy" />
// 다른 모달(예: 국외이전 동의) 위에 겹칠 수 있어 포털+z-[60]로 body에 렌더.

import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, X } from "lucide-react";
import { PrivacyPolicyContent } from "./PrivacyPolicyContent";
import { TermsContent } from "./TermsContent";
import { RefundContent } from "./RefundContent";
import { PricingContent } from "./PricingContent";

export type LegalDoc = "terms" | "privacy" | "refund" | "pricing";

const REGISTRY: Record<LegalDoc, { title: string; href: string; effectiveDate?: string; Content: ComponentType }> = {
  terms:   { title: "서비스 이용약관",   href: "/terms",   effectiveDate: "2026년 1월 1일", Content: TermsContent },
  privacy: { title: "개인정보처리방침",   href: "/privacy", effectiveDate: "2026년 1월 1일", Content: PrivacyPolicyContent },
  refund:  { title: "환불정책",         href: "/refund",  effectiveDate: "2026년 7월 21일", Content: RefundContent },
  pricing: { title: "요금안내",         href: "/pricing", Content: PricingContent },
};

export function LegalDocLink({
  doc,
  label,
  className = "underline underline-offset-2",
}: { doc: LegalDoc; label?: string; className?: string }) {
  const { title, href, effectiveDate, Content } = REGISTRY[doc];
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <>
      <a
        href={href}
        className={className}
        onClick={(e) => {
          // 새 탭 의도(모디파이어·중클릭)면 기본 동작 유지, 일반 클릭만 모달로.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {label ?? title}
      </a>
      {/* 인라인(<p>/<span>) 삽입 대비 포털로 body에 렌더 — HTML 중첩 위반·하이드레이션 경고 방지 */}
      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-3xl bg-slate-50 text-left sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 shrink-0 text-slate-900" />
                <h2 className="text-lg font-black text-slate-900">{title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="rounded-full p-1.5 text-slate-400 active:scale-95 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-5">
              {effectiveDate && <p className="mb-6 text-sm font-semibold text-slate-400">시행일: {effectiveDate}</p>}
              <Content />
            </div>
            <div className="border-t border-slate-200 p-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-black text-white active:scale-95"
              >
                확인
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
