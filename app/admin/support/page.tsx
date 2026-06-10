"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { ChevronDown, Send } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Ticket = {
  id: string; agencyId: string; agencyName: string | null;
  adminLogin: string | null; category: string; title: string; body: string;
  status: "OPEN" | "REPLIED" | "CLOSED";
  reply: string | null; replierLogin: string | null;
  repliedAt: string | null; createdAt: string;
};

const CAT_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  GENERAL: { label: "일반 문의", tone: "sky" },
  DATA_FIX: { label: "데이터 수정", tone: "violet" },
  BILLING: { label: "결제·구독", tone: "emerald" },
  OTHER: { label: "기타", tone: "slate" },
};
const SUP_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "답변 대기", tone: "amber" },
  REPLIED: { label: "답변 완료", tone: "emerald" },
  CLOSED: { label: "종료", tone: "slate" },
};
const PAGE_SIZE = 12;

export default function AdminSupportPage() {
  const [tickets, setTickets]   = useState<Ticket[]>([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]         = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [replyId, setReplyId]   = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending]   = useState(false);
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/support`)
      .then(r => r.json())
      .then(d => { if (d.success) setTickets(d.tickets); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets
      .filter(t => statusFilter.length === 0 || statusFilter.includes(t.status))
      .filter(t => !q || t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || (t.agencyName ?? "").toLowerCase().includes(q));
  }, [tickets, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  function openReply(id: string, existingReply: string | null) {
    setReplyId(id);
    setReplyText(existingReply ?? "");
  }

  async function sendReply(id: string) {
    if (!replyText.trim()) { showToast("회신 내용을 입력해주세요."); return; }
    setSending(true);
    const res  = await fetch(`/api/admin/support/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: replyText }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      showToast("회신이 완료되었습니다.");
      setReplyId(null);
      setReplyText("");
      load();
    } else {
      showToast(data.message ?? "실패");
    }
  }

  const open    = tickets.filter(t => t.status === "OPEN").length;
  const replied = tickets.filter(t => t.status === "REPLIED").length;
  const closed  = tickets.filter(t => t.status === "CLOSED").length;

  const filters: FilterChip[] = [
    { value: "OPEN", label: "답변 대기", count: open },
    { value: "REPLIED", label: "답변 완료", count: replied },
    { value: "CLOSED", label: "종료", count: closed },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div>
      <PageHeader title="지원 요청" sub="에이전시 관리자가 보낸 문의·수정 요청 목록" />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체", value: tickets.length },
          { label: "답변 대기", value: open, tone: "amber" },
          { label: "답변 완료", value: replied, tone: "emerald" },
          { label: "종료", value: closed, tone: "slate" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="제목·내용·에이전시 검색"
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
          <p className="text-sm text-slate-400">{tickets.length === 0 ? "접수된 문의가 없습니다." : "조건에 맞는 문의가 없습니다."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pageItems.map(t => {
            const isExpanded = expanded === t.id;
            const isReplying = replyId === t.id;
            return (
              <div key={t.id} className="rounded-2xl border border-slate-100 bg-white">
                <button
                  onClick={() => setExpanded(isExpanded ? null : t.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                >
                  <span className="flex-shrink-0"><StatusBadge status={t.category} map={CAT_BADGE} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{t.title}</p>
                    <p className="text-[11px] text-slate-400">
                      {t.agencyName ?? "알 수 없음"}{t.adminLogin ? ` · ${t.adminLogin}` : ""}
                    </p>
                  </div>
                  <span className="flex-shrink-0"><StatusBadge status={t.status} map={SUP_STATUS} /></span>
                  <span className="flex-shrink-0 text-xs text-slate-400 ml-1">
                    {new Date(t.createdAt).toLocaleDateString("ko-KR")}
                  </span>
                  <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition ${isExpanded ? "rotate-180" : ""}`} />
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
                    {/* 문의 내용 */}
                    <div>
                      <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">문의 내용</p>
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{t.body}</p>
                    </div>

                    {/* 기존 회신 */}
                    {t.reply && !isReplying && (
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                        <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
                          회신 ({t.replierLogin ?? "운영자"}{t.repliedAt ? ` · ${new Date(t.repliedAt).toLocaleDateString("ko-KR")}` : ""})
                        </p>
                        <p className="whitespace-pre-wrap text-sm text-slate-700">{t.reply}</p>
                      </div>
                    )}

                    {/* 회신 폼 */}
                    {isReplying ? (
                      <div className="space-y-2">
                        <textarea
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          placeholder="회신 내용을 입력하세요..."
                          rows={4}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 resize-none"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button onClick={() => { setReplyId(null); setReplyText(""); }}
                            className={T.btnSecondary}>취소</button>
                          <button onClick={() => sendReply(t.id)} disabled={sending}
                            className={T.btnPrimary + " flex items-center gap-1.5"}>
                            <Send className="h-3.5 w-3.5" />
                            {sending ? "전송 중..." : "회신 전송"}
                          </button>
                        </div>
                      </div>
                    ) : t.status !== "CLOSED" && (
                      <button onClick={() => openReply(t.id, t.reply)}
                        className={T.btnPrimary + " flex items-center gap-1.5 text-sm"}>
                        <Send className="h-3.5 w-3.5" />
                        {t.reply ? "회신 수정" : "회신 작성"}
                      </button>
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
