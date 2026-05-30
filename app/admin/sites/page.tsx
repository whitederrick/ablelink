"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, MapPin, Users, Building2 } from "lucide-react";

type SiteItem = {
  id: string; companyName: string; address: string;
  agencyId: string|null; agencyName: string|null; planType: string|null;
  traineeCount: number; workerCount: number;
  workers: {id:string;name:string}[];
};

export default function SitesPage() {
  const [sites, setSites]   = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]           = useState("");

  const load = useCallback((query="")=>{
    setLoading(true);
    fetch(`/api/admin/system/sites?q=${encodeURIComponent(query)}`)
      .then(r=>r.json()).then(d=>{if(d.success)setSites(d.sites);}).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{load();},[load]);

  return (
    <div>
      <div className="mb-6"><h1 className="text-xl font-black text-slate-900">전체 현장(Site)</h1>
        <p className="mt-0.5 text-sm text-slate-500">전체 {sites.length}개 현장 현황</p></div>

      <div className="mb-4 flex gap-2">
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load(q)}
          placeholder="현장명 검색..."
          className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/>
        <button onClick={()=>load(q)} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white active:scale-95">
          <Search className="h-4 w-4"/>
        </button>
      </div>

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):(
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50">
              {["현장명","에이전시","훈련생","직무지도원","주소"].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {sites.length===0?(<tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">현장이 없습니다.</td></tr>)
              :sites.map(s=>(
                <tr key={s.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 flex-shrink-0">
                        <Building2 className="h-4 w-4 text-slate-400"/>
                      </div>
                      <span className="font-semibold text-slate-900">{s.companyName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.agencyName?<span className="text-sm text-slate-700">{s.agencyName}</span>:<span className="text-slate-300 text-xs">없음</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-slate-600"><Users className="h-3.5 w-3.5"/>{s.traineeCount}명</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-slate-600">
                      <MapPin className="h-3.5 w-3.5"/>{s.workerCount}명
                      {s.workers.length>0&&<span className="ml-1 text-xs text-slate-400">({s.workers.map(c=>c.name).join(", ")})</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 max-w-[200px] truncate">{s.address||"-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
