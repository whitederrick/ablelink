import type { Metadata } from "next";
import { PricingContent } from "@/components/PricingContent";
import LegalFooter from "@/components/LegalFooter";

export const metadata: Metadata = { title: "요금안내 — Able-Link" };

export default function PricingPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="mb-5 inline-block text-sm font-bold text-slate-400 hover:text-slate-700">← 홈으로</a>
        <h1 className="mb-2 text-2xl font-black text-slate-900">요금안내</h1>

        <PricingContent />

        <LegalFooter />

        <div className="mt-8 text-center">
          <a href="/" className="inline-block rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100">← 홈으로</a>
        </div>
      </div>
    </main>
  );
}
