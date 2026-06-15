"use client";

// 개인 자가가입 종료(2026-06-06). 계정은 위탁기관 초대/운영자 발급으로만 생성.
// 직접 접근 시 안내 후 로그인으로 유도.

import Link from "next/link";

export default function WorkerSignupClosedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 px-6 text-center">
      <img src="/icons/icon-512.png" alt="Able-Link" className="h-12 w-12 rounded-2xl" />
      <div className="space-y-2">
        <h1 className="text-lg font-black text-slate-900">개인 회원가입은 운영되지 않습니다</h1>
        <p className="text-sm font-semibold leading-relaxed text-slate-500">
          직무지도원 계정은 <span className="font-black text-slate-700">소속 위탁기관의 초대</span> 또는
          <span className="font-black text-slate-700"> 시스템 운영자</span>를 통해 발급됩니다.
          <br />초대 링크를 받으셨다면 해당 링크로 가입을 진행해주세요.
        </p>
      </div>
      <Link href="/worker/login" className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white">
        로그인으로 이동
      </Link>
    </div>
  );
}
