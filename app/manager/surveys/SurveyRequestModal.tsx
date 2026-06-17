"use client";

// 직무지도원 만족도 평가 요청 모달 (공용).
//  · 만족도 평가 화면(/manager/surveys): 직무지도원을 검색해 요청.
//  · 직무지도원 관리 상세(WorkerAccountDetailModal): 해당 직무지도원으로 prefill 후 요청.
// 평가 대상 = 직무지도 종료가 임박했거나 종료된 직무지도원. 그래서 직무지도원 관리에서도 바로 요청한다.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { T } from "../_styles";

type SearchResult = { id: string; workerName: string; phoneNumber: string; siteName: string | null };
export type SurveyPrefillWorker = {
  id: string; workerName: string; phoneNumber?: string; siteName?: string | null;
  // 사업체 담당자(알림톡 수신자) 자동 입력 — 배정 진입 시 현장 정보로 채움
  recipientName?: string; recipientPhone?: string;
};

export default function SurveyRequestModal({ prefillWorker, onClose, onCreated }: {
  prefillWorker?: SurveyPrefillWorker | null;
  onClose: () => void;
  onCreated: (url: string) => void;
}) {
  const locked = !!prefillWorker; // prefill 모드 = 대상 직무지도원 고정(검색 숨김)
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [worker, setWorker] = useState<SearchResult | null>(
    prefillWorker ? { id: prefillWorker.id, workerName: prefillWorker.workerName, phoneNumber: prefillWorker.phoneNumber ?? "", siteName: prefillWorker.siteName ?? null } : null
  );
  const [recipientName, setRecipientName] = useState(prefillWorker?.recipientName ?? "");
  const [recipientPhone, setRecipientPhone] = useState(prefillWorker?.recipientPhone ?? "");
  const [siteName, setSiteName] = useState(prefillWorker?.siteName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (locked || query.trim().length < 2 || worker) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/contracts/worker-search?q=${encodeURIComponent(query.trim())}`);
      const d = await r.json();
      if (d.success) setResults(d.items);
    }, 350);
    return () => clearTimeout(t);
  }, [query, worker, locked]);

  async function submit() {
    if (!worker) { setError("평가 대상 직무지도원을 선택하세요."); return; }
    if (!recipientPhone.trim()) { setError("사업체 담당자 연락처를 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const r = await fetch("/api/admin/surveys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: worker.id, recipientName, recipientPhone, siteName: siteName || worker.siteName }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      alert(d.message);
      onCreated(d.surveyUrl); onClose();
    } catch (e: any) { setError(e.message || "요청 실패"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" onClick={() => !saving && onClose()}>
      <div className={T.modalContent} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900">직무지도원 만족도 평가 요청</h2>
          <button onClick={() => !saving && onClose()} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className={T.label}>평가 대상 직무지도원 *</label>
            {worker ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <span className="text-sm font-black text-emerald-700">{worker.workerName}{worker.phoneNumber ? ` · ${worker.phoneNumber}` : ""}</span>
                {!locked && <button onClick={() => { setWorker(null); setQuery(""); }} className="text-xs font-semibold text-slate-500">변경</button>}
              </div>
            ) : (
              <>
                <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="이름/전화번호 검색 (계약 이력 기준)" className={`w-full ${T.input}`} />
                {results.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200">
                    {results.map(r => (
                      <button key={r.id} onClick={() => { setWorker(r); setResults([]); if (r.siteName) setSiteName(r.siteName); }} className="flex w-full items-center justify-between border-b border-slate-50 px-3 py-2 text-left text-sm hover:bg-sky-50 last:border-b-0">
                        <span className="font-bold text-slate-800">{r.workerName}</span><span className="text-xs text-slate-400">{r.phoneNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="space-y-1.5"><label className={T.label}>현장(사업체) (선택)</label><input value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="현장(사업체)명" className={`w-full ${T.input}`} /></div>
          <div className="space-y-1.5"><label className={T.label}>사업체 담당자명 (선택)</label><input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="담당자명" className={`w-full ${T.input}`} /></div>
          <div className="space-y-1.5"><label className={T.label}>사업체 담당자 연락처 * (알림톡 발송)</label><input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="010-1234-5678" className={`w-full ${T.input}`} /></div>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => !saving && onClose()} disabled={saving} className={T.btnSecondary}>취소</button>
          <button onClick={submit} disabled={saving} className={T.btnPrimary}>{saving ? "발송 중..." : "평가 요청 발송"}</button>
        </div>
      </div>
    </div>
  );
}
