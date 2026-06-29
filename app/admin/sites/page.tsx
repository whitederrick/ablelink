"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import PageHeader from "../_components/PageHeader";
import { T } from "../_styles";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import SiteDetail from "./SiteDetail";

const SITE_STATUS_MAP = { ACTIVE: { label: "활성", tone: "sky" as const }, INACTIVE: { label: "비활성", tone: "rose" as const } };

// 기준점 승인 워크플로 라벨(매니저 현장 관리와 동일 기준)
const BASE_POINT: Record<string, { label: string; cls: string }> = {
  ORIGINAL_SET:         { label: "미확정",   cls: "bg-rose-50 text-rose-600" },
  WORKER_PROPOSED:      { label: "제안됨",   cls: "bg-amber-50 text-amber-600" },
  APPROVED:             { label: "승인",     cls: "bg-emerald-50 text-emerald-600" },
  REJECTED:             { label: "반려",     cls: "bg-rose-50 text-rose-600" },
  CORRECTION_REQUESTED: { label: "수정요청", cls: "bg-sky-50 text-sky-600" },
};

const PAGE_SIZE = 10;

type SiteItem = {
  id: string; companyName: string; address: string;
  requiredProfession: string|null;
  agencyId: string|null; agencyName: string|null; planType: string|null;
  businessContactName: string|null; businessContactPhone: string|null;
  ownerManagerName: string|null; allowanceRange: number|null;
  basePointConfirmed: boolean; basePointApprovalStatus: string|null;
  traineeCount: number; workerCount: number;
  workers: {id:string;name:string}[];
  isActive: boolean;
};

export default function SitesPage() {
  const [sites, setSites]   = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]           = useState("");
  const [detailId, setDetailId] = useState<string|null>(null);

  const [linkFilter, setLinkFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const load = useCallback(()=>{
    setLoading(true);
    fetch(`/api/admin/system/sites`)
      .then(r=>r.json()).then(d=>{if(d.success)setSites(d.sites);}).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{load();},[load]);

  const linked = sites.filter(s=>s.agencyId).length;
  const filtered = useMemo(()=>{
    const query = q.trim().toLowerCase();
    return sites
      .filter(s => linkFilter.length===0 || linkFilter.includes(s.agencyId ? "linked" : "unlinked"))
      .filter(s => !query || s.companyName.toLowerCase().includes(query) || (s.address??"").toLowerCase().includes(query) || (s.agencyName??"").toLowerCase().includes(query));
  },[sites,q,linkFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length/PAGE_SIZE));
  const pageItems = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  useEffect(()=>{setPage(1);},[q,linkFilter]);

  return (
    <div>
      <PageHeader
        title="현장(사업체) 현황 관리"
        sub="전체 위탁기관의 현장을 조회하고 상세 정보를 관리합니다."
        actions={
          <Link href="/admin/sites/new" className={`${T.btnPrimary} no-underline`}>+ 현장(사업체) 등록</Link>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 현장", value: sites.length },
          { label: "위탁기관 연결", value: linked, tone: "emerald" },
          { label: "미연결", value: sites.length - linked, tone: "slate" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={q}
          onQueryChange={setQ}
          placeholder="현장명·주소·위탁기관 검색"
          filters={[
            { value: "linked", label: "연결", count: linked },
            { value: "unlinked", label: "미연결", count: sites.length - linked },
          ] as FilterChip[]}
          selected={linkFilter}
          onToggleFilter={(v)=>setLinkFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1320px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[64px]" />{/* ID */}
            <col className="w-[180px]" />{/* 현장(사업체) */}
            <col className="w-[200px]" />{/* 주소 */}
            <col className="w-[110px]" />{/* 사업체 담당자 성명 */}
            <col className="w-[130px]" />{/* 사업체 담당자 연락처 */}
            <col className="w-[120px]" />{/* 위탁기관 담당자 */}
            <col className="w-[150px]" />{/* 기관명 */}
            <col className="w-[96px]" />{/* 직무지도원 수 */}
            <col className="w-[90px]" />{/* GPS 범위 */}
            <col className="w-[90px]" />{/* 기준점 */}
            <col className="w-[84px]" />{/* 활성 여부 */}
          </colgroup>
          <thead>
            <tr>{["ID","현장(사업체)","주소","사업체 담당자 성명","사업체 담당자 연락처","위탁기관 담당자","기관명","직무지도원 수","GPS 범위","기준점","활성 여부"].map(h=><th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading?(
              <tr><td colSpan={11} className={T.tdCenter}>로딩 중...</td></tr>
            ):filtered.length===0?(
              <tr><td colSpan={11} className={T.tdCenter}>{sites.length===0?"현장이 없습니다.":"조건에 맞는 현장이 없습니다."}</td></tr>
            ):pageItems.map(s=>(
              <tr key={s.id} onClick={()=>setDetailId(s.id)} className={`${T.trBase} cursor-pointer hover:bg-slate-50`}>
                <td className={`${T.td} truncate text-slate-400`}>{s.id}</td>
                <td className={`${T.td} truncate`}><span className="font-bold text-sky-600">{s.companyName}</span></td>
                <td className={`${T.td} truncate`}>{s.address||"-"}</td>
                <td className={`${T.td} truncate`}>{s.businessContactName||"-"}</td>
                <td className={`${T.td} truncate`}>{s.businessContactPhone||"-"}</td>
                <td className={`${T.td} truncate`}>{s.ownerManagerName||<span className="text-slate-400">미지정</span>}</td>
                <td className={`${T.td} truncate`}>{s.agencyName||<span className="text-slate-400">없음</span>}</td>
                <td className={T.td}>{s.workerCount}명</td>
                <td className={T.td}>{s.allowanceRange?`${s.allowanceRange}m`:"-"}</td>
                <td className={T.td}>
                  {s.basePointConfirmed
                    ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>확정</span>
                    : s.basePointApprovalStatus
                      ? <span className={`${T.badge} ${BASE_POINT[s.basePointApprovalStatus]?.cls ?? "bg-slate-100 text-slate-500"}`}>{BASE_POINT[s.basePointApprovalStatus]?.label ?? s.basePointApprovalStatus}</span>
                      : "-"}
                </td>
                <td className={T.td}><StatusBadge status={s.isActive ? "ACTIVE" : "INACTIVE"} map={SITE_STATUS_MAP} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length>0 && (
        <Pagination className="pt-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}

      {/* 현장 상세 모달 */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5" onClick={()=>setDetailId(null)}>
          <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <SiteDetail key={detailId} id={detailId} onClose={()=>setDetailId(null)} onChanged={load} />
          </div>
        </div>
      )}
    </div>
  );
}
