"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

interface TraineeSummary {
  siteId: string; siteName: string; workerName: string;
  trainees: Array<{
    id: string; name: string; gender: string; disabilityType: string;
    severity: string; status: string; logCount: number; lastLogDate: string | null;
  }>;
}

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  TRAINING:  { label: "훈련중",    tone: "sky" },
  EMPLOYED:  { label: "취업",      tone: "emerald" },
  DROPOUT:   { label: "중도포기",  tone: "rose" },
  GRADUATED: { label: "수료",      tone: "slate" },
};

export default function TraineesPage() {
  const [sites, setSites] = useState<TraineeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/admin/trainees/summary")
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.data)) {
          setSites(d.data);
          const init: Record<string, boolean> = {};
          d.data.forEach((s: TraineeSummary) => { init[s.siteId] = true; });
          setExpanded(init);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalTrainees = sites.reduce((s, site) => s + site.trainees.length, 0);
  const trainingCount = sites.reduce((s, site) => s + site.trainees.filter(t => t.status === "TRAINING").length, 0);
  const employedCount = sites.reduce((s, site) => s + site.trainees.filter(t => t.status === "EMPLOYED").length, 0);

  const statusCount = (st: string) => sites.reduce((s, site) => s + site.trainees.filter(t => t.status === st).length, 0);
  const filters: FilterChip[] = [
    { value: "TRAINING",  label: "훈련중",   count: statusCount("TRAINING") },
    { value: "EMPLOYED",  label: "취업",     count: statusCount("EMPLOYED") },
    { value: "DROPOUT",   label: "중도포기", count: statusCount("DROPOUT") },
    { value: "GRADUATED", label: "수료",     count: statusCount("GRADUATED") },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  // 검색(현장/직무지도원/훈련생명) + 상태칩으로 훈련생 필터링, 매칭 0인 현장은 숨김
  const filteredSites = useMemo(() => {
    return sites
      .map(site => {
        const trainees = site.trainees.filter(t => statusFilter.length === 0 || statusFilter.includes(t.status));
        return { ...site, trainees };
      })
      .filter(site => {
        if (site.trainees.length === 0) return false;
        if (!search) return true;
        return site.siteName.includes(search) || site.workerName.includes(search) ||
          site.trainees.some(t => t.name.includes(search));
      });
  }, [sites, search, statusFilter]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="훈련생 현황"
        sub="전체 훈련생 현황을 조회합니다. (등록·수정은 한국장애인고용공단에서 관리하며, 위탁기관는 조회만 가능합니다.)"
      />

      <StatCardRow
        cols={4}
        items={[
          { label: "전체 훈련생", value: totalTrainees },
          { label: "훈련중", value: trainingCount, tone: "sky" },
          { label: "취업", value: employedCount, tone: "emerald" },
          { label: "담당 현장", value: sites.length, tone: "slate" },
        ]}
      />

      <ListToolbar
        query={search}
        onQueryChange={setSearch}
        placeholder="현장명 / 직무지도원 / 훈련생 이름 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      {loading ? (
        <p className={T.empty}>로딩 중...</p>
      ) : filteredSites.length === 0 ? (
        <p className={T.empty}>훈련생 정보가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {filteredSites.map(site => (
            <div key={site.siteId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <button
                onClick={() => setExpanded(prev => ({ ...prev, [site.siteId]: !prev[site.siteId] }))}
                className="flex w-full items-center justify-between bg-slate-50 px-5 py-4 text-left transition hover:bg-slate-100"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span className="font-black text-slate-900">{site.siteName}</span>
                  </div>
                  <p className="pl-6 text-xs font-semibold text-slate-400">직무지도원: {site.workerName}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-black text-sky-600">{site.trainees.length}명</span>
                  {expanded[site.siteId]
                    ? <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    : <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                </div>
              </button>

              {expanded[site.siteId] && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {["이름", "성별", "장애유형", "중증도", "일지 수", "최근 일지", "상태"].map(h => (
                          <th key={h} className={T.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {site.trainees.map(t => (
                        <tr key={t.id} className={T.trBase}>
                          <td className={`${T.td}`}>{t.name}</td>
                          <td className={`${T.td}`}>{t.gender === "M" ? "남" : "여"}</td>
                          <td className={`${T.td}`}>{t.disabilityType || "-"}</td>
                          <td className={`${T.td}`}>{t.severity || "-"}</td>
                          <td className={`${T.td} text-sky-600`}>{t.logCount}건</td>
                          <td className={`${T.td}`}>{t.lastLogDate || "-"}</td>
                          <td className={T.td}>
                            <StatusBadge status={t.status} map={STATUS_BADGE} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
