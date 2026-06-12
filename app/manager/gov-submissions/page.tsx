"use client";

// 공단 제출 내역 — 장애인고용공단에 제출 완료(govStatus=SUBMITTED)된 문서 보관·조회.
// 일지 관리에서 발송(또는 수동 제출완료 표시)하면 이리로 이동. 공단이 재제출 요구 시 '재제출 요구로 표시' → 일지 관리로 복귀.
// 서버 페이지네이션(누적 대비).
import { useCallback, useEffect, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";

const PAGE_SIZE = 20;

type Item = {
  id: string;
  docLabel: string;
  traineeName: string | null;
  workerName: string;
  siteName: string;
  periodStart: string;
  periodEnd: string;
  govStatus: string;
  govSubmittedAt: string | null;
  currentVersionId: string | null;
};

export default function GovSubmissionsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  useEffect(() => { const t = setTimeout(() => { setQDebounced(q.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ govStatus: "SUBMITTED", page: String(page), pageSize: String(PAGE_SIZE), ...(qDebounced ? { q: qDebounced } : {}) });
    fetch(`/api/admin/document-runs/inbox?${p.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setItems(d.items);
          setTotalPages(d.totalPages ?? 1);
          setTotal(d.total ?? d.items.length);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, qDebounced]);
  useEffect(() => { load(); }, [load]);

  function toggleSel(id: string) {
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function downloadSelected() {
    if (selected.size === 0) { showToast("다운로드할 문서를 선택해주세요."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/document-runs/zip?ids=${[...selected].join(",")}`);
      if (!res.ok) { showToast("다운로드 실패"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `공단제출_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      URL.revokeObjectURL(url);
    } catch { showToast("다운로드 실패"); }
    finally { setBusy(false); }
  }

  async function markResubmit() {
    if (selected.size === 0) { showToast("대상 문서를 선택해주세요."); return; }
    if (!confirm(`선택한 ${selected.size}건을 ‘재제출 요구’로 표시하고 일지 관리로 되돌릴까요?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/document-runs/gov-status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], status: "RESUBMIT" }),
      });
      const d = await res.json();
      if (!d.success) { showToast(d.message || "변경 실패"); return; }
      showToast(d.message || "재제출 요구로 표시했습니다.");
      setSelected(new Set()); load();
    } catch { showToast("변경 실패"); }
    finally { setBusy(false); }
  }

  function downloadPdf(item: Item) {
    if (!item.currentVersionId) { showToast("다운로드할 버전이 없습니다."); return; }
    window.open(`/api/admin/document-versions/${item.currentVersionId}/pdf`, "_blank");
  }

  return (
    <div>
      <PageHeader title="공단 제출 내역 관리" sub="장애인고용공단에 제출 완료된 문서입니다. 공단이 재제출을 요구하면 ‘재제출 요구로 표시’로 일지 관리에 되돌릴 수 있습니다." />

      <div className="mb-4">
        <ListToolbar
          query={q}
          onQueryChange={setQ}
          placeholder="직무지도원·현장 검색"
          extraFirst
          extra={
            <div className="flex items-center gap-2">
              <button onClick={downloadSelected} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 active:scale-95 disabled:opacity-50">
                선택 다운로드{selected.size > 0 ? ` (${selected.size})` : ""}
              </button>
              <button onClick={markResubmit} disabled={busy || selected.size === 0} className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-black text-rose-700 active:scale-95 disabled:opacity-40">
                재제출 요구로 표시
              </button>
            </div>
          }
        />
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white py-16 text-center">
          <p className="text-sm font-semibold text-slate-400">{qDebounced ? "조건에 맞는 문서가 없습니다." : "공단에 제출 완료된 문서가 없습니다."}</p>
          {!qDebounced && <p className="mt-1 text-xs font-semibold text-slate-300">일지 관리에서 공단에 발송하면 여기에 표시됩니다.</p>}
        </div>
      ) : (
        <div className={T.tableWrap}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={`${T.th} w-10`}>
                  <input type="checkbox" className="h-4 w-4 cursor-pointer accent-slate-900" aria-label="현재 페이지 전체 선택"
                    checked={items.length > 0 && items.every(it => selected.has(it.id))}
                    onChange={e => setSelected(p => { const n = new Set(p); items.forEach(it => e.target.checked ? n.add(it.id) : n.delete(it.id)); return n; })} />
                </th>
                {["문서", "직무지도원 · 현장 · 기간", "제출일", "작업"].map(h => <th key={h} className={T.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className={`${T.trBase} ${selected.has(item.id) ? "bg-sky-50/60" : ""}`}>
                  <td className={T.td}>
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-slate-900" aria-label="선택"
                      checked={selected.has(item.id)} onChange={() => toggleSel(item.id)} />
                  </td>
                  <td className={T.td}>
                    <span className="font-semibold text-slate-900">{item.docLabel}</span>
                    {item.traineeName && <span className="text-[13px] text-slate-500"> · {item.traineeName}</span>}
                  </td>
                  <td className={`${T.td} max-w-[280px] truncate text-[13px] text-slate-500`}>
                    {item.workerName} · {item.siteName} · {item.periodStart}~{item.periodEnd}
                  </td>
                  <td className={`${T.td} whitespace-nowrap text-[13px] text-slate-600`}>{item.govSubmittedAt ? item.govSubmittedAt.slice(0, 10) : "-"}</td>
                  <td className={T.td}>
                    <button onClick={() => downloadPdf(item)} className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-bold text-slate-700 active:scale-95">다운로드</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}
