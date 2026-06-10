"use client";

// 매니저 문서 허브 — 직무지도원이 제출한 문서를 한 곳에서 조회 → 확정 → 서명.
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [preview, setPreview] = useState<Item | null>(null);
  const [zipping, setZipping] = useState(false);
  const [versions, setVersions] = useState<{ id: string; versionNo: number; createdAt: string }[]>([]);
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);

  function openPreview(item: Item) {
    setPreview(item);
    setViewVersionId(item.currentVersionId);
    setVersions([]);
    // 버전 이력 조회(과거 버전 포함)
    fetch(`/api/admin/document-versions?runId=${item.id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setVersions((d.items || []).map((v: any) => ({ id: String(v.id), versionNo: v.versionNo, createdAt: v.createdAt })));
      })
      .catch(() => {});
  }

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

  const summary = useMemo(() => {
    const c = { SUBMITTED: 0, CONFIRMED: 0, MANAGER_SIGNED: 0, CHANGES_REQUESTED: 0 } as Record<string, number>;
    for (const it of items) if (c[it.signStage] != null) c[it.signStage]++;
    return c;
  }, [items]);

  function fileNameOf(item: Item) {
    return `${item.docLabel}_${item.workerName}${item.traineeName ? `_${item.traineeName}` : ""}_${item.periodStart}_${item.periodEnd}.pdf`;
  }

  async function downloadPdf(item: Item) {
    if (!item.currentVersionId) { showToast("다운로드할 버전이 없습니다."); return; }
    try {
      const res = await fetch(`/api/admin/document-versions/${item.currentVersionId}/pdf`);
      if (!res.ok) { showToast("다운로드 실패"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileNameOf(item); a.click();
      URL.revokeObjectURL(url);
    } catch { showToast("다운로드 실패"); }
  }

  async function downloadAll() {
    if (items.length === 0) { showToast("다운로드할 문서가 없습니다."); return; }
    setZipping(true);
    try {
      const res = await fetch(`/api/admin/document-runs/zip${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (!res.ok) { showToast("전체 다운로드 실패"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `제출문서_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      URL.revokeObjectURL(url);
    } catch { showToast("전체 다운로드 실패"); }
    finally { setZipping(false); }
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
      if (confirm("확정되었습니다. 지금 매니저 서명을 등록할까요?")) {
        await handleSign(item);
      } else { showToast("확정되었습니다."); load(q); }
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
      showToast("서명까지 완료되었습니다."); setPreview(null); load(q);
    } finally { setBusy(null); }
  }

  async function handleRequestChanges(item: Item) {
    const reason = prompt("수정요청 사유를 입력하세요 (직무지도원에게 알림으로 전달됩니다):", "");
    if (reason === null) return;
    setBusy(item.id);
    try {
      const d = await act(item.id, "request-changes", reason);
      if (!d.success) { showToast(d.message || "요청 실패"); return; }
      showToast("수정요청을 보냈습니다."); setPreview(null); load(q);
    } finally { setBusy(null); }
  }

  const SUMMARY_CARDS = [
    { key: "SUBMITTED", label: "제출완료", cls: "text-sky-600" },
    { key: "CONFIRMED", label: "확정", cls: "text-violet-600" },
    { key: "MANAGER_SIGNED", label: "서명완료", cls: "text-emerald-600" },
    { key: "CHANGES_REQUESTED", label: "수정요청", cls: "text-rose-600" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="제출 문서 확인·확정 (Starter+)" sub="직무지도원이 제출한 출근부·일지를 확인하고 확정·서명합니다." />

      {/* 상태 요약 */}
      <div className="grid grid-cols-4 gap-2">
        {SUMMARY_CARDS.map(c => (
          <div key={c.key} className="rounded-2xl border border-slate-100 bg-white p-3 text-center">
            <p className={`text-xl font-black leading-none ${c.cls}`}>{summary[c.key] ?? 0}</p>
            <p className="mt-1 text-[11px] font-black text-slate-400">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") load(q); }}
          placeholder="직무지도원명 / 현장명 검색"
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"
        />
        <button onClick={() => load(q)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white active:scale-95">검색</button>
        <button onClick={downloadAll} disabled={zipping || items.length === 0} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 active:scale-95 disabled:opacity-50">
          {zipping ? "압축 중…" : "전체 다운로드"}
        </button>
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
                    <button onClick={() => openPreview(item)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 active:scale-95">문서 보기</button>
                    <button onClick={() => downloadPdf(item)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 active:scale-95">다운로드</button>
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

      {/* 문서 보기 모달 */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setPreview(null)}>
          <div className="flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">
                  {preview.docLabel}{preview.traineeName ? ` · ${preview.traineeName}` : ""}
                  {preview.versionNo && preview.versionNo > 1 ? ` (v${preview.versionNo})` : ""}
                </p>
                <p className="truncate text-xs font-semibold text-slate-400">{preview.workerName} · {preview.periodStart}~{preview.periodEnd}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => downloadPdf(preview)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 active:scale-95">다운로드</button>
                {preview.signStage === "SUBMITTED" && (
                  <>
                    <button disabled={busy === preview.id} onClick={() => handleConfirm(preview)} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-50">확정</button>
                    <button disabled={busy === preview.id} onClick={() => handleRequestChanges(preview)} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-black text-rose-600 active:scale-95 disabled:opacity-50">수정요청</button>
                  </>
                )}
                {preview.signStage === "CONFIRMED" && (
                  <button disabled={busy === preview.id} onClick={() => handleSign(preview)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-50">서명</button>
                )}
                <button onClick={() => setPreview(null)} className="rounded-lg px-2 py-1.5 text-sm font-black text-slate-400 active:scale-95">✕</button>
              </div>
            </div>
            {/* 버전 이력 — 과거 버전 조회 */}
            {versions.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 bg-slate-50 px-4 py-2">
                <span className="shrink-0 text-[11px] font-black text-slate-400">버전</span>
                {versions.map(v => {
                  const isLatest = v.id === preview.currentVersionId;
                  const active = v.id === viewVersionId;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setViewVersionId(v.id)}
                      title={new Date(v.createdAt).toLocaleString("ko-KR")}
                      className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-black transition ${active ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
                    >
                      v{v.versionNo}{isLatest ? " (최신)" : ""}
                    </button>
                  );
                })}
              </div>
            )}
            {viewVersionId ? (
              <iframe src={`/api/admin/document-versions/${viewVersionId}/pdf`} className="flex-1 border-0 bg-slate-100" title="문서 미리보기" />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm font-semibold text-slate-400">조회할 버전이 없습니다.</div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-8 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>}
    </div>
  );
}
