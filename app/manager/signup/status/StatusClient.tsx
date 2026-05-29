"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, CheckCircle, Clock, XCircle } from "lucide-react";

type Status = "PENDING" | "APPROVED" | "REJECTED";
type SignupStatus = {
  requestId: string;
  agencyName: string;
  status: Status;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

const STATUS_CONFIG = {
  PENDING:  { Icon: Clock,         color: "text-amber-600",   bg: "bg-amber-50 border-amber-200",   label: "검토 중" },
  APPROVED: { Icon: CheckCircle,   color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", label: "승인됨" },
  REJECTED: { Icon: XCircle,       color: "text-rose-600",    bg: "bg-rose-50 border-rose-200",      label: "반려됨" },
};

export default function StatusClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("loginId") || "";

  const [loginId, setLoginId] = useState(initial);
  const [loading, setLoading] = useState(!!initial);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SignupStatus | null>(null);

  async function fetchStatus(id: string) {
    if (!id.trim()) { setError("아이디를 입력해주세요."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/auth/signup?loginId=${encodeURIComponent(id.trim())}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || "신청 내역을 찾을 수 없습니다.");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initial) fetchStatus(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inp = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-950 shadow-lg shadow-slate-950/20">
            <Building2 className="h-8 w-8 text-sky-400" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">AbleLink</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">가입 신청 상태 확인</p>
        </div>

        <div className="space-y-3">
          <input value={loginId} onChange={e => setLoginId(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetchStatus(loginId)}
            placeholder="신청 시 입력한 아이디" className={inp} />
          <button onClick={() => fetchStatus(loginId)} disabled={loading}
            className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-slate-950 px-5 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-70">
            {loading ? "조회 중..." : "상태 조회"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            {error}
          </div>
        )}

        {data && (() => {
          const cfg = STATUS_CONFIG[data.status];
          const { Icon } = cfg;
          return (
            <div className={`mt-5 rounded-2xl border px-5 py-4 ${cfg.bg}`}>
              <div className="mb-3 flex items-center gap-2">
                <Icon className={`h-5 w-5 ${cfg.color}`} />
                <span className={`text-base font-black ${cfg.color}`}>{cfg.label}</span>
              </div>
              <p className="text-sm font-bold text-slate-700">{data.agencyName}</p>
              <p className="mt-1 text-xs text-slate-500">
                신청일: {new Date(data.createdAt).toLocaleDateString("ko-KR")}
              </p>
              {data.reviewNote && (
                <p className="mt-2 text-sm font-semibold text-slate-600">
                  검토 메모: {data.reviewNote}
                </p>
              )}
              {data.status === "APPROVED" && (
                <button onClick={() => router.push("/manager/login")}
                  className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-600 px-5 text-sm font-black text-white transition active:scale-[0.97]">
                  로그인하기
                </button>
              )}
            </div>
          );
        })()}

        <div className="mt-5 flex flex-col gap-1">
          <button onClick={() => router.push("/manager/login")}
            className="w-full rounded-2xl px-5 py-3 text-sm font-bold text-slate-500 transition hover:text-slate-700">
            로그인 페이지로
          </button>
          <button onClick={() => router.push("/manager/signup")}
            className="w-full rounded-2xl px-5 py-3 text-sm font-bold text-slate-400 transition hover:text-slate-600">
            새로 가입 신청하기
          </button>
        </div>
      </div>
    </main>
  );
}
