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
  audience?: string;
  sentCount: number; adminLogin: string | null; createdAt: string;
};

const SYS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  INFO: { label: "일반", tone: "sky" },
  MAINTENANCE: { label: "점검", tone: "amber" },
  URGENT: { label: "긴급", tone: "rose" },
};
const AUDIENCE_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  MANAGERS: { label: "관리자", tone: "slate" },
  ALL: { label: "전체(긴급)", tone: "rose" },
};
const PAGE_SIZE = 10;

export default function AnnouncementsPage() {
  const [list, setList]       = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", type: "INFO", audience: "MANAGERS" });
  const [sending, setSending] = useState(false);
  const [toast, setToast]     = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  function load() {
    setLoading(true);
    fetch("/api/admin/system/announcements")
      .then(r => r.json())
      .then(d => { if (d.success) setList(d.announcements); })
      .catch(e => console.error("[admin/announcements] 목록 로드 실패", e))
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

  const selected = list.find(a => a.id === selectedId) ?? null;

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
      showToast(data.audience === "ALL"
        ? `전체 발송 완료 — 직무지도원 ${data.sentCount}명 + 전체 위탁기관 관리자에게 전달됐습니다.`
        : `발송 완료 — 위탁기관 관리자에게 전달됐습니다.`);
      setShowForm(false);
      setForm({ title: "", body: "", type: "INFO", audience: "MANAGERS" });
      load();
    } else {
      showToast(data.message ?? "발송 실패");
    }
  }

  return (
    <div>
      <PageHeader
        title="시스템 공지"
        sub="시스템 공지를 발송합니다. 평상시에는 위탁기관 관리자에게, 긴급 시(점검·중단)에는 전체 사용자에게 전달됩니다."
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
                <label className={T.label}>발송 대상</label>
                <select value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))} className={T.select + " w-full"}>
                  <option value="MANAGERS">위탁기관 관리자 (일반 공지·기본)</option>
                  <option value="ALL">전체 — 관리자 + 모든 직무지도원 (긴급·시스템 점검)</option>
                </select>
                {form.audience === "ALL" ? (
                  <p className="mt-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-600">
                    ⚠️ 긴급 전체 공지 — 시스템 점검·서비스 중단 등 모든 사용자에게 즉시 알려야 할 때만 사용하세요.
                    전체 위탁기관 관리자 + <strong>모든 직무지도원 앱 알림함</strong>까지 전송됩니다.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">
                    각 위탁기관 관리자만 ‘시스템 공지사항’에서 확인합니다. 직무지도원에게는 전달되지 않습니다.
                  </p>
                )}
              </div>
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
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setShowForm(false)} className={T.btnSecondary + " flex-1"}>취소</button>
              <button onClick={send} disabled={sending}
                className={`flex-1 ${form.audience === "ALL" ? "rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-60" : T.btnPrimary}`}>
                {sending ? "발송 중..." : form.audience === "ALL" ? "🚨 전체 긴급 발송" : "관리자에게 발송"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 목록 — 컴팩트 단일라인 행 */}
        <div>
          <div className="space-y-1">
            {loading ? (
              <p className={T.empty}>불러오는 중…</p>
            ) : pageItems.length === 0 ? (
              <p className={T.empty}>{list.length === 0 ? "발송된 공지가 없습니다." : "조건에 맞는 공지가 없습니다."}</p>
            ) : (
              pageItems.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-1.5 text-left transition hover:border-slate-300 ${
                    selectedId === a.id ? "border-slate-950 ring-1 ring-slate-200" : "border-slate-200"
                  }`}
                >
                  <span className="shrink-0"><StatusBadge status={a.type} map={SYS_BADGE} /></span>
                  <span className="shrink-0"><StatusBadge status={a.audience ?? "MANAGERS"} map={AUDIENCE_BADGE} /></span>
                  <span className="flex-1 truncate text-[15px] font-black text-slate-900">{a.title}</span>
                  <span className="shrink-0 text-[13px] font-semibold text-slate-500">{(a.audience ?? "MANAGERS") === "ALL" ? `직무지도원 ${a.sentCount}명` : "관리자 전용"}</span>
                  <span className="shrink-0 w-[72px] text-right text-xs font-semibold text-slate-400">{a.createdAt.slice(2, 10)}</span>
                </button>
              ))
            )}
          </div>
          {filtered.length > 0 && (
            <Pagination className="mt-4" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
          )}
        </div>

        {/* 상세(우측 패널) */}
        <div className="lg:sticky lg:top-4 h-fit">
          {selected ? (
            <div className={T.card}>
              <div className="mb-2 flex items-center gap-1.5">
                <StatusBadge status={selected.type} map={SYS_BADGE} />
                <StatusBadge status={selected.audience ?? "MANAGERS"} map={AUDIENCE_BADGE} />
                <span className="ml-auto text-[11px] font-semibold text-slate-300">{new Date(selected.createdAt).toLocaleString("ko-KR")}</span>
              </div>
              <p className="text-base font-black text-slate-900">{selected.title}</p>
              <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-600">{selected.body}</p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-400">
                <span>{(selected.audience ?? "MANAGERS") === "ALL" ? `직무지도원 ${selected.sentCount}명 + 전체 관리자 전송` : "위탁기관 관리자 전용"}</span>
                {selected.adminLogin && <span>발송자: {selected.adminLogin}</span>}
              </div>
            </div>
          ) : (
            <div className={`${T.card} text-center`}>
              <p className="py-6 text-sm font-semibold text-slate-300">목록에서 공지를 선택하면<br />상세 내용이 표시됩니다.</p>
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
