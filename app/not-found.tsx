import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-5 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-950 shadow-lg shadow-slate-950/20">
        <img src="/icons/icon-512.png" alt="AbleLink" className="h-12 w-12 rounded-2xl" />
      </div>
      <p className="text-6xl font-black text-slate-200">404</p>
      <p className="mt-3 text-xl font-black text-slate-900">페이지를 찾을 수 없습니다</p>
      <p className="mt-2 text-sm font-semibold text-slate-500">
        요청하신 페이지가 존재하지 않거나 이동되었습니다.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/worker/home"
          className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-95"
        >
          홈으로 이동
        </Link>
        <Link
          href="/worker/login"
          className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-95"
        >
          로그인
        </Link>
      </div>
    </main>
  );
}
