"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { X, MessageCircle, Paperclip } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Attachment = { idx: number; name: string; size: number; mime: string };
type Ticket = {
  id: string; category: string; title: string; body: string;
  status: "OPEN" | "REPLIED" | "CLOSED";
  reply: string | null; replierLogin: string | null;
  repliedAt: string | null; createdAt: string;
  attachments?: Attachment[];
  replyAttachments?: Attachment[];
};

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: "일반 문의",
  SYSTEM: "시스템 관련 문의",
  DATA_FIX: "데이터 관련 문의",
  BILLING: "결제 및 구독 관련 문의",
  CONTRACT_TEMPLATE: "근로계약서 양식 등록",
  OTHER: "기타",
};
const CAT_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  GENERAL: { label: "일반", tone: "sky" },
  SYSTEM: { label: "시스템", tone: "amber" },
  DATA_FIX: { label: "데이터", tone: "rose" },
  BILLING: { label: "결제·구독", tone: "emerald" },
  CONTRACT_TEMPLATE: { label: "계약서 양식", tone: "slate" },
  OTHER: { label: "기타", tone: "slate" },
};
const SUP_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "답변 대기", tone: "amber" },
  REPLIED: { label: "답변 완료", tone: "emerald" },
  CLOSED: { label: "종료", tone: "slate" },
};

// 카테고리별 작성 템플릿(예시) — 선택 시 내용 입력란에 자동 채워진다(직접 수정 가능).
const TEMPLATES: Record<string, string> = {
  GENERAL:
`[문의 요약]

[상세 내용]

[기대하는 조치/답변]`,
  SYSTEM:
`[발생 화면/메뉴]

[증상]

[발생 일시]

[재현 방법]
1.
2.

※ 가능하면 오류 화면 캡쳐를 첨부해주세요.`,
  DATA_FIX:
`[대상 데이터] (예: 직무지도원 / 현장 / 출근부 / 급여)

[현재 값]

[수정할 값]

[수정 사유]`,
  BILLING:
`[문의 유형] (예: 결제 오류 / 플랜 변경 / 환불 / 세금계산서)

[상세 내용]

[결제 일시·금액] (해당 시)`,
  CONTRACT_TEMPLATE:
`[등록 요청 양식명]

[적용 대상] (예: 특정 현장 / 전체)

[요청 사항]

※ 등록할 계약서 양식 파일을 첨부해주세요. (한글(HWP) 또는 PDF)`,
  OTHER:
`[문의 내용]`,
};
const TEMPLATE_SET = new Set(Object.values(TEMPLATES));

const PAGE_SIZE = 10;
const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

type PendingAttachment = { path: string; name: string; size: number; mime: string };

