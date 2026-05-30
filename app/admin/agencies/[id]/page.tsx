"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Building2, Users, MapPin, Activity, Cpu } from "lucide-react";
import { T } from "../../_styles";

const PLAN_COLORS: Record<string, string> = {
  FREE:     "bg-slate-100 text-slate-600",
  TRIAL:    "bg-amber-100 text-amber-700",
  STARTER:  "bg-sky-100 text-sky-700",
  STANDARD: "bg-violet-100 text-violet-700",
  PRO:      "bg-emerald-100 text-emerald-700",
};

type AgencyDetail = {
  id: string; name: string; planType: string; isActive: boolean;
  trialEndsAt: string | null; subscribedAt: string | null; nextBillingAt: string | null;
  maxWorkers: number; maxSites: number; createdAt: string;
};
type Manager = { id: string; loginId: string; displayName: string | null; isActive: boolean; lastLoginAt: string | null };
type Site    = { id: string; companyName: string; traineeCount: number };
type Worker   = { id: string; workerName: string; status: string };
type Stats   = { logCount: number; attCount: number; apiUsage: { service: string; count: number }[] };

function fmt(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}
function fmtDt(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("ko-KR");
}

export default function AgencyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();

  const [agency,   setAgency]   = useState<AgencyDetail | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [sites,    setSites]    = useState<Site[]>([]);
  const [workers, setWorkers]  = useState<Worker[]>([]);
  const [stats,    setStats]    = useState<Stats | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/system/agencies/${id}/detail`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setAgency(d.agency);
          setManagers(d.managers);
          setSites(d.sites);
          setWorkers(d.workers);
          setStats(d.stats);
        } else {
          setError(d.message ?? "로드 실패");
        }
      })
      .catch(() => setError("서버 오류"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex h-60 items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
    </div>
  );

  if (error || !agency) return (
    <div className="flex h-60 flex-col items-center justify-center gap-3">
      <p className="text-sm text-slate-500">{error || "에이전시를 찾을 수 없습니다."}</p>
      <button onClick={() => router.back()} className={T.btnSecondary}>← 뒤로</button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <button onClick={() => router.back()} className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" />에이전시 목록
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <Building2 className="h-6 w-6 text-slate-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900">{agency.name}</h1>
              <span className={`${T.badge} ${PLAN_COLORS[agency.planType] ?? "bg-slate-100 text-slate-600"}`}>
                {agency.planType}
              </span>
              {!agency.isActive && (
                <span className={`${T.badge} bg-rose-100 text-rose-600`}>비활성</span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-slate-400">가입일: {fmt(agency.createdAt)}</p>
          </div>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-3.5">
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{managers.length}</p>
          <p className={T.summaryLabel}>관리자</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{sites.length}</p>
          <p className={T.summaryLabel}>현장</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{workers.length}</p>
          <p className={T.summaryLabel}>직무지도원</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{stats?.attCount ?? 0}</p>
          <p className={T.summaryLabel}>출근 기록</p>
        </div>
      </div>

      {/* 구독 정보 */}
      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-700">구독 정보</p>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-slate-400">구독 시작</p>
            <p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.subscribedAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">다음 결제</p>
            <p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.nextBillingAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">체험 종료</p>
            <p className="mt-0.5 font-semibold text-slate-800">{fmt(agency.trialEndsAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">최대 직무지도원</p>
            <p className="mt-0.5 font-semibold text-slate-800">{agency.maxWorkers || "무제한"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">최대 현장</p>
            <p className="mt-0.5 font-semibold text-slate-800">{agency.maxSites || "무제한"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400">일지 기록 수</p>
            <p className="mt-0.5 font-semibold text-slate-800">{(stats?.logCount ?? 0).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* AI 사용량 */}
      {stats && stats.apiUsage.length > 0 && (
        <div className={T.card}>
          <div className="mb-3 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-black text-slate-700">AI 사용량 (누적)</p>
          </div>
          <div className="flex gap-4">
            {stats.apiUsage.map(u => (
              <div key={u.service} className="rounded-xl bg-slate-50 px-4 py-2.5 text-center">
                <p className="text-lg font-black text-slate-900">{u.count.toLocaleString()}</p>
                <p className="mt-0.5 text-xs font-semibold text-slate-400">{u.service}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* 관리자 */}
        <div className={T.card}>
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-black text-slate-700">관리자 계정</p>
          </div>
          {managers.length === 0 ? (
            <p className="text-sm text-slate-400">관리자가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {managers.map(m => (
                <div key={m.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-black text-slate-900">{m.loginId}</p>
                    {m.displayName && <p className="text-xs text-slate-400">{m.displayName}</p>}
                  </div>
                  <div className="text-right">
                    <span className={`${T.badge} ${m.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                      {m.isActive ? "활성" : "비활성"}
                    </span>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {m.lastLoginAt ? `최근 ${fmtDt(m.lastLoginAt)}` : "로그인 없음"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 현장 */}
        <div className={T.card}>
          <div className="mb-3 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-black text-slate-700">현장 목록</p>
          </div>
          {sites.length === 0 ? (
            <p className="text-sm text-slate-400">등록된 현장이 없습니다.</p>
          ) : (
            <div className="max-h-60 space-y-1.5 overflow-y-auto">
              {sites.map(s => (
                <div key={s.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-800">{s.companyName}</p>
                  <p className="text-xs text-slate-400">훈련생 {s.traineeCount}명</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 직무지도원 */}
      <div className={T.card}>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-slate-500" />
          <p className="text-sm font-black text-slate-700">직무지도원 ({workers.length}명)</p>
        </div>
        {workers.length === 0 ? (
          <p className="text-sm text-slate-400">배정된 직무지도원이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
            {workers.map(c => (
              <div key={c.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">{c.workerName}</p>
                <span className={`${T.badge} ${c.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {c.status === "ACTIVE" ? "활성" : c.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
