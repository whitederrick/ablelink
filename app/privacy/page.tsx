import type { Metadata } from "next";

export const metadata: Metadata = { title: "개인정보처리방침 — AbleLink" };

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-black text-slate-900">개인정보처리방침</h1>
        <p className="mb-8 text-sm font-semibold text-slate-400">시행일: 2026년 1월 1일</p>

        <div className="space-y-8 text-sm font-semibold leading-7 text-slate-700">

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제1조 (개인정보의 처리 목적)</h2>
            <p>플라포레스트(이하 "회사")는 AbleLink 서비스 제공을 위해 다음 목적으로 개인정보를 처리합니다.</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>회원 가입 및 본인 확인</li>
              <li>GPS 기반 출퇴근 기록 및 근태 관리</li>
              <li>업무일지, 보고서, 계약서 등 문서 생성 및 관리</li>
              <li>급여 계산 및 정산</li>
              <li>서비스 관련 공지사항 및 알림 발송</li>
              <li>민원 처리 및 고객 지원</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제2조 (처리하는 개인정보의 항목)</h2>
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 font-black text-slate-900">직무지도원 (필수)</p>
                <p>성명, 휴대전화번호, 이메일 주소, 비밀번호(암호화), GPS 위치정보(근무 중 출퇴근 시), 서비스 이용 기록</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 font-black text-slate-900">에이전시 관리자 (필수)</p>
                <p>성명, 이메일 주소, 비밀번호(암호화), 소속 기관명</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 font-black text-slate-900">훈련생 (직무지도원이 입력)</p>
                <p>성명, 성별, 생년월일, 휴대전화번호, 보호자 연락처, 장애 유형 및 정도</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제3조 (개인정보의 보유 및 이용 기간)</h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>회원 탈퇴 시 즉시 삭제 (단, 관련 법령에 따른 보존 의무가 있는 경우 해당 기간 동안 보존)</li>
              <li>전자상거래 관련 기록: 5년 (전자상거래 등에서의 소비자 보호에 관한 법률)</li>
              <li>통신비밀 관련 기록: 3개월 (통신비밀보호법)</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제4조 (개인정보의 제3자 제공)</h2>
            <p>회사는 이용자의 개인정보를 원칙적으로 제3자에게 제공하지 않습니다. 다만, 다음 경우에는 예외로 합니다.</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>이용자가 사전에 동의한 경우</li>
              <li>법령에 의해 요구되는 경우</li>
              <li>에이전시가 소속 직무지도원의 근태·문서 정보를 조회하는 경우 (서비스의 본질적 기능)</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제5조 (개인정보처리 위탁)</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-black text-slate-900">수탁업체</th>
                    <th className="px-4 py-3 text-left font-black text-slate-900">위탁 목적</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr><td className="px-4 py-3">Amazon Web Services</td><td className="px-4 py-3">이메일 발송 (AWS SES), 데이터 저장</td></tr>
                  <tr><td className="px-4 py-3">Supabase</td><td className="px-4 py-3">데이터베이스 운영</td></tr>
                  <tr><td className="px-4 py-3">Vercel</td><td className="px-4 py-3">서비스 호스팅</td></tr>
                  <tr><td className="px-4 py-3">알리고</td><td className="px-4 py-3">SMS 및 카카오 알림톡 발송</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제6조 (위치정보의 처리)</h2>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>회사는 출퇴근 기록을 위해 직무지도원의 GPS 위치정보를 수집합니다.</li>
              <li>위치정보는 출근 또는 퇴근 버튼을 누르는 시점에만 수집되며, 상시 추적하지 않습니다.</li>
              <li>수집된 위치정보는 근무지 반경 확인 목적에만 사용되며, 제3자에게 제공되지 않습니다.</li>
              <li>이용자는 기기 설정에서 위치 권한을 거부할 수 있으나, 이 경우 출퇴근 기록 기능이 제한될 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제7조 (이용자의 권리)</h2>
            <p>이용자는 언제든지 다음 권리를 행사할 수 있습니다.</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>개인정보 열람 요청</li>
              <li>오류 정정 요청</li>
              <li>삭제 요청 (회원 탈퇴)</li>
              <li>처리 정지 요청</li>
            </ul>
            <p className="mt-3">권리 행사는 서비스 내 프로필 페이지 또는 고객센터를 통해 할 수 있습니다.</p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제8조 (개인정보 보호책임자)</h2>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-black text-slate-900">개인정보 보호책임자</p>
              <p className="mt-1 text-slate-600">소속: 플라포레스트 | 이메일: able-link.co.kr</p>
              <p className="mt-1 text-xs text-slate-400">개인정보 관련 문의, 불만, 피해 구제 등의 사항은 위 연락처로 문의해 주세요.</p>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-base font-black text-slate-900">제9조 (개인정보처리방침의 변경)</h2>
            <p>이 방침은 법령 또는 서비스 변경에 따라 수정될 수 있으며, 변경 시 서비스 내 공지사항을 통해 사전 고지합니다.</p>
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