export default function ManagerSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]       = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: TEMPLATES.GENERAL, category: "GENERAL" });
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const selected = tickets.find(t => t.id === selectedId) ?? null;

  function openForm() {
    setForm({ title: "", body: TEMPLATES.GENERAL, category: "GENERAL" });
    setAttachments([]);
    setShowForm(true);
  }

  // 카테고리 변경 시: 내용이 비어있거나 기존 템플릿 그대로면 새 템플릿으로 교체(직접 입력한 내용은 보존).
  function changeCategory(newCat: string) {
    setForm(f => {
      const replaceable = !f.body.trim() || TEMPLATE_SET.has(f.body);
      return { ...f, category: newCat, body: replaceable ? (TEMPLATES[newCat] ?? "") : f.body };
    });
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    if (attachments.length + picked.length > MAX_FILES) { showToast(`첨부는 최대 ${MAX_FILES}개까지 가능합니다.`); return; }
    setUploading(true);
    for (const file of picked) {
      if (file.size > MAX_SIZE) { showToast(`${file.name}: 10MB를 초과합니다.`); continue; }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", file.name);
      try {
        const res = await fetch("/api/admin/support/upload", { method: "POST", body: fd });
        const d = await res.json();
        if (d.success) setAttachments(prev => [...prev, d.attachment]);
        else showToast(d.message ?? `${file.name} 업로드 실패`);
      } catch { showToast(`${file.name} 업로드 실패`); }
    }
    setUploading(false);
  }

  async function submit() {
    if (!form.title.trim() || !form.body.trim()) { showToast("제목과 내용을 입력해주세요."); return; }
    setSubmitting(true);
    const res  = await fetch("/api/admin/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, attachments }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (data.success) {
      showToast("문의가 접수되었습니다.");
      setShowForm(false);
      setForm({ title: "", body: TEMPLATES.GENERAL, category: "GENERAL" });
      setAttachments([]);
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
        title="시스템 관리자 문의"
        sub="데이터 수정 요청, 결제 문의 등을 Ablelink 운영팀에 보냅니다"
        actions={
          <button onClick={openForm} className={T.btnPrimary}>
            + 문의 등록
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

      {/* 문의 등록 모달 */}
      {showForm && (
        <div className={T.modalOverlay}>
          <div className={T.modalContent}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-slate-700" />
                <p className="text-base font-black text-slate-900">문의 등록</p>
              </div>
              <button onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={T.label}>문의 유형</label>
                <select value={form.category} onChange={e => changeCategory(e.target.value)} className={T.select + " w-full"}>
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
                <p className="mb-1 text-[11px] font-semibold text-slate-400">유형을 선택하면 작성 양식이 자동으로 채워집니다. 항목에 맞춰 작성해주세요.</p>
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="문의 내용을 자세히 작성해주세요..."
                  rows={9}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 resize-none" />
              </div>

              {/* 첨부파일 */}
              <div>
                <label className={T.label}>첨부파일 <span className="font-semibold text-slate-400">(선택 · 최대 {MAX_FILES}개 · 10MB)</span></label>
                <p className="mb-2 text-[11px] font-semibold text-slate-400">계약서 양식(한글·PDF), 오류 화면 캡쳐 등을 첨부할 수 있습니다.</p>
                <input ref={fileInputRef} type="file" multiple className="hidden"
                  accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                  onChange={onPickFiles} />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading || attachments.length >= MAX_FILES}
                  className={`${T.btnSecondary} inline-flex items-center gap-1.5 disabled:opacity-40`}>
                  <Paperclip className="h-3.5 w-3.5" />{uploading ? "업로드 중..." : "파일 첨부"}
                </button>
                {attachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {attachments.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-150 bg-slate-50 px-3 py-1.5">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="flex-1 truncate text-sm font-semibold text-slate-700">{a.name}</span>
                        <span className="shrink-0 text-[11px] font-semibold text-slate-400">{fmtSize(a.size)}</span>
                        <button type="button" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                          className="shrink-0 text-slate-400 hover:text-rose-500"><X className="h-4 w-4" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="text-xs text-slate-400">접수 후 영업일 기준 1~2일 내 답변 드립니다.</p>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setShowForm(false)} className={T.btnSecondary + " flex-1"}>취소</button>
              <button onClick={submit} disabled={submitting || uploading} className={T.btnPrimary + " flex-1"}>
                {submitting ? "접수 중..." : "문의 접수"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 목록(좌) — 상세(우) 마스터-디테일 */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* 목록 */}
        <div>
          {loading ? (
            <p className={T.empty}>불러오는 중…</p>
          ) : pageItems.length === 0 ? (
            <p className={T.empty}>{tickets.length === 0 ? "문의 내역이 없습니다." : "조건에 맞는 문의가 없습니다."}</p>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["유형", "상태", "제목", "등록일"].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {pageItems.map(t => (
                    <tr key={t.id} onClick={() => setSelectedId(t.id)}
                      className={`${T.trBase} cursor-pointer hover:bg-slate-50 ${selectedId === t.id ? "bg-slate-100" : ""}`}>
                      <td className={T.td}><StatusBadge status={t.category} map={CAT_BADGE} /></td>
                      <td className={T.td}><StatusBadge status={t.status} map={SUP_STATUS} /></td>
                      <td className={`${T.td} max-w-[240px]`}>
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-slate-800">{t.title}</span>
                          {t.attachments && t.attachments.length > 0 && (
                            <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />
                          )}
                        </div>
                      </td>
                      <td className={`${T.td} whitespace-nowrap`}>{t.createdAt.slice(2, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
            </div>
          )}
        </div>

        {/* 상세 */}
        <div className="lg:sticky lg:top-4 h-fit">
          {selected ? (
            <div className={T.card}>
              <div className="mb-2 flex items-center gap-1.5">
                <StatusBadge status={selected.category} map={CAT_BADGE} />
                <StatusBadge status={selected.status} map={SUP_STATUS} />
                <span className="ml-auto text-[11px] font-semibold text-slate-300">{new Date(selected.createdAt).toLocaleDateString("ko-KR")}</span>
              </div>
              <p className="text-base font-black text-slate-900">{selected.title}</p>

              <div className="mt-3">
                <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">문의 내용</p>
                <p className="whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-600">{selected.body}</p>
              </div>

              {selected.attachments && selected.attachments.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">첨부파일</p>
                  <ul className="space-y-1">
                    {selected.attachments.map(a => (
                      <li key={a.idx}>
                        <a href={`/api/admin/support/${selected.id}/attachment?i=${a.idx}`} target="_blank" rel="noreferrer"
                          className="flex items-center gap-2 rounded-lg border border-slate-150 bg-slate-50 px-3 py-1.5 hover:bg-sky-50">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="flex-1 truncate text-sm font-semibold text-sky-700">{a.name}</span>
                          <span className="shrink-0 text-[11px] font-semibold text-slate-400">{fmtSize(a.size)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.reply && (
                <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                  <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-emerald-600">
                    운영팀 답변 {selected.repliedAt ? `· ${new Date(selected.repliedAt).toLocaleDateString("ko-KR")}` : ""}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-slate-800">{selected.reply}</p>
                  {selected.replyAttachments && selected.replyAttachments.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {selected.replyAttachments.map(a => (
                        <li key={a.idx}>
                          <a href={`/api/admin/support/${selected.id}/attachment?which=reply&i=${a.idx}`} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 hover:bg-emerald-50">
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            <span className="flex-1 truncate text-sm font-semibold text-emerald-700">{a.name}</span>
                            <span className="shrink-0 text-[11px] font-semibold text-slate-400">{fmtSize(a.size)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {selected.status === "REPLIED" && (
                <button
                  onClick={() => closeTicket(selected.id)}
                  disabled={closing === selected.id}
                  className={T.btnSecondary + " mt-3 text-xs py-1.5"}
                >
                  {closing === selected.id ? "처리 중..." : "문의 종료"}
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
