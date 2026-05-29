"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, X, ChevronDown, RefreshCw, CheckCircle2, Clock, MessageCircle } from "lucide-react";
import { T } from "../_styles";

type Ticket = {
  id: string; category: string; title: string; body: string;
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
const STATUS_INFO: Record<string, { label: string; color: string; icon: any }> = {
  OPEN:    { label: "답변 대기",  color: "bg-amber-100 text-amber-700",   icon: Clock },
  REPLIED: { label: "답변 완료",  color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  CLOSED:  { label: "종료",       color: "bg-slate-100 text-slate-500",   icon: CheckCircle2 },
};

export default function ManagerSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<"" | "OPEN" | "REPLIED" | "CLOSED">("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", category: "GENERAL" });
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [toast, setToast] = useState("");

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

  async function submit() {
    if (!form.title.trim() || !form.body.trim()) { showToast("제목과 내용을 입력해주세요."); return; }
    setSubmitting(true);
    const res  = await fetch("/api/admin/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSubmitting(false);
    if (data.success) {
      showToast("문의가 접수되었습니다.");
      setShowForm(false);
      setForm({ title: "", body: "", category: "GENERAL" });
      load();
    } else {
      showToast(data.message ?? "접수 실패");
    }
  }

  async function closeTicket(id: string) {
    setClosing(id);
    const res  = await fetch(`/api/admin/support/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close" }),
    });
    const data = await res.json();
    setClosing(null);
    if (data.success) { showToast("문의가 종료되었습니다."); load(); }
    else showToast(data.message ?? "실패");
  }

  const open    = tickets.filter(t => t.status === "OPEN").length;
  const replied = tickets.filter(t => t.status === "REPLIED").length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>운영자 문의</h1>
          <p className={T.pageSub}>데이터 수정 요청, 결제 문의 등을 Ablelink 운영팀에 보냅니다</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} className={T.btnSecondary + " flex items-center gap-1.5"}>
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => setShowForm(true)} className={T.btnPrimary + " flex items-center gap-2"}>
            <Plus className="h-4 w-4" />문의 작성
          </button>
        </div>
      </div>

      {/* 요약 */}
      <div className="mb-5 grid grid-cols-3 gap-3.5">
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{tickets.length}</p>
          <p className={T.summaryLabel}>전체 문의</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-amber-600"}>{open}</p>
          <p className={T.summaryLabel}>답변 대기</p>
        </div>
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-emerald-600"}>{replied}</p>
          <p className={T.summaryLabel}>답변 완료</p>
        </div>
      </div>

      {/* 문의 작성 모달 */}
      {showForm && (
        <div className={T.modalOverlay}>
          <div className={T.modalContent}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-slate-700" />
                <p className="text-base font-black text-slate-900">문의 작성</p>
              </div>
              <button onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={T.label}>문의 유형</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={T.select + " w-full"}>
                  {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={T.label}>제목</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="문의 제목을 입력하세요" className={T.input + " w-full"} />
              </div>
              <div>
                <label className={T.label}>내용</label>
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="문의 내용을 자세히 작성해주세요..."
                  rows={6}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 resize-none" />
              </div>
              <p className="text-xs text-slate-400">접수 후 영업일 기준 1~2일 내 답변 드립니다.</p>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setShowForm(false)} className={T.btnSecondary + " flex-1"}>취소</button>
              <button onClick={submit} disabled={submitting} className={T.btnPrimary + " flex-1"}>
                {submitting ? "접수 중..." : "문의 접수"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          <p className="text-sm text-slate-400">문의 내역이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => {
            const si = STATUS_INFO[t.status];
            const StatusIcon = si.icon;
            return (
              <div key={t.id} className="rounded-2xl border border-slate-100 bg-white">
                <button
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                >
                  <span className={`${T.badge} ${CATEGORY_COLORS[t.category] ?? "bg-slate-100 text-slate-600"} flex-shrink-0`}>
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-slate-900 truncate">{t.title}</span>
                  <span className={`${T.badge} ${si.color} flex-shrink-0 gap-1`}>
                    <StatusIcon className="h-3 w-3" />{si.label}
                  </span>
                  <span className="flex-shrink-0 text-xs text-slate-400 ml-2">
                    {new Date(t.createdAt).toLocaleDateString("ko-KR")}
                  </span>
                  <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition ${expanded === t.id ? "rotate-180" : ""}`} />
                </button>

                {expanded === t.id && (
                  <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                    <div>
                      <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">문의 내용</p>
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{t.body}</p>
                    </div>
                    {t.reply && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                        <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-emerald-600">
                          운영팀 답변 {t.repliedAt ? `· ${new Date(t.repliedAt).toLocaleDateString("ko-KR")}` : ""}
                        </p>
                        <p className="whitespace-pre-wrap text-sm text-slate-800">{t.reply}</p>
                      </div>
                    )}
                    {t.status === "REPLIED" && (
                      <button
                        onClick={() => closeTicket(t.id)}
                        disabled={closing === t.id}
                        className={T.btnSecondary + " text-xs py-1.5"}
                      >
                        {closing === t.id ? "처리 중..." : "문의 종료"}
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
