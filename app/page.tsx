import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Building2, CreditCard, FileText, MapPin, Sparkles, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "AbleLink — 장애인 직무지도원 관리 서비스",
  description: "직무지도원과 에이전시를 위한 스마트 업무 관리 플랫폼",
};

const FEATURES = [
  { icon: MapPin,        label: "GPS 출퇴근" },
  { icon: Sparkles,      label: "AI 업무일지" },
  { icon: FileText,      label: "보고서 자동화" },
  { icon: CreditCard,    label: "급여 정산" },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <section className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-sm flex-col justify-between">
        {/* 브랜드 */}
        <div className="pt-8">
          <div className="mb-6 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-512.png"
              alt="AbleLink"
              className="h-12 w-12 rounded-2xl shadow-lg shadow-slate-950/10"
            />
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950">AbleLink</h1>
              <p className="text-xs font-semibold text-slate-400">장애인 직무지도원 관리 서비스</p>
            </div>
          </div>
          <p className="text-base font-semibold leading-7 text-slate-500">
            직무지도원과 에이전시를 위한<br />스마트 업무 관리 플랫폼입니다.
          </p>
        </div>

        {/* 메인 액션 */}
        <div className="space-y-3">
          <Link
            href="/worker/login"
            className="flex min-h-[4.5rem] items-center justify-between rounded-3xl bg-slate-950 px-5 text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-3">
              <Users className="h-5 w-5 text-sky-400" aria-hidden="true" />
              <span>
                <span className="block text-sm font-black">직무지도원</span>
                <span className="block text-xs font-semibold text-slate-400">근태·일지·계약서 관리</span>
              </span>
            </span>
            <ArrowRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </Link>

          <Link
            href="/manager/login"
            className="flex min-h-[4.5rem] items-center justify-between rounded-3xl border border-slate-200 bg-white px-5 text-slate-900 shadow-sm transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-sky-500" aria-hidden="true" />
              <span>
                <span className="block text-sm font-black">에이전시 관리자</span>
                <span className="block text-xs font-semibold text-slate-400">운영·통계·문서 관리</span>
              </span>
            </span>
            <ArrowRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </Link>

          {/* 기능 요약 */}
          <div className="grid grid-cols-4 gap-2 rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50">
                  <Icon className="h-4 w-4 text-sky-500" aria-hidden="true" />
                </div>
                <span className="text-center text-[10px] font-bold leading-tight text-slate-600">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="pb-2 text-center text-xs font-semibold text-slate-400">
          © 2026 AbleLink · Provided by Platforest
        </p>
      </section>
    </main>
  );
}
