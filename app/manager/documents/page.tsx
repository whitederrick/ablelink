"use client";

// 매니저 문서 허브 — 직무지도원이 제출한 문서를 한 곳에서 조회 → 확정 → 서명.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "../_components/PageHeader";

type Item = {
  id: string;
  docLabel: string;
  traineeName: string | null;
  workerName: string;
  siteName: string;
  periodStart: string;
  periodEnd: string;
  signStage: string;
  currentVersionId: string | null;
  versionNo: number | null;
  versionCount: number;
  submittedAt: string | null;
  updatedAt: string;
};

const STAGE: Record<string, { label: string; cls: string }> = {
  SUBMITTED:          { label: "제출완료", cls: "bg-sky-100 text-sky-700" },
  CONFIRMED:          { label: "확정",     cls: "bg-violet-100 text-violet-700" },
  MANAGER_SIGNED:     { label: "서명완료", cls: "bg-emerald-100 text-emerald-700" },
  CHANGES_REQUESTED:  { label: "수정요청", cls: "bg-rose-100 text-rose-700" },
};

export default function ManagerDocumentsHub() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback((query = "") => {
    setLoading(true);
    fetch(`/api/admin/document-runs/inbox${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then(r => r.json())
      .then(d => { if (d.success) setItems(d.items); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function viewPdf(item: Item) {
    if (!item.currentVersionId) { showToast("조회할 버전이 없습니다."); return; }
    window.open(`/api/admin/document-versions/${item.currentVersionId}/pdf`, "_blank", "noopener");
  }

  async function act(id: string, action: string, reason?: string) {
    const res = await fetch(`/api/admin/document-runs/${id}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    return res.json();
  }

  async function handleConfirm(item: Item) {
    if (!confirm(`${item.docLabel}${item.traineeName ? `(${item.traineeName})` : ""} — 내용을 확인하셨나요?\n확정 처리합니다.`)) return;
    setBusy(item.id);
    try {
      const d = await act(item.id, "confirm");
      if (!d.success) { showToast(d.message || "확정 실패"); return; }
      // 확정 후 서명 등록 여부 질의
      if (confirm("확정되었습니다. 지금 매니저 서명을 등록할까요?")) {
        await handleSign(item);
      } else {
        showToast("확정되었습니다.");
        load(q);
      }
    } finally { setBusy(null); }
  }

  async function handleSign(item: Item) {
    setBusy(item.id);
    try {
      const d = await act(item.id, "sign");
      if (!d.success) {
        if (d.needSignature && confirm(`${d.message}\n\n'내 서명' 화면으로 이동할까요?`)) router.push("/manager/signature");
        else showToast(d.message || "서명 실패");
        return;
      }
      showToast("서명까지 완료되었습니다.");
      load(q);
    } finally { setBusy(null); }
  }

  async function handleRequestChanges(item: Item) {
    const reason = prompt("수정요청 사유를 입력하세요 (직무지도원에게 알림으로 전달됩니다):", "");
    if (reason === null) return;
    setBusy(item.id);
    try {
      const d = await act(item.id, "request-changes", reason);
      if (!d.success) { showToast(d.message || "요청 실패"); return; }
      showToast("수정요청을 보냈습니다.");
      load(q);
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="제출 문서 확인" sub="직무지도원이 제출한 출근부·일지를 확인하고 확정·서명합니다." />

      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") load(q); }}
          placeholder="직무지도원명 / 현장명 검색"
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"
        />
        <button onClick={() => load(q)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white active:scale-95">검색</button>
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm font-semibold text-slate-300">불러오는 중…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white py-16 text-center">
          <p className="text-sm font-semibold text-slate-400">제출된 문서가 없습니다.</p>
          <p className="mt-1 text-xs font-semibold text-slate-300">직무지도원이 앱에서 문서를 제출하면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const st = STAGE[item.signStage] ?? { label: item.signStage, cls: "bg-slate-100 text-slate-600" };
            return (
              <div key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-black ${st.cls}`}>{st.label}</span>
                      <span className="text-sm font-black text-slate-900">{item.docLabel}</span>
                      {item.traineeName && <span className="text-sm font-semibold text-slate-500">· {item.traineeName}</span>}
                      {item.versionNo && item.versionNo > 1 && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">v{item.versionNo}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {item.workerName} · {item.siteName} · {item.periodStart}~{item.periodEnd}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <button onClick={() => viewPdf(item)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 active:scale-95">
                      문서 보기
                    </button>
                    {item.signStage === "SUBMITTED" && (
                      <>
                        <button disabled={busy === item.id} onClick={() => handleConfirm(item)} className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-50">확정</button>
                        <button disabled={busy === item.id} onClick={() => handleRequestChanges(item)} className="rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-black text-rose-600 active:scale-95 disabled:opacity-50">수정요청</button>
                      </>
                    )}
                    {item.signStage === "CONFIRMED" && (
                      <button disabled={busy === item.id} onClick={() => handleSign(item)} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-50">서명</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>}
    </div>
  );
}
