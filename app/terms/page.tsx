import type { Metadata } from "next";

export const metadata: Metadata = { title: "서비스 이용약관 — AbleLink" };

export default function TermsPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-black text-slate-900">서비스 이용약관</h1>
        <p className="mb-8 text-sm font-semibold text-slate-400">시행일: 2026년 1월 1일</p>

        <div className="space-y-8 text-sm font-semibold leading-7 text-slate-700">

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제1조 (목적)</h2>
            <p>이 약관은 플라포레스트(이하 "회사")가 운영하는 AbleLink 서비스(이하 "서비스")의 이용 조건 및 절차, 회사와 이용자 간의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.</p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제2조 (용어의 정의)</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>"서비스"란 회사가 제공하는 장애인 직무지도원 업무관리 플랫폼 AbleLink를 의미합니다.</li>
              <li>"직무지도원"이란 장애인 직무지도 서비스를 제공하는 자로 서비스에 가입한 개인 이용자를 말합니다.</li>
              <li>"에이전시"란 직무지도원을 고용·위탁하여 장애인 고용 지원 서비스를 운영하는 기관을 말합니다.</li>
              <li>"계정"이란 이용자가 서비스에 접근하기 위해 설정한 아이디(전화번호 또는 이메일)와 비밀번호의 조합을 말합니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제3조 (약관의 효력 및 변경)</h2>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>이 약관은 서비스 화면에 게시하거나 이메일 등으로 이용자에게 공지함으로써 효력을 발생합니다.</li>
              <li>회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 적용일 7일 전에 공지합니다.</li>
              <li>이용자가 변경된 약관에 동의하지 않을 경우 서비스 이용을 중단하고 탈퇴할 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제4조 (서비스 이용 계약의 성립)</h2>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>이용 계약은 이용자가 이 약관에 동의하고 가입 신청을 완료한 때 성립됩니다.</li>
              <li>회사는 다음 각 호에 해당하는 경우 가입 승인을 거부할 수 있습니다.
                <ul className="mt-1.5 list-disc space-y-1 pl-5">
                  <li>타인의 명의로 신청한 경우</li>
                  <li>허위 정보를 기재한 경우</li>
                  <li>이전에 서비스 이용 자격을 박탈당한 경우</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제5조 (서비스의 제공 및 변경)</h2>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>회사는 다음과 같은 서비스를 제공합니다.
                <ul className="mt-1.5 list-disc space-y-1 pl-5">
                  <li>GPS 기반 출퇴근 기록 및 근태 관리</li>
                  <li>AI 기반 업무일지 작성 지원</li>
                  <li>정부 양식 PDF 문서 자동 생성</li>
                  <li>온라인 계약서 및 전자서명</li>
                  <li>급여 자동 계산 및 정산</li>
                  <li>기타 회사가 추가 개발하거나 제3자와 협력하여 제공하는 서비스</li>
                </ul>
              </li>
              <li>회사는 서비스 내용을 변경할 수 있으며, 중요한 변경 사항은 사전에 공지합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제6조 (서비스 이용 제한)</h2>
            <p>이용자는 다음 행위를 하여서는 안 됩니다.</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>타인의 정보를 도용하거나 허위 정보를 입력하는 행위</li>
              <li>서비스의 운영을 방해하거나 시스템에 과부하를 주는 행위</li>
              <li>다른 이용자의 개인정보를 수집, 저장, 공개하는 행위</li>
              <li>서비스를 통해 얻은 정보를 회사의 사전 동의 없이 상업적 목적으로 이용하는 행위</li>
              <li>관련 법령에 위반되는 행위</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제7조 (이용자의 의무)</h2>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>이용자는 계정 정보를 안전하게 관리하여야 합니다.</li>
              <li>이용자는 자신의 계정으로 발생한 모든 활동에 대해 책임을 집니다.</li>
              <li>이용자는 개인정보 변경 시 서비스 내에서 즉시 수정하여야 합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제8조 (회사의 면책)</h2>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>회사는 천재지변, 전쟁, 기간통신사업자의 서비스 중지 등 불가항력적인 사유로 인한 서비스 중단에 대해 책임을 지지 않습니다.</li>
              <li>회사는 이용자의 귀책 사유로 인한 서비스 이용 장애에 대해 책임을 지지 않습니다.</li>
              <li>회사는 이용자가 서비스를 통해 제공한 정보의 정확성에 대해 보증하지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제9조 (분쟁 해결)</h2>
            <p>서비스 이용과 관련한 분쟁은 대한민국 법률을 준거법으로 하며, 분쟁 발생 시 회사 소재지를 관할하는 법원을 전속 관할 법원으로 합니다.</p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제10조 (기타)</h2>
            <p>이 약관에 명시되지 않은 사항은 관련 법령 및 회사의 정책에 따릅니다.</p>
          </section>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold text-slate-500">
              사업자명: 플라포레스트 | 서비스명: AbleLink<br />
              문의: able-link.co.kr | 시행일: 2026년 1월 1일
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
