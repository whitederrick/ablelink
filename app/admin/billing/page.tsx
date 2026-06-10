"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const PLAN_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  FREE: { label: "FREE", tone: "slate" },
  TRIAL: { label: "TRIAL", tone: "amber" },
  STARTER: { label: "STARTER", tone: "sky" },
  STANDARD: { label: "STANDARD", tone: "violet" },
  PRO: { label: "PRO", tone: "emerald" },
};
const PAGE_SIZE = 20;

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
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

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

  const filtered = useMemo(()=>{
    const query = q.trim().toLowerCase();
    const match = (r: BillingRow, k: string) =>
      k==="paid" ? !["FREE","TRIAL"].includes(r.planType) :
      k==="trial" ? r.planType==="TRIAL" :
      k==="overdue" ? r.isBillingOverdue :
      k==="inactive" ? !r.isActive : false;
    return rows
      .filter(r => filter.length===0 || filter.some(k=>match(r,k)))
      .filter(r => !query || r.name.toLowerCase().includes(query));
  },[rows,q,filter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length/PAGE_SIZE));
  const pageItems = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  useEffect(()=>{setPage(1);},[q,filter]);

  return (
    <div>
      <PageHeader title="결제·구독 현황" sub="전체 에이전시의 플랜 및 결제 상태" />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체 에이전시", value: rows.length },
          { label: "유료 구독", value: paid.length, tone: "emerald" },
          { label: "체험 중", value: trial.length, tone: "amber" },
          { label: "결제 연체", value: overdue.length, tone: "rose" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={q}
          onQueryChange={setQ}
          placeholder="에이전시명 검색"
          filters={[
            { value: "paid", label: "유료", count: paid.length },
            { value: "trial", label: "체험", count: trial.length },
            { value: "overdue", label: "연체", count: overdue.length },
            { value: "inactive", label: "비활성", count: rows.filter(r=>!r.isActive).length },
          ] as FilterChip[]}
          selected={filter}
          onToggleFilter={(v)=>setFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
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
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className={T.empty}>{rows.length===0?"데이터가 없습니다.":"조건에 맞는 결과가 없습니다."}</td></tr>
              ) : pageItems.map(r => (
                <tr key={r.id} className={T.trBase}>
                  <td className={T.td}>
                    {r.name}{!r.isActive && <span className="ml-1.5 text-[13px] text-slate-500">(비활성)</span>}
                  </td>
                  <td className={T.td}>
                    <StatusBadge status={r.planType} map={PLAN_BADGE} />
                  </td>
                  <td className={T.td + " tabular-nums"}>{fmt(r.subscribedAt)}</td>
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
                    <span className={`${T.badge} ${r.isActive ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                      {r.isActive ? "활성" : "비활성"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
