"use client";

import { useEffect, useState } from "react";
import { Building2, Users, MapPin, Crown } from "lucide-react";

type Agency = {
  id: string;
  name: string;
  planType: string;
  trialEndsAt: string | null;
  createdAt: string;
  managerCount: number;
  siteCount: number;
};

const PLAN_COLORS: Record<string, string> = {
  FREE:     "bg-slate-100 text-slate-600",
  TRIAL:    "bg-amber-100 text-amber-700",
  STARTER:  "bg-sky-100 text-sky-700",
  STANDARD: "bg-violet-100 text-violet-700",
  PRO:      "bg-emerald-100 text-emerald-700",
};

export default function AgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");

  useEffect(() => {
    fetch("/api/admin/system/agencies")
      .then(r => r.json())
      .then(d => { if (d.success) setAgencies(d.agencies); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = agencies.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">에이전시 관리</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            전체 {agencies.length}개 에이전시
          </p>
        </div>
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="에이전시 이름 검색..."
          className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">에이전시명</th>
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">플랜</th>
                <th className="px-5 py-3 text-center text-xs font-black uppercase tracking-wide text-slate-500">담당자</th>
                <th className="px-5 py-3 text-center text-xs font-black uppercase tracking-wide text-slate-500">현장</th>
                <th className="px-5 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">가입일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">에이전시가 없습니다.</td></tr>
              ) : filtered.map(a => (
                <tr key={a.id} className="hover:bg-slate-50 transition">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                        <Building2 className="h-4 w-4 text-slate-500" />
                      </div>
                      <span className="font-semibold text-slate-900">{a.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${PLAN_COLORS[a.planType] ?? "bg-slate-100 text-slate-600"}`}>
                      {a.planType}
                    </span>
                    {a.trialEndsAt && (
                      <span className="ml-2 text-[10px] text-slate-400">
                        체험 ~{new Date(a.trialEndsAt).toLocaleDateString("ko-KR")}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <div className="flex items-center justify-center gap-1 text-slate-600">
                      <Users className="h-3.5 w-3.5" />
                      <span className="font-semibold">{a.managerCount}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <div className="flex items-center justify-center gap-1 text-slate-600">
                      <MapPin className="h-3.5 w-3.5" />
                      <span className="font-semibold">{a.siteCount}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {new Date(a.createdAt).toLocaleDateString("ko-KR")}
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
