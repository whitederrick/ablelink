import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { PLAN_PRICES } from "@/lib/billing";
import LegalFooter from "@/components/LegalFooter";

export const metadata: Metadata = { title: "요금안내 — Able-Link" };

// 가격은 lib/billing(PLAN_PRICES) 단일 출처. 기능 묶음은 lib/planGuard 등급 정의와 일치.
const won = (n: number) => n.toLocaleString("ko-KR");

const PLANS = [
  {
    key: "STARTER",
    name: "스타터",
    price: PLAN_PRICES.STARTER,
    summary: "기본 운영 — 규모 무제한 + 데이터 내보내기",
    features: [
      "직무지도원·현장 등록 무제한",
      "문서 인박스(제출 추적)",
      "출근부·일지 엑셀/CSV 내보내기",
    ],
  },
  {
    key: "STANDARD",
    name: "스탠다드",
    price: PLAN_PRICES.STANDARD,
    summary: "스타터 + 공식문서·AI 자동화",
    features: [
      "AI 음성 → 업무일지",
      "공식문서 PDF 자동 생성·전자서명",
      "사업체 담당자 모바일 서명",
      "훈련생 진척도 리포트",
      "감사 대응 서류 패키지",
    ],
    highlight: true,
  },
  {
    key: "PRO",
    name: "프로",
    price: PLAN_PRICES.PRO,
    summary: "스탠다드 + 운영 자동화·인재 매칭",
    features: [
      "급여 자동계산·명세서",
      "전자 근로계약서",
      "직무지도 공고·인재풀 매칭",
      "직무지도원 만족도 조사",
      "신분·계좌 확인(본인인증·예금주 조회)",
    ],
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-black text-slate-900">요금안내</h1>
        <p className="mb-8 text-sm font-semibold text-slate-500">
          위탁기관 단위 월 정액제입니다. 표시 금액은 <strong className="text-slate-700">월 기준·부가세 별도</strong>이며,
          규모(직무지도원·현장 수)에 따른 추가 비용은 없습니다.
        </p>

        <div className="space-y-4">
          {PLANS.map((p) => (
            <section
              key={p.key}
              className={`rounded-3xl border bg-white p-5 shadow-sm ${p.highlight ? "border-sky-300 ring-1 ring-sky-200" : "border-slate-200"}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-black text-slate-900">
                  {p.name}
                  {p.highlight && <span className="ml-2 rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-black text-sky-700">인기</span>}
                </h2>
                <p className="text-right">
                  <span className="text-2xl font-black text-slate-900">{won(p.price)}</span>
                  <span className="text-sm font-bold text-slate-400">원/월</span>
                </p>
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-500">{p.summary}</p>
              <ul className="mt-4 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm font-semibold text-slate-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-6 rounded-2xl bg-slate-100 p-4 text-xs font-semibold leading-6 text-slate-500">
          <p>· 상위 요금제는 하위 요금제의 모든 기능을 포함합니다.</p>
          <p>· 연 결제 및 기관 규모별 협의 단가는 고객센터로 문의해 주세요.</p>
          <p>· 도입 문의·체험은 <Link href="/" className="font-black text-sky-600">메인 화면</Link>의 고객센터 안내를 이용해 주세요.</p>
        </div>

        <LegalFooter />
      </div>
    </main>
  );
}
