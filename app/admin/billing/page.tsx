"use client";

import { useEffect, useState } from "react";
import { RefreshCw, CreditCard, AlertCircle } from "lucide-react";
import { T } from "../_styles";

const PLAN_COLORS: Record<string, string> = {
  FREE:     "bg-slate-100 text-slate-600",
  TRIAL:    "bg-amber-100 text-amber-700",
  STARTER:  "bg-sky-100 text-sky-700",
  STANDARD: "bg-violet-100 text-violet-700",
  PRO:      "bg-emerald-100 text-emerald-700",
};

type BillingRow = {
  id: string; name: string; planType: string; isActive: boolean;
  subscribedAt: string | null; nextBillingAt: string | null; trialEndsAt: string | null;
  isTrialExpired: boolean; isBillingOverdue: boolean; hasBillingKey: boolean;
  managerCount: number; siteCount: number;
};

function fmt(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR");
}

export default function BillingPage() {
  const [rows, setRows]     = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch("/api/admin/system/billing")
      .then(r => r.json())
      .then(d => { if (d.success) setRows(d.billing); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const paid    = rows.filter(r => !["FREE","TRIAL"].includes(r.planType));
  const overdue = rows.filter(r => r.isBillingOverdue);
  const trial   = rows.filter(r => r.planType === "TRIAL");
  const inactive = rows.filter(r => !r.isActive);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>결제·구독 현황</h1>
          <p className={T.pageSub}>전체 에이전시의 플랜 및 결제 상태</p>
        </div>
        <button onClick={load} className={T.btnSecondary + " flex items-center gap-1.5"}>
          <RefreshCw className="h-4 w-4" />새로고침
        </button>
      </div>

      <div className={T.summaryGrid}>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{rows.length}</p>
          <p className={T.summaryLabel}>전체 에이전시</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-emerald-600"}>{paid.length}</p>
          <p className={T.summaryLabel}>유료 구독</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-amber-600"}>{trial.length}</p>
          <p className={T.summaryLabel}>체험 중</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-rose-600"}>{overdue.length}</p>
          <p className={T.summaryLabel}>결제 연체</p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : (
        <div className={T.tableWrap}>
          <table className="w-full">
            <thead>
              <tr>
                {["에이전시","플랜","구독 시작","다음 결제","체험 종료","빌링키","관리자","현장","상태"].map(h => (
                  <th key={h} className={T.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className={T.empty}>데이터가 없습니다.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className={T.trBase}>
                  <td className={T.td}>
                    <span className="font-semibold text-slate-900">{r.name}</span>
                    {!r.isActive && <span className="ml-1.5 text-xs text-slate-400">(비활성)</span>}
                  </td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${PLAN_COLORS[r.planType] ?? "bg-slate-100 text-slate-600"}`}>
                      {r.planType}
                    </span>
                  </td>
                  <td className={T.td + " text-slate-500 tabular-nums"}>{fmt(r.subscribedAt)}</td>
                  <td className={T.td + " tabular-nums"}>
                    {r.nextBillingAt ? (
                      <span className={r.isBillingOverdue ? "font-black text-rose-600" : "text-slate-700"}>
                        {r.isBillingOverdue && <AlertCircle className="mr-1 inline h-3.5 w-3.5" />}
                        {fmt(r.nextBillingAt)}
                      </span>
                    ) : "-"}
                  </td>
                  <td className={T.td + " tabular-nums"}>
                    {r.trialEndsAt ? (
                      <span className={r.isTrialExpired ? "text-slate-400 line-through" : "text-amber-700"}>
                        {fmt(r.trialEndsAt)}
                      </span>
                    ) : "-"}
                  </td>
                  <td className={T.td}>
                    <span className={r.hasBillingKey ? "text-emerald-600 font-semibold" : "text-slate-400"}>
                      {r.hasBillingKey ? "등록됨" : "없음"}
                    </span>
                  </td>
                  <td className={T.td + " text-center"}>{r.managerCount}명</td>
                  <td className={T.td + " text-center"}>{r.siteCount}개소</td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${r.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                      {r.isActive ? "활성" : "비활성"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
