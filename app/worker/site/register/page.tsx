"use client";

// 직무지도원 셀프 현장등록 종료(2026-06-06). 현장 배정은 위탁기관/운영자가 입력.

import Link from "next/link";

export default function WorkerSiteRegisterClosedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 px-6 text-center">
      <img src="/icons/icon-512.png" alt="Able-Link" className="h-12 w-12 rounded-2xl" />
      <div className="space-y-2">
        <h1 className="text-lg font-black text-slate-900">현장 직접 등록은 운영되지 않습니다</h1>
        <p className="text-sm font-semibold leading-relaxed text-slate-500">
          현장 배정은 <span className="font-black text-slate-700">소속 위탁기관</span> 또는
          <span className="font-black text-slate-700"> 시스템 운영자</span>가 처리합니다.
          <br />직무지도 일자리를 찾으시면 매칭을 이용해보세요.
        </p>
      </div>
      <div className="flex gap-2">
        <Link href="/worker/home" className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-black text-slate-600">홈으로</Link>
        <Link href="/recruit" className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white">매칭 찾기</Link>
      </div>
    </div>
  );
}
