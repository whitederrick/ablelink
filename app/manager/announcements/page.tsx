"use client";

// 에이전시 공지 게시판 — 매니저가 작성/고정/삭제. 소속 직무지도원이 앱 '공지사항'에서 열람.
// (알림 fan-out 없음. 개인 처리필요 알림은 '공지 발송'(직접 알림) 별개)
import { useCallback, useEffect, useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";

type Item = { id: string; title: string; body: string; type: string; pinned: boolean; createdAt: string };

const TYPES = [
  { val: "INFO", label: "안내" },
  { val: "WARN", label: "주의" },
  { val: "URGENT", label: "긴급" },
];
const TYPE_CLS: Record<string, string> = {
  URGENT: "bg-rose-50 text-rose-600", WARN: "bg-amber-50 text-amber-600", INFO: "bg-sky-50 text-sky-600",
};

export default function AgencyAnnouncementsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("INFO");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(() => {
    fetch("/api/admin/agency-announcements").then(r => r.json())
      .then(d => { if (d.success) setItems(d.announcements); }).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (!title.trim() || !body.trim()) { showToast("제목과 내용을 입력해주세요."); return; }
    setSaving(true);
    const res = await fetch("/api/admin/agency-announcements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: body.trim(), type, pinned }),
    });
    const d = await res.json();
    setSaving(false);
    if (d.success) { setTitle(""); setBody(""); setType("INFO"); setPinned(false); showToast("공지를 게시했습니다."); load(); }
    else showToast(d.message || "게시 실패");
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
    load();
  }

  return (
    <div className="p-6">
      <PageHeader
        title="공지 게시판"
        sub="소속 직무지도원 앱의 ‘공지사항’에 게시됩니다. (알림 도배 없이 게시판으로 열람)"
      />

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        {/* 작성 */}
        <div className={`${T.card} h-fit`}>
          <p className="mb-3 text-sm font-black text-slate-900">새 공지 작성</p>
          <label className={T.label}>제목</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={`mb-3 w-full ${T.input}`} placeholder="공지 제목" />
          <label className={T.label}>내용</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
            className="mb-3 w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" placeholder="공지 내용" />
          <div className="mb-3 flex items-center gap-2">
            <select value={type} onChange={e => setType(e.target.value)} className={T.select}>
              {TYPES.map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-600">
              <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> 상단 고정
            </label>
          </div>
          <button onClick={submit} disabled={saving} className={`w-full ${T.btnPrimary}`}>{saving ? "게시 중…" : "공지 게시"}</button>
        </div>

        {/* 목록 */}
        <div className="space-y-2.5">
          {loading ? (
            <p className={T.empty}>불러오는 중…</p>
          ) : items.length === 0 ? (
            <p className={T.empty}>게시된 공지가 없습니다.</p>
          ) : (
            items.map(it => (
              <div key={it.id} className={T.card}>
                <div className="flex items-center gap-1.5">
                  {it.pinned && <Pin className="h-3.5 w-3.5 fill-rose-500 text-rose-500" />}
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${TYPE_CLS[it.type] ?? TYPE_CLS.INFO}`}>
                    {TYPES.find(t => t.val === it.type)?.label ?? "안내"}
                  </span>
                  <span className="ml-auto text-[11px] font-semibold text-slate-300">{it.createdAt.slice(0, 10)}</span>
                  <button onClick={() => togglePin(it)} title="고정 토글" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                    <Pin className={`h-4 w-4 ${it.pinned ? "fill-rose-500 text-rose-500" : ""}`} />
                  </button>
                  <button onClick={() => remove(it)} title="삭제" className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1.5 text-sm font-black text-slate-900">{it.title}</p>
                <p className="mt-1 whitespace-pre-line text-xs font-semibold leading-relaxed text-slate-500">{it.body}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}
