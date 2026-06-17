"use client";

// 훈련생 현황 관리 — 구성·사이즈는 현장(사업체) 관리 / 직무지도원 관리 기준 패턴을 따른다.
// 행 클릭 → 상세 모달(TraineeDetailModal), 등록=동일 모달 등록모드. 가로 스크롤(줄바꿈 방지).
import { useCallback, useEffect, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import TraineeDetailModal, { type Trainee } from "./TraineeDetailModal";

const PAGE_SIZE = 10;
type Site = { id: string; companyName: string };

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  TRAINING:  { label: "훈련중",   tone: "sky" },
  EMPLOYED:  { label: "취업",     tone: "emerald" },
  DROPOUT:   { label: "중도포기", tone: "rose" },
  GRADUATED: { label: "수료",     tone: "slate" },
};

export default function TraineesPage() {
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [sites, setSites]       = useState<Site[]>([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]         = useState(1);
  const [detail, setDetail]     = useState<Trainee | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/trainees").then(r => r.json()),
      fetch("/api/admin/sites?pageSize=100").then(r => r.json()),
    ]).then(([tRes, sRes]) => {
      if (tRes.success) setTrainees(tRes.trainees);
      if (sRes.success) setSites(sRes.items?.map((s: any) => ({ id: s.id, companyName: s.companyName })) || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trainees
      .filter(t => statusFilter.length === 0 || statusFilter.includes(t.status))
      .filter(t => !q || t.name.toLowerCase().includes(q) || t.siteName.toLowerCase().includes(q) || t.disabilityType.toLowerCase().includes(q));
  }, [trainees, query, statusFilter]);

  const cnt = (s: string) => trainees.filter(t => t.status === s).length;
  const filters: FilterChip[] = [
    { value: "TRAINING", label: "훈련중", count: cnt("TRAINING") },
    { value: "EMPLOYED", label: "취업", count: cnt("EMPLOYED") },
    { value: "DROPOUT", label: "중도포기", count: cnt("DROPOUT") },
    { value: "GRADUATED", label: "수료", count: cnt("GRADUATED") },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="훈련생 현황 관리"
        sub="현장(사업체)에서 직무지도를 받는 훈련생의 명단과 훈련 진행 상태를 관리합니다. 목록에서 훈련생을 선택하면 상세 정보를 확인·수정할 수 있습니다."
        actions={<button onClick={() => setCreating(true)} className={T.btnPrimary}>+ 훈련생 등록</button>}
      />

      <StatCardRow
        cols={4}
        items={[
          { label: "전체", value: trainees.length },
          { label: "훈련중", value: cnt("TRAINING"), tone: "sky" },
          { label: "취업", value: cnt("EMPLOYED"), tone: "emerald" },
          { label: "수료·포기", value: cnt("GRADUATED") + cnt("DROPOUT"), tone: "slate" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="이름·현장(사업체)·장애유형 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[920px] border-collapse">
          <thead>
            <tr>{["이름", "현장(사업체)", "성별", "생년월일", "연락처", "보호자 연락처", "장애유형", "장애정도", "상태"].map(h => (
              <th key={h} className={T.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className={T.tdCenter}>{trainees.length === 0 ? "훈련생이 없습니다." : "조건에 맞는 훈련생이 없습니다."}</td></tr>
            ) : pageItems.map(t => (
              <tr key={t.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetail(t)}>
                <td className={`${T.td} whitespace-nowrap`}><span className="font-semibold text-sky-600">{t.name}</span></td>
                <td className={T.td}><div className="max-w-[160px] truncate">{t.siteName}</div></td>
                <td className={`${T.td} whitespace-nowrap`}>{t.gender === "M" ? "남" : "여"}</td>
                <td className={`${T.td} whitespace-nowrap`}>{t.birthDate || "-"}</td>
                <td className={`${T.td} whitespace-nowrap`}>{t.phoneNumber || "-"}</td>
                <td className={`${T.td} whitespace-nowrap`}>{t.guardianPhoneNumber || "-"}</td>
                <td className={T.td}><div className="max-w-[120px] truncate">{t.disabilityType}</div></td>
                <td className={`${T.td} whitespace-nowrap`}>{t.severity}</td>
                <td className={`${T.td} whitespace-nowrap`}><StatusBadge status={t.status} map={STATUS_BADGE} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />

      {(detail || creating) && (
        <TraineeDetailModal
          trainee={creating ? null : detail}
          sites={sites}
          onClose={() => { setDetail(null); setCreating(false); }}
          onSaved={() => { setDetail(null); setCreating(false); load(); }}
        />
      )}
    </div>
  );
}
