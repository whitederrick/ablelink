"use client";

import { useEffect, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { workerLabel } from "../_format";
import SurveyRequestModal from "./SurveyRequestModal";

type Status = "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";
interface SurveyItem {
  id: string; workerName: string; workerLoginId: string; recipientName: string | null; recipientPhone: string;
  siteName: string | null; status: Status; auto: boolean; sharedWithAgency: boolean;
  overallScore: number | null; comment: string | null; totalScore: number | null;
  sentAt: string | null; respondedAt: string | null; createdAt: string;
}

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING:   { label: "응답 대기", tone: "amber" },
  RESPONDED: { label: "응답 완료", tone: "emerald" },
  EXPIRED:   { label: "만료",      tone: "slate" },
  CANCELLED: { label: "취소",      tone: "slate" },
};
const PAGE_SIZE = 10;

export default function ManagerSurveysPage() {
  const [items, setItems] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReq, setShowReq] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  function load() { fetch("/api/admin/surveys").then(r => r.json()).then(d => { if (d.success) setItems(d.items); }).catch(() => {}).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(s => statusFilter.length === 0 || statusFilter.includes(s.status))
      .filter(s => !q || s.workerName.toLowerCase().includes(q) || (s.siteName ?? "").toLowerCase().includes(q) || (s.recipientName ?? "").toLowerCase().includes(q) || s.recipientPhone.includes(q));
  }, [items, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const pendingCnt   = items.filter(s => s.status === "PENDING").length;
  const respondedCnt = items.filter(s => s.status === "RESPONDED").length;
  const closedCnt    = items.filter(s => s.status === "EXPIRED" || s.status === "CANCELLED").length;
  const filters: FilterChip[] = [
    { value: "PENDING", label: "응답 대기", count: pendingCnt },
    { value: "RESPONDED", label: "응답 완료", count: respondedCnt },
    { value: "EXPIRED", label: "만료", count: items.filter(s => s.status === "EXPIRED").length },
    { value: "CANCELLED", label: "취소", count: items.filter(s => s.status === "CANCELLED").length },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도원 만족도 평가 (Pro+)"
        sub="직무지도 종료가 임박했거나 종료된 직무지도원을 대상으로, 사업체 담당자에게 만족도 평가를 발송합니다. 직무지도원 관리 화면에서도 해당 직무지도원을 선택해 바로 요청할 수 있습니다. 결과는 운영자가 관리하며 공유 시 점수가 표시됩니다."
        actions={<button onClick={() => setShowReq(true)} className={T.btnPrimary}>+ 평가 요청</button>}
      />
      {lastUrl && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex-1"><p className="text-sm font-black text-emerald-700">조사가 생성되었습니다</p><p className="mt-0.5 break-all text-xs font-semibold text-slate-600">{lastUrl}</p></div>
          <button onClick={() => { navigator.clipboard.writeText(lastUrl); alert("복사되었습니다."); }} className="whitespace-nowrap rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">링크 복사</button>
        </div>
      )}

      <StatCardRow
        cols={4}
        items={[
          { label: "전체", value: items.length },
          { label: "응답 대기", value: pendingCnt, tone: "amber" },
          { label: "응답 완료", value: respondedCnt, tone: "emerald" },
          { label: "만료·취소", value: closedCnt, tone: "slate" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="직무지도원·현장(사업체)·담당자 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[920px] border-collapse">
          <thead><tr>{["직무지도원 성명(아이디)", "현장(사업체)", "사업체 담당자 성명", "사업체 담당자 연락처", "상태", "결과", "요청일"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className={T.tdCenter}>로딩 중...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={7} className={T.tdCenter}>{items.length === 0 ? "요청한 조사가 없습니다." : "조건에 맞는 조사가 없습니다."}</td></tr>
            : pageItems.map(s => {
              return (
                <tr key={s.id} className={T.trBase}>
                  <td className={`${T.td} whitespace-nowrap`}>{workerLabel(s.workerName, s.workerLoginId)}</td>
                  <td className={T.td}><div className="max-w-[150px] truncate">{s.siteName || "-"}</div></td>
                  <td className={T.td}><div className="max-w-[110px] truncate">{s.recipientName || "-"}</div></td>
                  <td className={`${T.td} whitespace-nowrap`}>{s.recipientPhone || "-"}</td>
                  <td className={`${T.td} whitespace-nowrap`}><StatusBadge status={s.status} map={STATUS_BADGE} />{s.auto && <span className="ml-1 text-[13px] text-slate-500">자동</span>}</td>
                  <td className={`${T.td} whitespace-nowrap`}>{s.status === "RESPONDED"
                    ? (s.sharedWithAgency && s.totalScore != null
                        ? <span className="font-semibold text-sky-700">종합 {s.totalScore}/100</span>
                        : s.sharedWithAgency && s.overallScore != null
                          ? <span className="font-semibold text-slate-800">종합 {s.overallScore}/5</span>
                          : <span className="text-slate-500">운영자 확인</span>)
                    : "-"}</td>
                  <td className={`${T.td} whitespace-nowrap`}>{s.createdAt.slice(0, 10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      {showReq && <SurveyRequestModal onClose={() => setShowReq(false)} onCreated={(url) => { setLastUrl(url); load(); }} />}
    </div>
  );
}
