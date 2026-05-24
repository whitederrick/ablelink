"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { T } from "../_styles";

interface TraineeSummary {
  siteId: string; siteName: string; coachName: string;
  trainees: Array<{
    id: string; name: string; gender: string; disabilityType: string;
    severity: string; status: string; logCount: number; lastLogDate: string | null;
  }>;
}

const STATUS_CLS: Record<string, string> = {
  TRAINING: "bg-sky-50 text-sky-700",
  EMPLOYED: "bg-emerald-50 text-emerald-700",
  DROPOUT:  "bg-rose-50 text-rose-700",
  GRADUATED:"bg-slate-100 text-slate-500",
};
const STATUS_LABELS: Record<string, string> = {
  TRAINING: "훈련중", EMPLOYED: "취업", DROPOUT: "중도포기", GRADUATED: "수료",
};

export default function TraineesPage() {
  const [sites, setSites] = useState<TraineeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
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

  const filteredSites = sites.filter(s =>
    s.siteName.includes(search) || s.coachName.includes(search) ||
    s.trainees.some(t => t.name.includes(search))
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className={T.pageTitle}>훈련생 현황</h1>
        <p className={T.pageSub}>※ 훈련생 등록/수정은 한국장애인고용공단에서 관리합니다. 에이전시는 현황만 조회할 수 있습니다.</p>
      </div>

      <div className={T.summaryGrid}>
        {[
          { label: "전체 훈련생", value: totalTrainees, cls: "text-slate-900" },
          { label: "훈련중",     value: trainingCount, cls: "text-sky-600" },
          { label: "취업",       value: employedCount, cls: "text-emerald-600" },
          { label: "담당 Site",  value: sites.length,  cls: "text-slate-500" },
        ].map((item, i) => (
          <div key={i} className={T.summaryCard}>
            <p className={`${T.summaryNum} ${item.cls}`}>{item.value}</p>
            <p className={T.summaryLabel}>{item.label}</p>
          </div>
        ))}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="현장명 / 직무지도원 / 훈련생 이름 검색"
        className={`max-w-md ${T.input}`} />

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
                  <p className="pl-6 text-xs font-semibold text-slate-400">직무지도원: {site.coachName}</p>
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
                          <td className={`${T.td} font-black text-slate-900`}>{t.name}</td>
                          <td className={`${T.td} text-slate-500`}>{t.gender === "M" ? "남" : "여"}</td>
                          <td className={`${T.td} text-slate-600`}>{t.disabilityType || "-"}</td>
                          <td className={`${T.td} text-slate-600`}>{t.severity || "-"}</td>
                          <td className={`${T.td} font-black text-sky-600`}>{t.logCount}건</td>
                          <td className={`${T.td} text-xs text-slate-400`}>{t.lastLogDate || "-"}</td>
                          <td className={T.td}>
                            <span className={`${T.badge} ${STATUS_CLS[t.status] || "bg-slate-100 text-slate-500"}`}>
                              {STATUS_LABELS[t.status] || t.status}
                            </span>
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
