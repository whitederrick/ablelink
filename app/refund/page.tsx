import type { Metadata } from "next";
import { BUSINESS_INFO } from "@/lib/businessInfo";
import LegalFooter from "@/components/LegalFooter";

export const metadata: Metadata = { title: "환불정책 — Able-Link" };

// ⚠️ 초안. 실제 운영 약관·전자상거래법 기준으로 사용자/법무 검토 후 확정 필요.
//    PG(토스페이먼츠·포트원) 심사를 위한 환불정책 표시용 기본안.

export default function RefundPage() {
  const c = BUSINESS_INFO.companyName;
  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="mb-5 inline-block text-sm font-bold text-slate-400 hover:text-slate-700">← 홈으로</a>
        <h1 className="mb-2 text-2xl font-black text-slate-900">환불정책</h1>
        <p className="mb-8 text-sm font-semibold text-slate-400">시행일: 2026년 1월 1일</p>

        <div className="space-y-8 text-sm font-semibold leading-7 text-slate-700">
          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제1조 (적용 범위)</h2>
            <p>본 정책은 {c}(이하 "회사")가 제공하는 Able-Link 유료 구독 서비스의 결제·청약철회·환불에 적용됩니다.</p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제2조 (구독 및 결제)</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>유료 서비스는 위탁기관(사업자) 단위 월 정액 구독이며, 매 결제주기 시작 시 선결제됩니다.</li>
              <li>표시 금액은 부가가치세(VAT)가 포함된 금액입니다.</li>
              <li>요금제·금액은 <a href="/pricing" className="font-black text-sky-600">요금안내</a> 페이지에 따릅니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제3조 (청약철회)</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>결제일로부터 7일 이내이고, 유료 기능을 실질적으로 이용하지 않은 경우 청약철회 및 전액 환불이 가능합니다.</li>
              <li>다만 결제 후 PDF 생성·전자서명·급여계산 등 유료 기능을 사용하기 시작한 경우, 콘텐츠 제공이 개시된 것으로 보아 청약철회가 제한될 수 있습니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제4조 (구독 해지 및 환불)</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>구독은 다음 결제일 이전에 언제든지 해지할 수 있으며, 해지 시 해당 주기 종료일까지 서비스가 유지됩니다.</li>
              <li>월 정액 구독의 결제주기 중도 해지 시, 이미 이용을 개시한 주기의 요금은 원칙적으로 환불되지 않습니다.</li>
              <li>회사의 귀책(중대한 서비스 장애 등)으로 서비스를 이용하지 못한 경우, 이용하지 못한 기간에 비례하여 환불합니다.</li>
              <li>기관별 협의 단가·연 결제 환불은 개별 계약 조건에 따릅니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제5조 (환불 방법 및 처리기간)</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>환불은 원결제수단으로 처리함을 원칙으로 하며, 신청 접수 후 영업일 기준 3~7일 이내 처리됩니다.</li>
              <li>결제대행사·카드사 사정에 따라 실제 환급 시점은 달라질 수 있습니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제6조 (문의)</h2>
            <p>환불 신청 및 문의는 고객센터를 통해 접수합니다. 연락처는 하단 사업자정보를 참고해 주세요.</p>
          </section>
        </div>

        <LegalFooter />
      </div>
    </main>
  );
}
