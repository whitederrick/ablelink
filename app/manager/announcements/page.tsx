"use client";

// 위탁기관 공지 게시판 — 매니저가 작성/수정/고정/삭제. 소속 직무지도원이 앱 '공지사항'에서 열람.
// 카테고리는 시스템 운영자가 전역 관리(app/admin/settings) → 매니저는 작성 시 선택만.
// 표준 게시판: PageHeader(+등록) → StatCardRow → ListToolbar(검색·카테고리 멀티필터) → 목록+우측 상세 → Pagination.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pin, Trash2, Pencil } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Category = { id: string; name: string; tone: string };
type Item = {
  id: string; title: string; body: string; type: string;
  categoryId: string | null; category: Category | null;
  pinned: boolean; createdAt: string;
};

const TONE_CLS: Record<string, string> = {
  sky: "bg-sky-50 text-sky-600", amber: "bg-amber-50 text-amber-600", rose: "bg-rose-50 text-rose-600",
  emerald: "bg-emerald-50 text-emerald-600", violet: "bg-teal-50 text-teal-600", slate: "bg-slate-100 text-slate-500",
};
const PAGE_SIZE = 10;

// 공지 1건의 카테고리 뱃지 — 카테고리 있으면 우선, 없으면 레거시 type 폴백
function CatBadge({ it }: { it: Item }) {
  if (it.category) {
    return <span className={`${T.badge} ${TONE_CLS[it.category.tone] ?? TONE_CLS.sky}`}>{it.category.name}</span>;
  }
  return <StatusBadge status={it.type} />;
}

