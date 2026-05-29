"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, ChevronDown, Clock, CheckCircle2, X, Send } from "lucide-react";
import { T } from "../_styles";

type Ticket = {
  id: string; agencyId: string; agencyName: string | null;
  adminLogin: string | null; category: string; title: string; body: string;
  status: "OPEN" | "REPLIED" | "CLOSED";
  reply: string | null; replierLogin: string | null;
  repliedAt: string | null; createdAt: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: "일반 문의", DATA_FIX: "데이터 수정 요청", BILLING: "결제·구독", OTHER: "기타",
};
const CATEGORY_COLORS: Record<string, string> = {
  GENERAL:  "bg-sky-100 text-sky-700",
  DATA_FIX: "bg-violet-100 text-violet-700",
  BILLING:  "bg-emerald-100 text-emerald-700",
  OTHER:    "bg-slate-100 text-slate-600",
};
const STATUS_INFO: Record<string, { label: string; color: string }> = {
  OPEN:    { label: "답변 대기", color: "bg-amber-100 text-amber-700" },
  REPLIED: { label: "답변 완료", color: "bg-emerald-100 text-emerald-700" },
  CLOSED:  { label: "종료",     color: "bg-slate-100 text-slate-500" },
};

export default function AdminSupportPage() {
  const [tickets, setTickets]   = useState<Ticket[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<"" | "OPEN" | "REPLIED" | "CLOSED">("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [replyId, setReplyId]   = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending]   = useState(false);
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const load = useCallback((status = filter) => {
    setLoading(true);
    const p = status ? `?status=${status}` : "";
    fetch(`/api/admin/support${p}`)
      .then(r => r.json())
      .then(d => { if (d.success) setTickets(d.tickets); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>지원 요청</h1>
          <p className={T.pageSub}>에이전시 관리자가 보낸 문의·수정 요청 목록</p>
        </div>
        <button onClick={() => load()} className={T.btnSecondary + " flex items-center gap-1.5"}>
          <RefreshCw className="h-4 w-4" />새로고침
        </button>
      </div>

      {/* 요약 */}
      <div className={T.summaryGrid}>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{tickets.length}</p>
          <p className={T.summaryLabel}>전체</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-amber-600"}>{open}</p>
          <p className={T.summaryLabel}>답변 대기</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-emerald-600"}>{replied}</p>
          <p className={T.summaryLabel}>답변 완료</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-400"}>{closed}</p>
          <p className={T.summaryLabel}>종료</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="mb-4 flex gap-2">
        {(["", "OPEN", "REPLIED", "CLOSED"] as const).map(s => (
          <button key={s} onClick={() => { setFilter(s); load(s); }}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition active:scale-95 ${
              filter === s
                ? "bg-slate-950 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}>
            {s === "" ? "전체" : STATUS_INFO[s].label}
            {s === "OPEN" && open > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                {open}
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
      ) : tickets.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">
            {filter ? `${STATUS_INFO[filter].label} 문의가 없습니다.` : "접수된 문의가 없습니다."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => {
            const si = STATUS_INFO[t.status];
            const isExpanded = expanded === t.id;
            const isReplying = replyId === t.id;
            return (
              <div key={t.id} className="rounded-2xl border border-slate-100 bg-white">
                <button
                  onClick={() => setExpanded(isExpanded ? null : t.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                >
                  <span className={`${T.badge} ${CATEGORY_COLORS[t.category] ?? "bg-slate-100 text-slate-600"} flex-shrink-0`}>
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{t.title}</p>
                    <p className="text-[11px] text-slate-400">
                      {t.agencyName ?? "알 수 없음"}{t.adminLogin ? ` · ${t.adminLogin}` : ""}
                    </p>
                  </div>
                  <span className={`${T.badge} ${si.color} flex-shrink-0`}>{si.label}</span>
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
