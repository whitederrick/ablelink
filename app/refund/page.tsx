import type { Metadata } from "next";
import { RefundContent } from "@/components/RefundContent";
import LegalFooter from "@/components/LegalFooter";

export const metadata: Metadata = { title: "환불정책 — Able-Link" };

// ⚠️ 초안. 실제 운영 약관·전자상거래법 기준으로 사용자/법무 검토 후 확정 필요.
//    PG(토스페이먼츠·포트원) 심사를 위한 환불정책 표시용 기본안.

export default function RefundPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="mb-5 inline-block text-sm font-bold text-slate-400 hover:text-slate-700">← 홈으로</a>
        <h1 className="mb-2 text-2xl font-black text-slate-900">환불정책</h1>
        <p className="mb-8 text-sm font-semibold text-slate-400">시행일: 2026년 1월 1일</p>

        <RefundContent />

        <LegalFooter />

        <div className="mt-8 text-center">
          <a href="/" className="inline-block rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100">← 홈으로</a>
        </div>
      </div>
    </main>
  );
}
