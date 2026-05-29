"use client";

import { useEffect, useState } from "react";
import { Megaphone, Plus, X, RefreshCw } from "lucide-react";
import { T } from "../_styles";

type Announcement = {
  id: string; title: string; body: string; type: string;
  sentCount: number; adminLogin: string | null; createdAt: string;
};

const TYPE_COLORS: Record<string, string> = {
  INFO:        "bg-sky-100 text-sky-700",
  MAINTENANCE: "bg-amber-100 text-amber-700",
  URGENT:      "bg-rose-100 text-rose-700",
};
const TYPE_LABELS: Record<string, string> = {
  INFO: "일반", MAINTENANCE: "점검", URGENT: "긴급",
};

export default function AnnouncementsPage() {
  const [list, setList]       = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", type: "INFO" });
  const [sending, setSending] = useState(false);
  const [toast, setToast]     = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>시스템 공지</h1>
          <p className={T.pageSub}>전체 직무지도원에게 공지를 발송합니다</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className={T.btnSecondary + " flex items-center gap-1.5"}>
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => setShowForm(true)} className={T.btnPrimary + " flex items-center gap-2"}>
            <Plus className="h-4 w-4" />공지 발송
          </button>
        </div>
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
      ) : list.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">발송된 공지가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {list.map(a => (
            <div key={a.id} className="rounded-xl border border-slate-100 bg-white">
              <button
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className={`${T.badge} ${TYPE_COLORS[a.type] ?? "bg-slate-100 text-slate-600"} flex-shrink-0`}>
                  {TYPE_LABELS[a.type] ?? a.type}
                </span>
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
