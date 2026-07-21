// components/RefundContent.tsx
// 환불정책 본문 — 단일 출처. /refund 페이지와 앱 내 모달(LegalDocModal)이 공유.
// 2026-07-21 개정: 토스 입점 기준(구독 해지 시 잔여일 청약철회 보장)에 맞춰 잔여일 일할 부분환불(공제 없음)로 전환.
//  실제 환불은 payments/cancel이 토스 부분취소로 자동 처리(산식 = lib/payments/refund.ts와 동일해야 함).
import { BUSINESS_INFO } from "@/lib/businessInfo";

export function RefundContent() {
  const c = BUSINESS_INFO.companyName;
  return (
    <div className="space-y-8 text-sm font-semibold leading-7 text-slate-700">
      <section>
        <h2 className="mb-3 text-base font-black text-slate-900">제1조 (적용 범위)</h2>
        <p>본 정책은 {c}(이하 "회사")가 제공하는 Able-Link 유료 구독 서비스의 결제·청약철회·환불에 적용됩니다.</p>
      </section>

      <section>
        <h2 className="mb-3 text-base font-black text-slate-900">제2조 (구독 및 결제)</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>유료 서비스는 위탁기관(사업자) 단위 정액 구독이며(기본 월 단위, 협의 시 연 단위), 매 결제주기 시작 시 선결제됩니다.</li>
          <li>표시 금액은 부가가치세(VAT)가 포함된 금액입니다.</li>
          <li>요금제·금액은 <a href="/pricing" className="font-black text-sky-600">요금안내</a> 페이지에 따릅니다.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-base font-black text-slate-900">제3조 (청약철회)</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>결제일로부터 7일 이내이고, 유료 기능을 실질적으로 이용하지 않은 경우 청약철회 및 전액 환불이 가능합니다.</li>
          <li>유료 기능을 이용한 이후에도 제4조에 따라 언제든지 구독을 해지하고 잔여 이용기간에 대한 부분 환불(부분 청약철회)을 받을 수 있습니다.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-base font-black text-slate-900">제4조 (구독 해지 및 잔여 기간 부분 환불)</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>구독은 언제든지 해지할 수 있으며, 해지 즉시 유료 기능 이용이 종료됩니다.</li>
          <li>결제주기 중도 해지 시 잔여 이용일에 대해 일할 계산으로 부분 환불합니다. <strong className="text-slate-900">환불액 = 결제금액 × (잔여 이용일수 ÷ 결제주기 총 일수)</strong>이며, 해지 당일은 이용일로 계산합니다.</li>
          <li>일할 계산의 &ldquo;1일&rdquo;은 결제 시각 기준 24시간이며, 이용 중인 부분일은 이용일로 계산하고 환불액의 원 미만 단위는 버립니다.</li>
          <li>부분 환불 시 위약금이나 별도 수수료를 공제하지 않습니다.</li>
          <li>통상적인 이용 범위를 벗어나 환불 제도를 반복적으로 이용하는 경우(단기간 반복 구독·해지 등) 관계 법령이 허용하는 범위에서 이용이 제한될 수 있습니다.</li>
          <li>요금제 변경 시에도 기존 결제주기의 잔여 이용일을 동일한 산식으로 부분 환불한 뒤 새 요금제를 결제합니다(이중 과금 없음).</li>
          <li>회사의 귀책(중대한 서비스 장애 등)으로 서비스를 이용하지 못한 경우, 이용하지 못한 기간에 비례하여 환불합니다.</li>
          <li>기관별 협의 단가·연 결제의 경우에도 동일하게 잔여 이용기간에 대한 일할 환불 원칙이 적용됩니다.</li>
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
        <h2 className="mb-3 text-base font-black text-slate-900">제6조 (환불 비용)</h2>
        <p>잔여 기간 부분 환불을 포함한 모든 환불에서 위약금·결제 수수료 등 별도 비용을 공제하지 않습니다.</p>
      </section>

      <section>
        <h2 className="mb-3 text-base font-black text-slate-900">제7조 (문의)</h2>
        <p>환불 신청 및 문의는 고객센터를 통해 접수합니다. 연락처는 하단 사업자정보를 참고해 주세요.</p>
      </section>
    </div>
  );
}
