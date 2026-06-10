"use client";

import { useEffect, useMemo, useState } from "react";
import { Megaphone, Plus, X, RefreshCw } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Announcement = {
  id: string; title: string; body: string; type: string;
  sentCount: number; adminLogin: string | null; createdAt: string;
};

const SYS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  INFO: { label: "일반", tone: "sky" },
  MAINTENANCE: { label: "점검", tone: "amber" },
  URGENT: { label: "긴급", tone: "rose" },
};
const PAGE_SIZE = 12;

export default function AnnouncementsPage() {
  const [list, setList]       = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", type: "INFO" });
  const [sending, setSending] = useState(false);
  const [toast, setToast]     = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  function load() {
    setLoading(true);
    fetch("/api/admin/system/announcements")
      .then(r => r.json())
      .then(d => { if (d.success) setList(d.announcements); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    total: list.length,
    urgent: list.filter(a => a.type === "URGENT").length,
    sent: list.reduce((s, a) => s + (a.sentCount || 0), 0),
  }), [list]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter(a => typeFilter.length === 0 || typeFilter.includes(a.type))
      .filter(a => !q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q));
  }, [list, query, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, typeFilter]);

  const filters: FilterChip[] = [
    { value: "INFO", label: "일반", count: list.filter(a => a.type === "INFO").length },
    { value: "MAINTENANCE", label: "점검", count: list.filter(a => a.type === "MAINTENANCE").length },
    { value: "URGENT", label: "긴급", count: list.filter(a => a.type === "URGENT").length },
  ];
  const toggleType = (v: string) => setTypeFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  async function send() {
    if (!form.title.trim() || !form.body.trim()) { showToast("제목과 내용을 입력해주세요."); return; }
    setSending(true);
    const res  = await fetch("/api/admin/system/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      showToast(`발송 완료 — ${data.sentCount}명에게 알림이 전달됐습니다.`);
      setShowForm(false);
      setForm({ title: "", body: "", type: "INFO" });
      load();
    } else {
      showToast(data.message ?? "발송 실패");
    }
  }

  return (
    <div>
      <PageHeader
        title="시스템 공지"
        sub="전체 직무지도원에게 공지를 발송합니다"
        actions={
          <>
            <button onClick={load} className={T.btnSecondary + " flex items-center gap-1.5"}>
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={() => setShowForm(true)} className={T.btnPrimary + " flex items-center gap-2"}>
              <Plus className="h-4 w-4" />공지 발송
            </button>
          </>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 공지", value: counts.total },
          { label: "긴급", value: counts.urgent, tone: "rose" },
          { label: "누적 발송", value: counts.sent, tone: "sky" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="제목·내용 검색"
          filters={filters}
          selected={typeFilter}
          onToggleFilter={toggleType}
        />
      </div>

      {/* 공지 작성 모달 */}
      {showForm && (
        <div className={T.modalOverlay}>
          <div className={T.modalContent}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-slate-700" />
                <p className="text-base font-black text-slate-900">공지 발송</p>
              </div>
              <button onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={T.label}>공지 유형</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={T.select + " w-full"}>
                  <option value="INFO">일반 공지</option>
                  <option value="MAINTENANCE">점검 공지</option>
                  <option value="URGENT">긴급 공지</option>
                </select>
              </div>
              <div>
                <label className={T.label}>제목</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="공지 제목" className={T.input + " w-full"} />
              </div>
              <div>
                <label className={T.label}>내용</label>
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="공지 내용을 입력하세요..."
                  rows={5}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 resize-none" />
              </div>
              <p className="text-xs text-slate-400">활성 에이전시에 배정된 모든 직무지도원의 알림함에 전달됩니다.</p>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setShowForm(false)} className={T.btnSecondary + " flex-1"}>취소</button>
              <button onClick={send} disabled={sending} className={T.btnPrimary + " flex-1"}>
                {sending ? "발송 중..." : "전체 발송"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">{list.length === 0 ? "발송된 공지가 없습니다." : "조건에 맞는 공지가 없습니다."}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {pageItems.map(a => (
            <div key={a.id} className="rounded-xl border border-slate-100 bg-white">
              <button
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="flex-shrink-0"><StatusBadge status={a.type} map={SYS_BADGE} /></span>
                <span className="flex-1 text-sm font-semibold text-slate-800 truncate">{a.title}</span>
                <span className="flex-shrink-0 text-xs text-slate-400">{a.sentCount}명 발송</span>
                <span className="flex-shrink-0 text-xs text-slate-400 ml-3">
                  {new Date(a.createdAt).toLocaleString("ko-KR")}
                </span>
              </button>
              {expanded === a.id && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{a.body}</p>
                  {a.adminLogin && (
                    <p className="mt-2 text-xs text-slate-400">발송자: {a.adminLogin}</p>
                  )}
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
