"use client";

// app/admin/promos/page.tsx
// 운영자: 대시보드 소식 티커·광고 관리(생성/수정/활성토글/게시기간/삭제) + 티커 속도 조절.
import { useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";

type Kind = "TICKER" | "AD";
type Promo = {
  id: string; kind: Kind; badge: string | null; title: string; body: string | null;
  imageUrl: string | null; href: string | null; isActive: boolean;
  startAt: string | null; endAt: string | null; note: string | null; sortOrder: number;
};

const KIND_LABEL: Record<Kind, string> = { TICKER: "소식 티커", AD: "광고" };
const emptyDraft = (kind: Kind): Partial<Promo> => ({ kind, badge: "", title: "", body: "", imageUrl: "", href: "", isActive: true, startAt: null, endAt: null, note: "", sortOrder: 0 });

function toDateInput(iso: string | null): string { return iso ? iso.slice(0, 10) : ""; }
function fmtPeriod(s: string | null, e: string | null): string {
  if (!s && !e) return "상시";
  return `${s ? s.slice(0, 10) : "~"} ~ ${e ? e.slice(0, 10) : "~"}`;
}

export default function AdminPromosPage() {
  const [items, setItems] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; draft: Partial<Promo> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [speed, setSpeed] = useState("32");
  const [speedSaving, setSpeedSaving] = useState(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  function load() {
    setLoading(true);
    fetch("/api/admin/system/promos").then(r => r.json()).then(d => { if (d.success) setItems(d.data); }).finally(() => setLoading(false));
    fetch("/api/admin/system/config").then(r => r.json()).then(d => {
      if (d.success) { const c = d.items.find((x: any) => x.key === "DASHBOARD_TICKER_DURATION_SEC"); if (c) setSpeed(String(c.value)); }
    }).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter(i => i.kind === "AD"), [items]);

  async function saveSpeed() {
    setSpeedSaving(true);
    try {
      const d = await fetch("/api/admin/system/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "DASHBOARD_TICKER_DURATION_SEC", value: speed }) }).then(r => r.json());
      showToast(d.success ? "티커 속도 저장됨" : (d.message || "저장 실패"));
    } finally { setSpeedSaving(false); }
  }

  async function toggleActive(p: Promo) {
    const d = await fetch(`/api/admin/system/promos/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !p.isActive }) }).then(r => r.json());
    if (d.success) load(); else showToast(d.message || "실패");
  }

  async function submit() {
    if (!modal) return;
    const dr = modal.draft;
    if (!dr.title?.trim()) { showToast("제목(문구)을 입력하세요."); return; }
    setSaving(true);
    // 게시기간: 날짜 입력(YYYY-MM-DD) → KST 경계 ISO
    const startAt = dr.startAt ? `${dr.startAt.slice(0, 10)}T00:00:00+09:00` : null;
    const endAt = dr.endAt ? `${dr.endAt.slice(0, 10)}T23:59:59+09:00` : null;
    const payload = { ...dr, startAt, endAt };
    try {
      const url = modal.mode === "create" ? "/api/admin/system/promos" : `/api/admin/system/promos/${dr.id}`;
      const method = modal.mode === "create" ? "POST" : "PATCH";
      const d = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(r => r.json());
      if (d.success) { setModal(null); load(); showToast("저장되었습니다."); } else showToast(d.message || "저장 실패");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!modal?.draft.id) return;
    if (!confirm("이 항목을 삭제할까요?")) return;
    const d = await fetch(`/api/admin/system/promos/${modal.draft.id}`, { method: "DELETE" }).then(r => r.json());
    if (d.success) { setModal(null); load(); showToast("삭제되었습니다."); } else showToast(d.message || "삭제 실패");
  }

  const setField = (k: keyof Promo, v: any) => setModal(m => m ? { ...m, draft: { ...m.draft, [k]: v } } : m);

  return (
    <div className="space-y-5">
      <PageHeader title="대시보드 광고" sub="위탁기관 대시보드 하단 광고를 관리합니다. (상단 소식 티커는 '시스템 공지'에서 '티커 노출'로 관리)" />

      {/* 티커 속도 */}
      <div className={`${T.card} flex flex-wrap items-center gap-3`}>
        <span className="text-sm font-black text-slate-700">티커 속도(초/바퀴)</span>
        <input type="number" min={8} max={120} value={speed} onChange={e => setSpeed(e.target.value)} className={`w-24 ${T.input}`} />
        <span className="text-xs font-semibold text-slate-400">작을수록 빠름 (권장 24~40)</span>
        <button onClick={saveSpeed} disabled={speedSaving} className={T.btnSecondary}>{speedSaving ? "저장 중..." : "속도 저장"}</button>
      </div>

      {/* 생성 */}
      <div className="flex items-center justify-end">
        <button onClick={() => setModal({ mode: "create", draft: emptyDraft("AD") })} className={T.btnPrimary}>+ 광고 추가</button>
      </div>

      {/* 목록 */}
      <div className={T.tableWrap}>
        <table className="w-full">
          <thead><tr>{["배지", "제목", "게시 기간", "순서", "상태"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className={T.tdCenter}>등록된 광고가 없습니다.</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setModal({ mode: "edit", draft: { ...p, startAt: toDateInput(p.startAt), endAt: toDateInput(p.endAt) } })}>
                <td className={T.td}>{p.badge || <span className="text-slate-300">-</span>}</td>
                <td className={T.td}><div className="max-w-[360px] truncate font-semibold text-slate-800">{p.title}</div></td>
                <td className={`${T.td} whitespace-nowrap text-slate-500`}>{fmtPeriod(p.startAt, p.endAt)}</td>
                <td className={T.td}>{p.sortOrder}</td>
                <td className={T.td}>
                  <button onClick={e => { e.stopPropagation(); toggleActive(p); }}
                    className={`${T.badge} ${p.isActive ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                    {p.isActive ? "게시중" : "숨김"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 생성/수정 모달 */}
      {modal && (
        <div className={T.modalOverlay} onClick={() => setModal(null)}>
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-black text-slate-900">{modal.mode === "create" ? "새 광고" : "광고 수정"}</h2>
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-slate-600">배지
                <input value={modal.draft.badge ?? ""} onChange={e => setField("badge", e.target.value)} placeholder="광고" className={`mt-1 ${T.input}`} />
              </label>
              <label className="block text-sm font-semibold text-slate-600">제목
                <input value={modal.draft.title ?? ""} onChange={e => setField("title", e.target.value)} className={`mt-1 ${T.input}`} />
              </label>
              <label className="block text-sm font-semibold text-slate-600">설명
                <input value={modal.draft.body ?? ""} onChange={e => setField("body", e.target.value)} className={`mt-1 ${T.input}`} />
              </label>
              <label className="block text-sm font-semibold text-slate-600">이미지 URL
                <input value={modal.draft.imageUrl ?? ""} onChange={e => setField("imageUrl", e.target.value)} placeholder="https://..." className={`mt-1 ${T.input}`} />
              </label>
              <label className="block text-sm font-semibold text-slate-600">링크(클릭 이동)
                <input value={modal.draft.href ?? ""} onChange={e => setField("href", e.target.value)} placeholder="/manager/... 또는 https://..." className={`mt-1 ${T.input}`} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-semibold text-slate-600">게시 시작
                  <input type="date" value={(modal.draft.startAt ?? "").slice(0, 10)} onChange={e => setField("startAt", e.target.value)} className={`mt-1 ${T.input}`} />
                </label>
                <label className="text-sm font-semibold text-slate-600">게시 종료
                  <input type="date" value={(modal.draft.endAt ?? "").slice(0, 10)} onChange={e => setField("endAt", e.target.value)} className={`mt-1 ${T.input}`} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-semibold text-slate-600">정렬 순서
                  <input type="number" value={modal.draft.sortOrder ?? 0} onChange={e => setField("sortOrder", Number(e.target.value))} className={`mt-1 ${T.input}`} />
                </label>
                <label className="flex items-end gap-2 text-sm font-semibold text-slate-600">
                  <input type="checkbox" checked={!!modal.draft.isActive} onChange={e => setField("isActive", e.target.checked)} className="mb-2.5 h-4 w-4" />
                  게시중(활성)
                </label>
              </div>
              <label className="block text-sm font-semibold text-slate-600">운영 메모(내부)
                <input value={modal.draft.note ?? ""} onChange={e => setField("note", e.target.value)} placeholder="광고주·계약 등" className={`mt-1 ${T.input}`} />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
              {modal.mode === "edit"
                ? <button onClick={remove} className="text-sm font-bold text-rose-500 hover:text-rose-700">삭제</button>
                : <span />}
              <div className="flex gap-2">
                <button onClick={() => setModal(null)} className={T.btnSecondary}>취소</button>
                <button onClick={submit} disabled={saving} className={T.btnPrimary}>{saving ? "저장 중..." : "저장"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>}
    </div>
  );
}
