"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ExternalLink, XCircle } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const REQ_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "검토 중", tone: "amber" },
  APPROVED: { label: "승인됨", tone: "emerald" },
  REJECTED: { label: "반려됨", tone: "rose" },
};
const PAGE_SIZE = 10;

type Request = {
  id: string;
  agencyName: string;
  businessNumber: string;
  businessNumberType: string;
  loginId: string;
  displayName: string | null;
  phoneNumber: string | null;
  documentUrl: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  ntsVerified: boolean;
  ntsBusinessName: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  agencyId: string | null;
  managerId: string | null;
  createdAt: string;
};

export default function ManagerSignupRequestsPage() {
  const [items, setItems]       = useState<Request[]>([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]         = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [note, setNote]         = useState("");
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/system/manager-signup-requests?pageSize=200`)
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.items ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(r => statusFilter.length === 0 || statusFilter.includes(r.status))
      .filter(r => !q || r.agencyName.toLowerCase().includes(q) || (r.businessNumber ?? "").includes(q) || (r.loginId ?? "").toLowerCase().includes(q));
  }, [items, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  async function doAction(id: string, action: "approve" | "reject") {
    setProcessing(true);
    const res = await fetch(`/api/admin/system/manager-signup-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reviewNote: note.trim() || null }),
    });
    const data = await res.json();
    setProcessing(false);
    if (data.success) {
      showToast(action === "approve" ? "승인 완료 — Manager 계정 생성됨" : "반려 완료");
      setActionId(null);
      setNote("");
      load();
    } else {
      showToast(data.message ?? "처리 실패");
    }
  }

  const pending  = items.filter(r => r.status === "PENDING").length;
  const approved = items.filter(r => r.status === "APPROVED").length;
  const rejected = items.filter(r => r.status === "REJECTED").length;

  const filters: FilterChip[] = [
    { value: "PENDING", label: "검토 중", count: pending },
    { value: "APPROVED", label: "승인됨", count: approved },
    { value: "REJECTED", label: "반려됨", count: rejected },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div>
      <PageHeader title="관리자 가입 신청" sub="에이전시 관리자 자체 가입 신청 목록 · 승인 또는 반려" />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체", value: items.length },
          { label: "검토 중", value: pending, tone: "amber" },
          { label: "승인됨", value: approved, tone: "emerald" },
          { label: "반려됨", value: rejected, tone: "rose" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="기관명·사업자번호·아이디 검색"
          filters={filters}
          selected={statusFilter}
          onToggleFilter={toggleStatus}
        />
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">{items.length === 0 ? "가입 신청이 없습니다." : "조건에 맞는 신청이 없습니다."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pageItems.map(req => {
            const isExpanded = expanded === req.id;
            const isActing   = actionId === req.id;
            return (
              <div key={req.id} className="rounded-2xl border border-slate-100 bg-white">
                {/* 행 헤더 */}
                <button onClick={() => setExpanded(isExpanded ? null : req.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-semibold text-slate-800">{req.agencyName}</span>
                      <StatusBadge status={req.status} map={REQ_BADGE} />
                      {req.ntsVerified && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[13px] font-black text-emerald-600">
                          국세청 검증 ✓
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-slate-500">
                      {req.businessNumberType === "BUSINESS" ? "사업자번호" : "고유번호"} {req.businessNumber}
                      &nbsp;·&nbsp;아이디 {req.loginId}
                      {req.displayName && ` · ${req.displayName}`}
                      &nbsp;·&nbsp;{new Date(req.createdAt).toLocaleDateString("ko-KR")}
                    </p>
                  </div>
                  <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition ${isExpanded ? "rotate-180" : ""}`} />
                </button>

                {/* 상세 패널 */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
                    {/* 신청 정보 */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">기관명</p>
                        <p className="font-semibold text-slate-800">{req.agencyName}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">
                          {req.businessNumberType === "BUSINESS" ? "사업자등록번호" : "고유번호"}
                        </p>
                        <p className="font-semibold text-slate-800">
                          {req.businessNumber}
                          {req.ntsVerified
                            ? <span className="ml-2 text-emerald-600 text-xs font-black">✓ 국세청 검증됨</span>
                            : <span className="ml-2 text-slate-400 text-xs">(미검증)</span>}
                        </p>
                      </div>
                      {req.ntsBusinessName && (
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">국세청 상호명</p>
                          <p className="font-semibold text-slate-800">{req.ntsBusinessName}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">아이디</p>
                        <p className="font-semibold text-slate-800">{req.loginId}</p>
                      </div>
                      {req.displayName && (
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">담당자명</p>
                          <p className="font-semibold text-slate-800">{req.displayName}</p>
                        </div>
                      )}
                      {req.phoneNumber && (
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">전화번호</p>
                          <p className="font-semibold text-slate-800">{req.phoneNumber}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">신청일</p>
                        <p className="font-semibold text-slate-800">
                          {new Date(req.createdAt).toLocaleString("ko-KR")}
                        </p>
                      </div>
                      {req.reviewedAt && (
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">처리일</p>
                          <p className="font-semibold text-slate-800">
                            {new Date(req.reviewedAt).toLocaleString("ko-KR")}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* 서류 */}
                    {req.documentUrl && (
                      <div>
                        <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">첨부 서류</p>
                        <a href={req.documentUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-white transition">
                          서류 보기 <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                        </a>
                      </div>
                    )}

                    {/* 기존 검토 노트 */}
                    {req.reviewNote && req.status !== "PENDING" && (
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                        <p className="mb-0.5 text-[11px] font-black uppercase tracking-wide text-slate-400">검토 메모</p>
                        <p className="text-sm text-slate-700">{req.reviewNote}</p>
                      </div>
                    )}

                    {/* 승인/반려 액션 (PENDING만) */}
                    {req.status === "PENDING" && (
                      isActing ? (
                        <div className="space-y-2">
                          <input value={note} onChange={e => setNote(e.target.value)}
                            placeholder="검토 메모 (선택 — 반려 사유 등)" maxLength={200}
                            className={T.input + " w-full"} />
                          <div className="flex gap-2">
                            <button onClick={() => { setActionId(null); setNote(""); }}
                              className={T.btnSecondary}>취소</button>
                            <button onClick={() => doAction(req.id, "reject")} disabled={processing}
                              className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-black text-rose-600 transition hover:bg-rose-50 active:scale-95 disabled:opacity-60">
                              <XCircle className="h-4 w-4" />
                              {processing ? "처리 중..." : "반려"}
                            </button>
                            <button onClick={() => doAction(req.id, "approve")} disabled={processing}
                              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white transition hover:bg-emerald-700 active:scale-95 disabled:opacity-60">
                              <CheckCircle2 className="h-4 w-4" />
                              {processing ? "처리 중..." : "승인"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setActionId(req.id); setNote(""); }}
                          className={T.btnPrimary}>
                          검토하기
                        </button>
                      )
                    )}

                    {/* 승인 완료 시 링크 */}
                    {req.status === "APPROVED" && req.agencyId && (
                      <a href={`/admin/agencies/${req.agencyId}`}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-600 hover:underline">
                        에이전시 상세 보기 <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
