"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { T } from "../_styles";

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

type Filter = "" | "PENDING" | "APPROVED" | "REJECTED";

const STATUS_INFO: Record<string, { label: string; badge: string }> = {
  PENDING:  { label: "검토 중",  badge: "bg-amber-100 text-amber-700" },
  APPROVED: { label: "승인됨",   badge: "bg-emerald-100 text-emerald-700" },
  REJECTED: { label: "반려됨",   badge: "bg-rose-100 text-rose-700" },
};

export default function ManagerSignupRequestsPage() {
  const [items, setItems]       = useState<Request[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<Filter>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [note, setNote]         = useState("");
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const load = useCallback((s = filter) => {
    setLoading(true);
    const q = s ? `?status=${s}&pageSize=100` : "?pageSize=100";
    fetch(`/api/admin/system/manager-signup-requests${q}`)
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.items ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>관리자 가입 신청</h1>
          <p className={T.pageSub}>에이전시 관리자 자체 가입 신청 목록 · 승인 또는 반려</p>
        </div>
        <button onClick={() => load()} className={T.btnSecondary + " flex items-center gap-1.5"}>
          <RefreshCw className="h-4 w-4" />새로고침
        </button>
      </div>

      {/* 요약 */}
      <div className={T.summaryGrid}>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{items.length}</p>
          <p className={T.summaryLabel}>전체</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-amber-600"}>{pending}</p>
          <p className={T.summaryLabel}>검토 중</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-emerald-600"}>{approved}</p>
          <p className={T.summaryLabel}>승인됨</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-rose-500"}>{rejected}</p>
          <p className={T.summaryLabel}>반려됨</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="mb-4 flex gap-2">
        {(["", "PENDING", "APPROVED", "REJECTED"] as Filter[]).map(s => (
          <button key={s} onClick={() => { setFilter(s); load(s); }}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition active:scale-95 ${
              filter === s
                ? "bg-slate-950 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}>
            {s === "" ? "전체" : STATUS_INFO[s].label}
            {s === "PENDING" && pending > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">
            {filter ? `${STATUS_INFO[filter].label} 신청이 없습니다.` : "가입 신청이 없습니다."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(req => {
            const si = STATUS_INFO[req.status];
            const isExpanded = expanded === req.id;
            const isActing   = actionId === req.id;
            return (
              <div key={req.id} className="rounded-2xl border border-slate-100 bg-white">
                {/* 행 헤더 */}
                <button onClick={() => setExpanded(isExpanded ? null : req.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-sm text-slate-900">{req.agencyName}</span>
                      <span className={`${T.badge} ${si.badge}`}>{si.label}</span>
                      {req.ntsVerified && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-600">
                          국세청 검증 ✓
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
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
