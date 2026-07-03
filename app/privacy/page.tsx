import type { Metadata } from "next";
import { PrivacyPolicyContent } from "@/components/PrivacyPolicyContent";

export const metadata: Metadata = { title: "개인정보처리방침 — Able-Link" };

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="mb-5 inline-block text-sm font-bold text-slate-400 hover:text-slate-700">← 홈으로</a>
        <h1 className="mb-2 text-2xl font-black text-slate-900">개인정보처리방침</h1>
        <p className="mb-8 text-sm font-semibold text-slate-400">시행일: 2026년 1월 1일</p>

        <PrivacyPolicyContent />

        <div className="mt-8 text-center">
          <a href="/" className="inline-block rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100">← 홈으로</a>
        </div>
      </div>
    </main>
  );
}
