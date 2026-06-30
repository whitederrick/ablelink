"use client";

// 훈련생 현황 (운영자) — 평면 목록(테이블) 조회. 등록·수정은 공단 관리, 운영자는 조회만.
import { useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

interface TraineeSummary {
  siteId: string; siteName: string; workerName: string;
  trainees: Array<{
    id: string; name: string; gender: string; disabilityType: string;
    severity: string; status: string; logCount: number; lastLogDate: string | null;
  }>;
}
type Row = TraineeSummary["trainees"][number] & { siteId: string; siteName: string; workerName: string };

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  TRAINING:  { label: "훈련중",    tone: "sky" },
  EMPLOYED:  { label: "취업",      tone: "emerald" },
  DROPOUT:   { label: "중도포기",  tone: "rose" },
  GRADUATED: { label: "수료",      tone: "slate" },
};
const PAGE_SIZE = 10;

export default function TraineesPage() {
  const [sites, setSites] = useState<TraineeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    // 운영자 콘솔 화면 — 듀얼 세션에서도 전체 기관 조회되도록 x-admin-context 부착(다른 admin 화면과 동일)
    fetch("/api/admin/trainees/summary", { headers: { "x-admin-context": "1" }, cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.data)) setSites(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 전체 행(현장×훈련생) 평탄화
  const allRows: Row[] = useMemo(
    () => sites.flatMap(s => s.trainees.map(t => ({ ...t, siteId: s.siteId, siteName: s.siteName, workerName: s.workerName }))),
    [sites],
  );

  const totalTrainees = allRows.length;
  const statusCount = (st: string) => allRows.filter(r => r.status === st).length;
  const filters: FilterChip[] = [
    { value: "TRAINING",  label: "훈련중",   count: statusCount("TRAINING") },
    { value: "EMPLOYED",  label: "취업",     count: statusCount("EMPLOYED") },
    { value: "DROPOUT",   label: "중도포기", count: statusCount("DROPOUT") },
    { value: "GRADUATED", label: "수료",     count: statusCount("GRADUATED") },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return allRows.filter(r => {
      if (statusFilter.length > 0 && !statusFilter.includes(r.status)) return false;
      if (!q) return true;
      return r.name.includes(q) || r.siteName.includes(q) || r.workerName.includes(q);
    });
  }, [allRows, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

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
          { label: "훈련중", value: statusCount("TRAINING"), tone: "sky" },
          { label: "취업", value: statusCount("EMPLOYED"), tone: "emerald" },
          { label: "담당 현장", value: sites.length, tone: "slate" },
        ]}
      />

      <ListToolbar
        query={search}
        onQueryChange={setSearch}
        placeholder="훈련생 이름 / 현장명 / 직무지도원 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className={T.tableWrap}>
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[14%]" /><col className="w-[20%]" /><col className="w-[12%]" />
            <col className="w-[6%]" /><col className="w-[14%]" /><col className="w-[9%]" />
            <col className="w-[8%]" /><col className="w-[10%]" /><col className="w-[9%]" />
          </colgroup>
          <thead>
            <tr>
              <th className={T.th}>훈련생</th>
              <th className={T.th}>현장(사업체)</th>
              <th className={T.th}>직무지도원</th>
              <th className={T.th}>성별</th>
              <th className={T.th}>장애유형</th>
              <th className={T.th}>중증도</th>
              <th className={T.th}>일지 수</th>
              <th className={T.th}>최근 일지</th>
              <th className={T.th}>상태</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className={T.empty}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className={T.empty}>{sites.length === 0 ? "훈련생 정보가 없습니다." : "조건에 맞는 훈련생이 없습니다."}</td></tr>
            ) : (
              pageRows.map(r => (
                <tr key={r.id} className={T.trBase}>
                  <td className={`${T.td} font-bold text-slate-900`}><div className="truncate">{r.name}</div></td>
                  <td className={T.td}><div className="truncate">{r.siteName}</div></td>
                  <td className={T.td}><div className="truncate">{r.workerName}</div></td>
                  <td className={T.td}>{r.gender === "M" ? "남" : "여"}</td>
                  <td className={T.td}><div className="truncate">{r.disabilityType || "-"}</div></td>
                  <td className={T.td}><div className="truncate">{r.severity || "-"}</div></td>
                  <td className={`${T.td} text-sky-600`}>{r.logCount}건</td>
                  <td className={T.td}>{r.lastLogDate || "-"}</td>
                  <td className={T.td}><StatusBadge status={r.status} map={STATUS_BADGE} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>
    </div>
  );
}
