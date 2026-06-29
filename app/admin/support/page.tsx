"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Send, Paperclip, X } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Attachment = { idx: number; name: string; size: number; mime: string };
type Ticket = {
  id: string; agencyId: string; agencyName: string | null;
  adminLogin: string | null; category: string; title: string; body: string;
  status: "OPEN" | "REPLIED" | "CLOSED";
  reply: string | null; replierLogin: string | null;
  repliedAt: string | null; createdAt: string;
  attachments?: Attachment[];
  replyAttachments?: Attachment[];
};

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;
type PendingAttachment = { path: string; name: string; size: number; mime: string };

const CAT_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  GENERAL: { label: "일반 문의", tone: "sky" },
  SYSTEM: { label: "시스템", tone: "violet" },
  DATA_FIX: { label: "데이터", tone: "rose" },
  BILLING: { label: "결제·구독", tone: "emerald" },
  CONTRACT_TEMPLATE: { label: "계약서 양식", tone: "amber" },
  OTHER: { label: "기타", tone: "slate" },
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
const SUP_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "답변 대기", tone: "amber" },
  REPLIED: { label: "답변 완료", tone: "emerald" },
  CLOSED: { label: "종료", tone: "slate" },
};
const PAGE_SIZE = 10;

export default function AdminSupportPage() {
  const [tickets, setTickets]   = useState<Ticket[]>([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]         = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyId, setReplyId]   = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<PendingAttachment[]>([]);
  const [replyUploading, setReplyUploading] = useState(false);
  const [sending, setSending]   = useState(false);
  const [toast, setToast]       = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/support`, { headers: { "x-admin-context": "1" } })
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

  const selected = tickets.find(t => t.id === selectedId) ?? null;

  function openReply(id: string, existingReply: string | null) {
    setReplyId(id);
    setReplyText(existingReply ?? "");
    setReplyAttachments([]);
  }

  async function onPickReplyFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    if (replyAttachments.length + picked.length > MAX_FILES) { showToast(`첨부는 최대 ${MAX_FILES}개까지 가능합니다.`); return; }
    setReplyUploading(true);
    for (const file of picked) {
      if (file.size > MAX_SIZE) { showToast(`${file.name}: 10MB를 초과합니다.`); continue; }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", file.name);
      try {
        const res = await fetch("/api/admin/support/upload", { method: "POST", body: fd, headers: { "x-admin-context": "1" } });
        const d = await res.json();
        if (d.success) setReplyAttachments(prev => [...prev, d.attachment]);
        else showToast(d.message ?? `${file.name} 업로드 실패`);
      } catch { showToast(`${file.name} 업로드 실패`); }
    }
    setReplyUploading(false);
  }

  async function sendReply(id: string) {
    if (!replyText.trim()) { showToast("회신 내용을 입력해주세요."); return; }
    setSending(true);
    const res  = await fetch(`/api/admin/support/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-context": "1" },
      body: JSON.stringify({ reply: replyText, ...(replyAttachments.length ? { replyAttachments } : {}) }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      showToast("회신이 완료되었습니다.");
      setReplyId(null);
      setReplyText("");
      setReplyAttachments([]);
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
      <PageHeader title="지원 요청" sub="위탁기관 관리자가 보낸 문의·수정 요청을 확인하고 회신합니다." />

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
          placeholder="제목·내용·위탁기관 검색"
          filters={filters}
          selected={statusFilter}
          onToggleFilter={toggleStatus}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 목록 — 컴팩트 단일라인 행 */}
        <div>
          <div className="space-y-1">
            {loading ? (
              <p className={T.empty}>불러오는 중…</p>
            ) : pageItems.length === 0 ? (
              <p className={T.empty}>{tickets.length === 0 ? "접수된 문의가 없습니다." : "조건에 맞는 문의가 없습니다."}</p>
            ) : (
              pageItems.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedId(t.id); setReplyId(null); }}
                  className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-1.5 text-left transition hover:border-slate-300 ${
                    selectedId === t.id ? "border-slate-950 ring-1 ring-slate-200" : "border-slate-200"
                  }`}
                >
                  <span className="shrink-0"><StatusBadge status={t.category} map={CAT_BADGE} /></span>
                  <span className="flex-1 truncate text-[15px] font-black text-slate-900">{t.title}</span>
                  <span className="shrink-0 max-w-[120px] truncate text-[13px] font-semibold text-slate-500">{t.agencyName ?? "알 수 없음"}</span>
                  <span className="shrink-0"><StatusBadge status={t.status} map={SUP_STATUS} /></span>
                  <span className="shrink-0 w-[56px] text-right text-xs font-semibold text-slate-400">{t.createdAt.slice(2, 10)}</span>
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
            <div className={`${T.card} space-y-4`}>
              <div className="flex items-center gap-1.5">
                <StatusBadge status={selected.category} map={CAT_BADGE} />
                <StatusBadge status={selected.status} map={SUP_STATUS} />
                <span className="ml-auto text-[11px] font-semibold text-slate-300">{new Date(selected.createdAt).toLocaleString("ko-KR")}</span>
              </div>
              <div>
                <p className="text-base font-black text-slate-900">{selected.title}</p>
                <p className="mt-0.5 text-[13px] font-semibold text-slate-400">{selected.agencyName ?? "알 수 없음"}{selected.adminLogin ? ` · ${selected.adminLogin}` : ""}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">문의 내용</p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{selected.body}</p>
              </div>

              {selected.attachments && selected.attachments.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">첨부파일 ({selected.attachments.length})</p>
                  <ul className="space-y-1">
                    {selected.attachments.map(a => (
                      <li key={a.idx}>
                        <a href={`/api/admin/support/${selected.id}/attachment?i=${a.idx}`} target="_blank" rel="noreferrer"
                          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:bg-sky-50">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="flex-1 truncate text-sm font-semibold text-sky-700">{a.name}</span>
                          <span className="shrink-0 text-[11px] font-semibold text-slate-400">{fmtSize(a.size)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.reply && replyId !== selected.id && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">
                    회신 ({selected.replierLogin ?? "운영자"}{selected.repliedAt ? ` · ${new Date(selected.repliedAt).toLocaleDateString("ko-KR")}` : ""})
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{selected.reply}</p>
                  {selected.replyAttachments && selected.replyAttachments.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {selected.replyAttachments.map(a => (
                        <li key={a.idx}>
                          <a href={`/api/admin/support/${selected.id}/attachment?which=reply&i=${a.idx}`} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:bg-sky-50">
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="flex-1 truncate text-sm font-semibold text-sky-700">{a.name}</span>
                            <span className="shrink-0 text-[11px] font-semibold text-slate-400">{fmtSize(a.size)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {replyId === selected.id ? (
                <div className="space-y-2">
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="회신 내용을 입력하세요..."
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 resize-none"
                    autoFocus
                  />

                  {/* 답변 첨부 */}
                  <div>
                    <input ref={fileInputRef} type="file" multiple className="hidden"
                      accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                      onChange={onPickReplyFiles} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={replyUploading || replyAttachments.length >= MAX_FILES}
                      className={`${T.btnSecondary} inline-flex items-center gap-1.5 text-xs disabled:opacity-40`}>
                      <Paperclip className="h-3.5 w-3.5" />{replyUploading ? "업로드 중..." : "파일 첨부"}
                    </button>
                    {replyAttachments.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {replyAttachments.map((a, i) => (
                          <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="flex-1 truncate text-sm font-semibold text-slate-700">{a.name}</span>
                            <button type="button" onClick={() => setReplyAttachments(prev => prev.filter((_, j) => j !== i))}
                              className="shrink-0 text-slate-400 hover:text-rose-500"><X className="h-4 w-4" /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => { setReplyId(null); setReplyText(""); setReplyAttachments([]); }} className={T.btnSecondary}>취소</button>
                    <button onClick={() => sendReply(selected.id)} disabled={sending || replyUploading} className={T.btnPrimary + " flex items-center gap-1.5"}>
                      <Send className="h-3.5 w-3.5" />{sending ? "전송 중..." : "회신 전송"}
                    </button>
                  </div>
                </div>
              ) : selected.status !== "CLOSED" && (
                <button onClick={() => openReply(selected.id, selected.reply)} className={T.btnPrimary + " flex items-center gap-1.5 text-sm"}>
                  <Send className="h-3.5 w-3.5" />{selected.reply ? "회신 수정" : "회신 작성"}
                </button>
              )}
            </div>
          ) : (
            <div className={`${T.card} text-center`}>
              <p className="py-6 text-sm font-semibold text-slate-300">목록에서 문의를 선택하면<br />상세 내용이 표시됩니다.</p>
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
