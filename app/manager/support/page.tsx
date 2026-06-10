"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, X, ChevronDown, MessageCircle } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Ticket = {
  id: string; category: string; title: string; body: string;
  status: "OPEN" | "REPLIED" | "CLOSED";
  reply: string | null; replierLogin: string | null;
  repliedAt: string | null; createdAt: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: "일반 문의", DATA_FIX: "데이터 수정 요청", BILLING: "결제·구독", OTHER: "기타",
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

export default function ManagerSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]       = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", category: "GENERAL" });
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [toast, setToast] = useState("");

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
      .filter(t => !q || t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q));
  }, [tickets, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

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
  const closed  = tickets.filter(t => t.status === "CLOSED").length;
  const filters: FilterChip[] = [
    { value: "OPEN", label: "답변 대기", count: open },
    { value: "REPLIED", label: "답변 완료", count: replied },
    { value: "CLOSED", label: "종료", count: closed },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div>
      <PageHeader
        title="운영자 문의"
        sub="데이터 수정 요청, 결제 문의 등을 Ablelink 운영팀에 보냅니다"
        actions={
          <button onClick={() => setShowForm(true)} className={T.btnPrimary + " flex items-center gap-2"}>
            <Plus className="h-4 w-4" />문의 작성
          </button>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체 문의", value: tickets.length },
          { label: "답변 대기", value: open, tone: "amber" },
          { label: "답변 완료", value: replied, tone: "emerald" },
          { label: "종료", value: closed, tone: "slate" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="제목·내용 검색"
          filters={filters}
          selected={statusFilter}
          onToggleFilter={toggleStatus}
        />
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

      {/* 목록 */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">{tickets.length === 0 ? "문의 내역이 없습니다." : "조건에 맞는 문의가 없습니다."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pageItems.map(t => {
            return (
              <div key={t.id} className="rounded-2xl border border-slate-100 bg-white">
                <button
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                >
                  <StatusBadge status={t.category} map={CAT_BADGE} />
                  <span className="flex-1 text-sm font-semibold text-slate-900 truncate">{t.title}</span>
                  <StatusBadge status={t.status} map={SUP_STATUS} />
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
