"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import AgencyDetail from "../agencies/AgencyDetail";

const PLAN_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  FREE: { label: "구독 없음", tone: "slate" },
  TRIAL: { label: "TRIAL", tone: "amber" },
  STARTER: { label: "STARTER", tone: "sky" },
  STANDARD: { label: "STANDARD", tone: "sky" },
  PRO: { label: "PRO", tone: "emerald" },
};
const PAGE_SIZE = 10;

type BillingRow = {
  id: string; name: string; planType: string; isActive: boolean;
  subscribedAt: string | null; nextBillingAt: string | null; trialEndsAt: string | null;
  canceledAt: string | null;
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
  const [detailId, setDetailId] = useState<string | null>(null);

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
      <PageHeader title="결제·구독 현황" sub="전체 위탁기관의 구독 플랜과 결제·연체 상태를 확인합니다." />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체 위탁기관", value: rows.length },
          { label: "유료 구독", value: paid.length, tone: "emerald" },
          { label: "체험 중", value: trial.length, tone: "amber" },
          { label: "결제 연체", value: overdue.length, tone: "rose" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={q}
          onQueryChange={setQ}
          placeholder="위탁기관명 검색"
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

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[170px]" />{/* 위탁기관 */}
            <col className="w-[100px]" />{/* 플랜 */}
            <col className="w-[110px]" />{/* 구독 시작 */}
            <col className="w-[120px]" />{/* 다음 결제 */}
            <col className="w-[110px]" />{/* 체험 종료 */}
            <col className="w-[90px]" />{/* 빌링키 */}
            <col className="w-[84px]" />{/* 관리자 */}
            <col className="w-[84px]" />{/* 현장 */}
            <col className="w-[84px]" />{/* 상태 */}
          </colgroup>
          <thead>
            <tr>{["위탁기관","플랜","구독 시작","다음 결제","체험 종료","빌링키","관리자","현장","상태"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className={T.tdCenter}>{rows.length===0?"데이터가 없습니다.":"조건에 맞는 결과가 없습니다."}</td></tr>
            ) : pageItems.map(r => {
              const canceled = !!r.canceledAt || (r.planType === "FREE" && !!r.subscribedAt && !r.hasBillingKey);
              return (
              <tr key={r.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetailId(r.id)}>
                <td className={`${T.td} truncate`}>
                  <span className="font-bold text-sky-600">{r.name}</span>{!r.isActive && <span className="ml-1.5 text-[13px] text-slate-400">(비활성)</span>}
                </td>
                <td className={T.td}>
                  <span className="flex items-center gap-1.5">
                    <StatusBadge status={r.planType} map={PLAN_BADGE} />
                    {canceled && <span className={`${T.badge} bg-rose-50 text-rose-600`}>해지</span>}
                  </span>
                </td>
                <td className={`${T.td} tabular-nums`}>{fmt(r.subscribedAt)}</td>
                <td className={`${T.td} tabular-nums`}>
                  {canceled ? (
                    <span className="font-semibold text-rose-600">해지 {fmt(r.canceledAt)}</span>
                  ) : r.nextBillingAt ? (
                    <span className={r.isBillingOverdue ? "font-black text-rose-600" : "text-slate-700"}>
                      {r.isBillingOverdue && <AlertCircle className="mr-1 inline h-3.5 w-3.5" />}{fmt(r.nextBillingAt)}
                    </span>
                  ) : "-"}
                </td>
                <td className={`${T.td} tabular-nums`}>
                  {r.trialEndsAt ? (
                    <span className={r.isTrialExpired ? "text-slate-400 line-through" : "text-amber-700"}>{fmt(r.trialEndsAt)}</span>
                  ) : "-"}
                </td>
                <td className={T.td}>
                  <span className={r.hasBillingKey ? "font-semibold text-emerald-600" : "text-slate-400"}>{r.hasBillingKey ? "등록됨" : "없음"}</span>
                </td>
                <td className={T.td}>{r.managerCount}명</td>
                <td className={T.td}>{r.siteCount}개소</td>
                <td className={T.td}>
                  <span className={`${T.badge} ${r.isActive ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>{r.isActive ? "활성" : "비활성"}</span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <Pagination className="pt-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}

      {/* 구독 상세 모달 — 위탁기관 상세(플랜·결제 딜 변경) 재사용 */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5" onClick={() => setDetailId(null)}>
          <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <AgencyDetail key={detailId} id={detailId} onClose={() => setDetailId(null)} onChanged={load} />
          </div>
        </div>
      )}
    </div>
  );
}
