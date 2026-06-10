"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "../_components/PageHeader";
import { T } from "../_styles";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { StatCardRow } from "../_components/StatCard";
import { MapPin, Users, Building2 } from "lucide-react";

const PAGE_SIZE = 10;

const PROF_LABEL: Record<string, string> = {
  JOB_COACH: "직무지도원", CAREGIVER: "요양보호사", ACTIVITY_ASSISTANT: "활동지원사",
};

type SiteItem = {
  id: string; companyName: string; address: string;
  requiredProfession: string|null;
  agencyId: string|null; agencyName: string|null; planType: string|null;
  traineeCount: number; workerCount: number;
  workers: {id:string;name:string}[];
};

export default function SitesPage() {
  const router = useRouter();
  const [sites, setSites]   = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]           = useState("");

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
        title="현장(Site) 현황 관리"
        sub="모든 에이전시 현장 현황"
        actions={
          <Link href="/admin/sites/new" className={`${T.btnPrimary} no-underline`}>+ 현장 생성</Link>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 현장", value: sites.length },
          { label: "에이전시 연결", value: linked, tone: "emerald" },
          { label: "미연결", value: sites.length - linked, tone: "slate" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={q}
          onQueryChange={setQ}
          placeholder="현장명·주소·에이전시 검색"
          filters={[
            { value: "linked", label: "연결", count: linked },
            { value: "unlinked", label: "미연결", count: sites.length - linked },
          ] as FilterChip[]}
          selected={linkFilter}
          onToggleFilter={(v)=>setLinkFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
      </div>

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):(
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50">
              {["현장명","직종","에이전시","훈련생","직무지도원","주소"].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length===0?(<tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">{sites.length===0?"현장이 없습니다.":"조건에 맞는 현장이 없습니다."}</td></tr>)
              :pageItems.map(s=>(
                <tr key={s.id} onClick={()=>router.push(`/admin/sites/${s.id}`)} className="cursor-pointer hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 flex-shrink-0">
                        <Building2 className="h-4 w-4 text-slate-400"/>
                      </div>
                      <span className="font-semibold">{s.companyName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.requiredProfession
                      ? <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[13px] font-black text-sky-600">{PROF_LABEL[s.requiredProfession] ?? s.requiredProfession}</span>
                      : <span className="text-slate-400">-</span>}
                  </td>
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800">
                    {s.agencyName || <span className="text-slate-400">없음</span>}
                  </td>
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800">
                    <div className="flex items-center gap-1"><Users className="h-4 w-4 text-slate-400"/>{s.traineeCount}명</div>
                  </td>
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4 text-slate-400"/>{s.workerCount}명
                      {s.workers.length>0&&<span className="ml-1 text-[13px] text-slate-500">({s.workers.map(c=>c.name).join(", ")})</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800 max-w-[200px] truncate">{s.address||"-"}</td>
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
