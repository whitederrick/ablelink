"use client";

// 시스템 공지사항 — 운영자가 발송한 시스템 공지를 매니저가 열람(목록→상세→확인/미확인).
// (매니저가 직무지도원에게 보내는 공지는 '위탁기관 공지사항' 별개)
import { useCallback, useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Item = { id: string; title: string; body: string; type: string; createdAt: string; read: boolean };

const SYS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  INFO: { label: "공지", tone: "sky" },
  MAINTENANCE: { label: "점검", tone: "amber" },
  URGENT: { label: "긴급", tone: "rose" },
};
const PAGE_SIZE = 10;

export default function SystemNoticesPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/announcements", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.announcements); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function markRead(id: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, read: true } : it));
    await fetch("/api/admin/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  }
  async function markAll() {
    setItems(prev => prev.map(it => ({ ...it, read: true })));
    await fetch("/api/admin/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }).catch(() => {});
  }

  function select(it: Item) {
    setSelectedId(it.id);
    if (!it.read) markRead(it.id);
  }

  const unread = items.filter(i => !i.read).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(it => typeFilter.length === 0 || typeFilter.includes(it.type))
      .filter(it => readFilter === "all" || (readFilter === "unread" ? !it.read : it.read))
      .filter(it => !q || it.title.toLowerCase().includes(q) || it.body.toLowerCase().includes(q));
  }, [items, query, typeFilter, readFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { if (page > totalPages) setPage(1); }, [page, totalPages]);
  useEffect(() => { setPage(1); }, [query, typeFilter, readFilter]);

  const selected = items.find(it => it.id === selectedId) ?? null;

  const filters: FilterChip[] = [
    { value: "INFO", label: "공지", count: items.filter(i => i.type === "INFO").length },
    { value: "MAINTENANCE", label: "점검", count: items.filter(i => i.type === "MAINTENANCE").length },
    { value: "URGENT", label: "긴급", count: items.filter(i => i.type === "URGENT").length },
  ];
  const toggleType = (v: string) => setTypeFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div>
      <PageHeader
        title="시스템 공지사항"
        sub="시스템 운영자가 발송한 공지입니다. 목록에서 선택하면 상세가 표시되고 확인 처리됩니다."
        actions={unread > 0 && <button onClick={markAll} className={T.btnSecondary}>모두 확인</button>}
      />

      <StatCardRow
        className="mb-5"
        cols={2}
        items={[
          { label: "전체 공지", value: items.length },
          { label: "미확인", value: unread, tone: "rose" },
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
          extraFirst
          extra={
            <div className="flex gap-1">
              {([["all", "전체"], ["unread", "미확인"], ["read", "확인"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setReadFilter(v)}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${readFilter === v ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                  {label}
                </button>
              ))}
            </div>
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 목록 — 컴팩트 단일라인 행 */}
        <div>
          {loading ? (
            <p className={T.empty}>불러오는 중…</p>
          ) : pageItems.length === 0 ? (
            <p className={T.empty}>{items.length === 0 ? "등록된 공지가 없습니다." : "조건에 맞는 공지가 없습니다."}</p>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["유형", "확인", "제목", "게시일"].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {pageItems.map(it => (
                    <tr key={it.id} onClick={() => select(it)}
                      className={`${T.trBase} cursor-pointer hover:bg-slate-50 ${selectedId === it.id ? "bg-slate-100" : ""}`}>
                      <td className={T.td}><StatusBadge status={it.type} map={SYS_BADGE} /></td>
                      <td className={T.td}>
                        {it.read
                          ? <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-black text-emerald-600">확인</span>
                          : <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[13px] font-black text-rose-600">미확인</span>}
                      </td>
                      <td className={`${T.td} max-w-[260px]`}><div className={`truncate ${it.read ? "" : "font-black text-slate-900"}`}>{it.title}</div></td>
                      <td className={`${T.td} whitespace-nowrap`}>{it.createdAt.slice(2, 10)}</td>
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
                <StatusBadge status={selected.type} map={SYS_BADGE} />
                <span className="ml-auto text-[11px] font-semibold text-slate-300">{selected.createdAt.slice(0, 10)}</span>
              </div>
              <p className="text-base font-black text-slate-900">{selected.title}</p>
              <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-600">{selected.body}</p>
            </div>
          ) : (
            <div className={`${T.card} text-center`}>
              <p className="py-6 text-sm font-semibold text-slate-300">목록에서 공지를 선택하면<br />상세 내용이 표시됩니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
