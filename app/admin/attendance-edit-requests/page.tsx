"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
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
const PAGE_SIZE = 8;

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
  const [actionId, setActionId]   = useState<string | null>(null);
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
      setActionId(null);
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

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm font-semibold text-slate-400">조건에 맞는 요청이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pageItems.map(req => (
            <div key={req.id}
              className={`rounded-2xl border bg-white p-5 ${
                req.status === "PENDING"  ? "border-amber-200" :
                req.status === "APPROVED" ? "border-emerald-100" : "border-rose-100"
              }`}>
              {/* 헤더 */}
              <div className="mb-3 flex items-center gap-2 text-[15px] font-medium text-slate-800">
                <span className="shrink-0">{req.workerName} ({req.userPhone})</span>
                <StatusBadge status={req.status} map={EDITREQ_BADGE} />
                <span className="truncate">
                  {req.siteName} · {req.workDate} ({dowLabel(req.workDate)})
                  {req.isFinalClosed && <span className="ml-1 font-semibold text-emerald-600">[확정됨]</span>}
                </span>
                <span className="ml-auto shrink-0 text-[13px] text-slate-500">
                  {new Date(req.createdAt).toLocaleDateString("ko-KR")} 요청
                </span>
              </div>

              {/* 현재 vs 요청 시간 */}
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">현재 기록</p>
                  <p className="text-sm font-semibold text-slate-700">
                    {req.currentStart || "미기록"} ~ {req.currentEnd || "미기록"}
                  </p>
                  {req.isGpsModified && (
                    <div className="mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      <span className="text-[10px] text-amber-600">GPS 수동 조정됨</span>
                    </div>
                  )}
                </div>
                <div className={`rounded-xl p-3 ${req.proposedStart || req.proposedEnd ? "bg-sky-50" : "bg-slate-50"}`}>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">수정 요청</p>
                  <p className="text-sm font-semibold text-sky-700">
                    {req.proposedStart || "변경 없음"} ~ {req.proposedEnd || "변경 없음"}
                  </p>
                </div>
              </div>

              {/* 수정 사유 */}
              <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">수정 사유</p>
                <p className="text-sm font-semibold text-slate-700">{req.reason}</p>
              </div>

              {/* 관리자 메모 (처리된 경우) */}
              {req.adminNote && (
                <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">관리자 메모</p>
                  <p className="text-sm font-semibold text-slate-700">{req.adminNote}</p>
                </div>
              )}

              {/* 처리 버튼 (PENDING만) */}
              {req.status === "PENDING" && (
                actionId === req.id ? (
                  <div className="space-y-3">
                    <textarea
                      value={adminNote}
                      onChange={e => setAdminNote(e.target.value)}
                      placeholder="승인/반려 메모 (선택사항)"
                      rows={2}
                      className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700 outline-none focus:border-sky-400"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setActionId(null); setAdminNote(""); }}
                        className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">
                        취소
                      </button>
                      <button onClick={() => handleAction(req.id, "reject")} disabled={processing}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-black text-rose-600 active:scale-95 disabled:opacity-60">
                        <XCircle className="h-4 w-4" />반려
                      </button>
                      <button onClick={() => handleAction(req.id, "approve")} disabled={processing}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">
                        <CheckCircle2 className="h-4 w-4" />승인
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setActionId(req.id); setAdminNote(""); }}
                    className="w-full rounded-xl bg-slate-950 py-3 text-sm font-black text-white active:scale-[0.98]">
                    검토 및 처리
                  </button>
                )
              )}

              {/* 처리 결과 */}
              {req.status !== "PENDING" && req.reviewedAt && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  {req.status === "APPROVED"
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    : <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                  {new Date(req.reviewedAt).toLocaleDateString("ko-KR")} 처리됨
                </div>
              )}
            </div>
          ))}
          <Pagination className="mt-4" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
