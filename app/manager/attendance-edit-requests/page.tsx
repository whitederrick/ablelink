"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const EDITREQ_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "대기", tone: "amber" },
  APPROVED: { label: "승인", tone: "emerald" },
  REJECTED: { label: "반려", tone: "rose" },
};
const PAGE_SIZE = 10;

type EditReq = {
  id: string;
  attendanceId: string;
  workerId: string;
  workerName: string;
  userPhone: string;
  workDate: string;
  siteName: string;
  currentStart: string | null;
  currentEnd: string | null;
  isFinalClosed: boolean;
  isGpsModified: boolean;
  reason: string;
  proposedStart: string | null;
  proposedEnd: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dowLabel(dateStr: string) { return DOW[new Date(dateStr + "T00:00:00").getDay()]; }

export default function AttendanceEditRequestsPage() {
  const [requests, setRequests]   = useState<EditReq[]>([]);
  const [loading, setLoading]     = useState(true);
  const [query, setQuery]         = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["PENDING"]);
  const [page, setPage]           = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]         = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/attendance-edit-requests")
      .then(r => r.json())
      .then(d => { if (d.success) setRequests(d.requests); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAction(id: string, action: "approve" | "reject") {
    setProcessing(true);
    const res = await fetch(`/api/admin/attendance-edit-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, adminNote: adminNote.trim() || null }),
    });
    const data = await res.json();
    setProcessing(false);
    if (data.success) {
      showToast(data.message);
      setAdminNote("");
      load();
    } else {
      showToast(data.message || "처리 실패");
    }
  }

  const counts = useMemo(() => ({
    total: requests.length,
    pending: requests.filter(r => r.status === "PENDING").length,
    approved: requests.filter(r => r.status === "APPROVED").length,
    rejected: requests.filter(r => r.status === "REJECTED").length,
  }), [requests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests
      .filter(r => statusFilter.length === 0 || statusFilter.includes(r.status))
      .filter(r => !q || r.workerName.toLowerCase().includes(q) || (r.siteName ?? "").toLowerCase().includes(q) || (r.reason ?? "").toLowerCase().includes(q));
  }, [requests, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const selected = requests.find(r => r.id === selectedId) ?? null;

  const filters: FilterChip[] = [
    { value: "PENDING", label: "대기", count: counts.pending },
    { value: "APPROVED", label: "승인", count: counts.approved },
    { value: "REJECTED", label: "반려", count: counts.rejected },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div>
      <PageHeader
        title="출근부 수정 요청 관리"
        sub="직무지도원이 제출한 출근 기록 수정 요청을 검토하고 승인 또는 반려합니다."
      />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체", value: counts.total },
          { label: "승인 대기", value: counts.pending, tone: "amber" },
          { label: "승인", value: counts.approved, tone: "emerald" },
          { label: "반려", value: counts.rejected, tone: "rose" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="직무지도원·현장·사유 검색"
          filters={filters}
          selected={statusFilter}
          onToggleFilter={toggleStatus}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 좌: 목록 */}
        <div>
          {loading ? (
            <p className={T.empty}>불러오는 중…</p>
          ) : pageItems.length === 0 ? (
            <p className={T.empty}>{requests.length === 0 ? "접수된 요청이 없습니다." : "조건에 맞는 요청이 없습니다."}</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {/* 제목줄 */}
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-400">
                <span className="w-14 shrink-0">상태</span>
                <span className="w-16 shrink-0">직무지도원</span>
                <span className="flex-1">현장 · 근무일</span>
                <span className="w-[56px] shrink-0 text-right">요청일</span>
              </div>
              {/* 행 */}
              <div className="divide-y divide-slate-100">
                {pageItems.map(req => (
                  <button
                    key={req.id}
                    onClick={() => { setSelectedId(req.id); setAdminNote(""); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-50 ${selectedId === req.id ? "bg-slate-100" : ""}`}
                  >
                    <span className="w-14 shrink-0"><StatusBadge status={req.status} map={EDITREQ_BADGE} /></span>
                    <span className="w-16 shrink-0 truncate text-[15px] font-black text-slate-900">{req.workerName}</span>
                    <span className="flex-1 truncate text-[13px] font-semibold text-slate-500">{req.siteName} · {req.workDate.slice(5)}({dowLabel(req.workDate)})</span>
                    <span className="w-[56px] shrink-0 text-right text-xs font-semibold text-slate-400">{req.createdAt.slice(2, 10)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {filtered.length > 0 && (
            <Pagination className="mt-4" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
          )}
        </div>

        {/* 우: 상세 + 검토 처리 */}
        <div className="lg:sticky lg:top-4 h-fit">
          {selected ? (
            <div className={`${T.card} space-y-4`}>
              {/* 헤더 */}
              <div className="flex items-center gap-2">
                <StatusBadge status={selected.status} map={EDITREQ_BADGE} />
                <span className="text-[15px] font-black text-slate-900">{selected.workerName}</span>
                <span className="text-[13px] font-semibold text-slate-400">{selected.userPhone}</span>
                <span className="ml-auto text-[11px] font-semibold text-slate-300">{new Date(selected.createdAt).toLocaleDateString("ko-KR")} 요청</span>
              </div>
              <p className="-mt-2 text-[13px] font-semibold text-slate-500">
                {selected.siteName} · {selected.workDate} ({dowLabel(selected.workDate)})
                {selected.isFinalClosed && <span className="ml-1 font-bold text-emerald-600">[확정됨]</span>}
              </p>

              {/* 현재 vs 요청 시간 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">현재 기록</p>
                  <p className="text-sm font-semibold text-slate-700">{selected.currentStart || "미기록"} ~ {selected.currentEnd || "미기록"}</p>
                  {selected.isGpsModified && (
                    <div className="mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /><span className="text-[10px] text-amber-600">GPS 수동 조정됨</span></div>
                  )}
                </div>
                <div className={`rounded-xl p-3 ${selected.proposedStart || selected.proposedEnd ? "bg-sky-50" : "bg-slate-50"}`}>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">수정 요청</p>
                  <p className="text-sm font-semibold text-sky-700">{selected.proposedStart || "변경 없음"} ~ {selected.proposedEnd || "변경 없음"}</p>
                </div>
              </div>

              {/* 수정 사유 */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">수정 사유</p>
                <p className="text-sm font-semibold text-slate-700">{selected.reason}</p>
              </div>

              {/* 관리자 메모(처리된 경우) */}
              {selected.adminNote && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">관리자 메모</p>
                  <p className="text-sm font-semibold text-slate-700">{selected.adminNote}</p>
                </div>
              )}

              {/* 검토·처리 (PENDING만) */}
              {selected.status === "PENDING" ? (
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)}
                    placeholder="승인/반려 메모 (선택사항)" rows={2}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700 outline-none focus:border-sky-400" />
                  <div className="flex gap-2">
                    <button onClick={() => handleAction(selected.id, "reject")} disabled={processing}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-black text-rose-600 active:scale-95 disabled:opacity-60">
                      <XCircle className="h-4 w-4" />반려
                    </button>
                    <button onClick={() => handleAction(selected.id, "approve")} disabled={processing}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">
                      <CheckCircle2 className="h-4 w-4" />승인
                    </button>
                  </div>
                </div>
              ) : selected.reviewedAt && (
                <div className="flex items-center gap-1.5 border-t border-slate-100 pt-3 text-[12px] font-semibold text-slate-400">
                  {selected.status === "APPROVED" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                  {new Date(selected.reviewedAt).toLocaleDateString("ko-KR")} 처리됨
                </div>
              )}
            </div>
          ) : (
            <div className={`${T.card} text-center`}>
              <p className="py-6 text-sm font-semibold text-slate-300">목록에서 요청을 선택하면<br />상세 내용과 검토·처리가 표시됩니다.</p>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