export default function AgencyAnnouncementsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  // 조회조건
  const [query, setQuery] = useState("");
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 작성/편집 모달
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; id?: string }>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(() => {
    fetch("/api/admin/agency-announcements").then(r => r.json())
      .then(d => { if (d.success) setItems(d.announcements); }).catch(e => console.error("[manager/announcements] 목록 로드 실패", e)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/admin/announcement-categories").then(r => r.json())
      .then(d => { if (d.success) setCategories(d.categories); }).catch(e => console.error("[manager/announcements] 카테고리 로드 실패", e));
  }, []);

  // 필터링 + 정렬(고정 우선, 최신순)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(it => selectedCats.length === 0 || (it.categoryId != null && selectedCats.includes(it.categoryId)))
      .filter(it => !q || it.title.toLowerCase().includes(q) || it.body.toLowerCase().includes(q))
      .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.createdAt < a.createdAt ? -1 : 1));
  }, [items, query, selectedCats]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { if (page > totalPages) setPage(1); }, [page, totalPages]);

  const selected = items.find(it => it.id === selectedId) ?? null;

  const filters: FilterChip[] = categories.map(c => ({
    value: c.id, label: c.name, count: items.filter(it => it.categoryId === c.id).length,
  }));
  const toggleCat = (v: string) =>
    setSelectedCats(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  const stats = useMemo(() => ({
    total: items.length,
    pinned: items.filter(it => it.pinned).length,
    urgent: items.filter(it => (it.category?.tone ?? null) === "rose" || it.type === "URGENT").length,
  }), [items]);

  function openCreate() {
    setTitle(""); setBody(""); setCategoryId(categories[0]?.id ?? ""); setPinned(false);
    setModal({ mode: "create" });
  }
  function openEdit(it: Item) {
    setTitle(it.title); setBody(it.body); setCategoryId(it.categoryId ?? categories[0]?.id ?? ""); setPinned(it.pinned);
    setModal({ mode: "edit", id: it.id });
  }

  async function submit() {
    if (!title.trim() || !body.trim()) { showToast("제목과 내용을 입력해주세요."); return; }
    setSaving(true);
    try {
      const payload: any = { title: title.trim(), body: body.trim(), pinned };
      if (categoryId) payload.categoryId = categoryId;
      const res = modal?.mode === "edit"
        ? await fetch(`/api/admin/agency-announcements/${modal.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/agency-announcements", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          });
      const d = await res.json();
      if (d.success) { setModal(null); showToast(modal?.mode === "edit" ? "공지를 수정했습니다." : "공지를 게시했습니다."); load(); }
      else showToast(d.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(it: Item) {
    await fetch(`/api/admin/agency-announcements/${it.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !it.pinned }),
    });
    load();
  }
  async function remove(it: Item) {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    await fetch(`/api/admin/agency-announcements/${it.id}`, { method: "DELETE" });
    if (selectedId === it.id) setSelectedId(null);
    load();
  }

  return (
    <div>
      <PageHeader
        title="위탁기관 공지사항"
        sub="소속 직무지도원 앱의 ‘공지사항’에 게시됩니다. 개별 통지가 필요하면 ‘알림 발송’ 메뉴를 이용하세요."
        actions={
          <button onClick={openCreate} className={T.btnPrimary}>
            + 공지 등록
          </button>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 공지", value: stats.total },
          { label: "상단 고정", value: stats.pinned, tone: "sky" },
          { label: "긴급", value: stats.urgent, tone: "rose" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={v => { setQuery(v); setPage(1); }}
          placeholder="제목·내용 검색"
          filters={filters}
          selected={selectedCats}
          onToggleFilter={v => { toggleCat(v); setPage(1); }}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 목록 — 컴팩트 단일라인 행 */}
        <div>
          {loading ? (
            <p className={T.empty}>불러오는 중…</p>
          ) : pageItems.length === 0 ? (
            <p className={T.empty}>{items.length === 0 ? "게시된 공지가 없습니다." : "조건에 맞는 공지가 없습니다."}</p>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>{["분류", "제목", "대상", "게시일"].map(h => (
                    <th key={h} className={T.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {pageItems.map(it => (
                    <tr key={it.id} onClick={() => setSelectedId(it.id)}
                      className={`${T.trBase} cursor-pointer hover:bg-slate-50 ${selectedId === it.id ? "bg-slate-100" : ""}`}>
                      <td className={T.td}><CatBadge it={it} /></td>
                      <td className={`${T.td} max-w-[240px]`}>
                        <div className="flex items-center gap-1.5">
                          {it.pinned && <Pin className="h-4 w-4 shrink-0 fill-rose-500 text-rose-500" />}
                          <span className="truncate font-black text-slate-900">{it.title}</span>
                        </div>
                      </td>
                      <td className={T.td}>소속 전체</td>
                      <td className={`${T.td} whitespace-nowrap`}>{it.createdAt.slice(2, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
            </div>
          )}
        </div>

        {/* 상세(우측 패널) */}
        <div className="lg:sticky lg:top-4 h-fit">
          {selected ? (
            <div className={T.card}>
              <div className="mb-2 flex items-center gap-1.5">
                {selected.pinned && <Pin className="h-4 w-4 fill-rose-500 text-rose-500" />}
                <CatBadge it={selected} />
                <span className="ml-auto text-[11px] font-semibold text-slate-300">{selected.createdAt.slice(0, 10)}</span>
              </div>
              <p className="text-base font-black text-slate-900">{selected.title}</p>
              <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-600">{selected.body}</p>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <button onClick={() => openEdit(selected)} className={`inline-flex items-center gap-1.5 ${T.btnSecondary}`}>
                  <Pencil className="h-3.5 w-3.5" /> 수정
                </button>
                <button onClick={() => togglePin(selected)} className={`inline-flex items-center gap-1.5 ${T.btnSecondary}`}>
                  <Pin className={`h-3.5 w-3.5 ${selected.pinned ? "fill-rose-500 text-rose-500" : ""}`} />
                  {selected.pinned ? "고정 해제" : "상단 고정"}
                </button>
                <button onClick={() => remove(selected)} className={`ml-auto inline-flex items-center gap-1.5 ${T.btnDanger}`}>
                  <Trash2 className="h-3.5 w-3.5" /> 삭제
                </button>
              </div>
            </div>
          ) : (
            <div className={`${T.card} text-center`}>
              <p className="py-6 text-sm font-semibold text-slate-300">목록에서 공지를 선택하면<br />상세 내용이 표시됩니다.</p>
            </div>
          )}
        </div>
      </div>

      {/* 작성/편집 모달 */}
      {modal && (
        <div className={T.modalOverlay} onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className={T.modalContent}>
            <p className="mb-4 text-base font-black text-slate-900">{modal.mode === "edit" ? "공지 수정" : "새 공지 작성"}</p>
            <label className={T.label}>제목</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={`mb-3 w-full ${T.input}`} placeholder="공지 제목" />
            <label className={T.label}>내용</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
              className="mb-3 w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" placeholder="공지 내용" />
            <div className="mb-5 flex items-end gap-3">
              <div className="flex-1">
                <label className={T.label}>카테고리</label>
                {categories.length === 0 ? (
                  <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                    등록된 카테고리가 없습니다. 시스템 운영자에게 카테고리 등록을 요청하세요.
                  </p>
                ) : (
                  <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={`w-full ${T.select}`}>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
              <label className="flex items-center gap-1.5 whitespace-nowrap pb-2.5 text-sm font-semibold text-slate-600">
                <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> 상단 고정
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className={T.btnSecondary}>취소</button>
              <button onClick={submit} disabled={saving} className={T.btnPrimary}>
                {saving ? "저장 중…" : modal.mode === "edit" ? "수정" : "게시"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}
