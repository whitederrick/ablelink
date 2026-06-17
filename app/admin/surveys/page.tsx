"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const SURVEY_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "응답 대기", tone: "amber" },
  RESPONDED: { label: "응답 완료", tone: "emerald" },
  EXPIRED: { label: "만료", tone: "slate" },
  CANCELLED: { label: "취소", tone: "slate" },
};
const PAGE_SIZE = 10;

type Status = "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";
interface Survey {
  id: string; agencyName: string; workerName: string;
  recipientName: string | null; recipientPhone: string; siteName: string | null;
  status: Status; auto: boolean;
  scores: Record<string, number> | null; overallScore: number | null; comment: string | null;
  sharedWithAgency: boolean; sentAt: string | null; respondedAt: string | null; createdAt: string;
  totalScore: number | null;
  categoryScores: { name: string; weight: number; score: number }[] | null;
  formSnapshot: { title: string; includeOpinion: boolean; categories: { name: string; weight: number; questions: { text: string; maxScore: number }[] }[] } | null;
}

const SCORE_LABELS: Record<string, string> = {
  professionalism: "전문성", diligence: "성실성", communication: "의사소통", support: "지원 적절성",
};

export default function AdminSurveysPage() {
  const [items, setItems] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  function load() { fetch("/api/admin/system/surveys").then(r => r.json()).then(d => { if (d.success) setItems(d.items); }).catch(() => {}).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(s => statusFilter.length === 0 || statusFilter.includes(s.status))
      .filter(s => !q || (s.agencyName ?? "").toLowerCase().includes(q) || s.workerName.toLowerCase().includes(q) || (s.siteName ?? "").toLowerCase().includes(q));
  }, [items, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  async function toggleShare(s: Survey) {
    await fetch("/api/admin/system/surveys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, sharedWithAgency: !s.sharedWithAgency }) });
    load();
  }

  const responded = items.filter(i => i.status === "RESPONDED");
  // 평균 종합점수(100점 환산): 평가표 결과는 totalScore, 레거시는 overallScore×20
  const scored = responded
    .map(b => b.totalScore != null ? b.totalScore : (b.overallScore != null ? b.overallScore * 20 : null))
    .filter((v): v is number => v != null);
  const avgOverall = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length).toString() : "-";

  const filters: FilterChip[] = [
    { value: "PENDING", label: "응답 대기", count: items.filter(i => i.status === "PENDING").length },
    { value: "RESPONDED", label: "응답 완료", count: responded.length },
    { value: "EXPIRED", label: "만료", count: items.filter(i => i.status === "EXPIRED").length },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader title="직무지도원 평가 결과 관리" sub="모든 위탁기관의 직무지도원 역량 평가 결과를 조회하고(문항·의견·총점), 위탁기관에 총점·카테고리만 전달할 수 있습니다." />

      <StatCardRow
        cols={3}
        items={[
          { label: "전체 조사", value: items.length },
          { label: "응답 완료", value: responded.length, tone: "emerald" },
          { label: "평균 종합 점수 (/100)", value: avgOverall, tone: "amber" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="위탁기관·직무지도원·사업체 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead><tr>{["위탁기관", "직무지도원", "사업체/담당자", "상태", "종합", "전달", "응답일"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className={T.tdCenter}>로딩 중...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={7} className={T.tdCenter}>{items.length === 0 ? "조사 결과가 없습니다." : "조건에 맞는 결과가 없습니다."}</td></tr>
            : pageItems.map(s => {
              const open = openId === s.id;
              return (
                <Fragment key={s.id}>
                  <tr className={`${T.trBase} cursor-pointer`} onClick={() => setOpenId(open ? null : s.id)}>
                    <td className={`${T.td}`}>{s.agencyName}</td>
                    <td className={`${T.td}`}>{s.workerName}</td>
                    <td className={T.td}><div className="text-slate-700">{s.siteName || "-"}</div><div className="text-xs text-slate-400">{s.recipientName || ""} {s.recipientPhone}</div></td>
                    <td className={T.td}><StatusBadge status={s.status} map={SURVEY_BADGE} />{s.auto && <span className="ml-1 text-[10px] text-slate-400">자동</span>}</td>
                    <td className={`${T.td} font-black ${(s.totalScore != null || s.overallScore) ? "text-slate-800" : "text-slate-300"}`}>{s.totalScore != null ? `${s.totalScore}/100` : s.overallScore ? `${s.overallScore}/5` : "-"}</td>
                    <td className={T.td}>{s.status === "RESPONDED" && (
                      <button onClick={(e) => { e.stopPropagation(); toggleShare(s); }} className={`rounded-lg px-2.5 py-1 text-xs font-bold ${s.sharedWithAgency ? "bg-emerald-50 text-emerald-600" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{s.sharedWithAgency ? "전달됨 ✓" : "전달하기"}</button>
                    )}</td>
                    <td className={`${T.td}`}>{s.respondedAt ? s.respondedAt.slice(0, 10) : "-"}</td>
                  </tr>
                  {open && s.status === "RESPONDED" && (
                    <tr><td colSpan={7} className="bg-slate-50 px-5 py-4">
                      {s.formSnapshot && s.totalScore != null ? (
                        // 역량 평가표 결과(운영자 전체 열람) — 카테고리·문항별 점수 + 의견
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded-xl bg-sky-600 px-3 py-1.5 text-sm font-black text-white">종합 {s.totalScore}/100</span>
                            <span className="text-xs font-semibold text-slate-400">{s.formSnapshot.title}</span>
                          </div>
                          <div className="grid gap-2 lg:grid-cols-2">
                            {s.formSnapshot.categories.map((cat, ci) => {
                              const cs = s.categoryScores?.find(c => c.name === cat.name);
                              return (
                                <div key={ci} className="rounded-xl border border-slate-200 bg-white p-3">
                                  <div className="mb-1.5 flex items-center justify-between">
                                    <p className="text-sm font-black text-slate-800">{ci + 1}. {cat.name}</p>
                                    <span className="text-sm font-black text-sky-700">{cs ? cs.score : 0}<span className="text-xs font-semibold text-slate-400">/{cat.weight}</span></span>
                                  </div>
                                  <div className="space-y-1">
                                    {cat.questions.map((q, qi) => (
                                      <div key={qi} className="flex items-center justify-between gap-3 border-t border-slate-50 pt-1 first:border-t-0 first:pt-0">
                                        <span className="text-xs text-slate-600">{q.text}</span>
                                        <span className="flex-shrink-0 text-xs font-black text-amber-500">★ {s.scores?.[`${ci}_${qi}`] ?? "-"}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {s.comment && <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11px] font-semibold text-slate-400">사업체 담당자 의견</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{s.comment}</p></div>}
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-4">
                            {s.scores && Object.entries(s.scores).map(([k, v]) => (
                              <div key={k} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center"><p className="text-[11px] font-semibold text-slate-400">{SCORE_LABELS[k] || k}</p><p className="text-lg font-black text-slate-800">{v}<span className="text-xs text-slate-400">/5</span></p></div>
                            ))}
                          </div>
                          {s.comment && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11px] font-semibold text-slate-400">의견</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{s.comment}</p></div>}
                        </>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>
    </div>
  );
}
