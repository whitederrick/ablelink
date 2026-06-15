// 위탁기관 자가가입 종료(2026-06-07). 위탁기관·관리자 계정은 시스템 운영자가 개설(생성+초대).
import Link from "next/link";

export default function SignupClosedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 px-6 text-center">
      <span className="text-[22px] font-black tracking-tight text-slate-900">Able-Link</span>
      <div className="space-y-2">
        <h1 className="text-lg font-black text-slate-900">위탁기관 가입은 운영팀을 통해 진행됩니다</h1>
        <p className="text-sm font-semibold leading-relaxed text-slate-500">
          위탁기관·관리자 계정은 <span className="font-black text-slate-700">시스템 운영자</span>가 개설하고 초대합니다.
          <br />도입을 원하시면 운영팀에 문의해주세요.
        </p>
      </div>
      <Link href="/manager/login" className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white">
        로그인으로 이동
      </Link>
    </div>
  );
}
