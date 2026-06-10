"use client";

import { useEffect, useRef, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import { X } from "lucide-react";

type Status = "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";
interface SurveyItem {
  id: string; workerName: string; recipientName: string | null; recipientPhone: string;
  siteName: string | null; status: Status; auto: boolean; sharedWithAgency: boolean;
  overallScore: number | null; comment: string | null;
  sentAt: string | null; respondedAt: string | null; createdAt: string;
}
interface SearchResult { id: string; workerName: string; phoneNumber: string; siteName: string | null; }

const STATUS_CLS: Record<Status, { label: string; cls: string }> = {
  PENDING:   { label: "응답 대기", cls: "bg-amber-50 text-amber-600" },
  RESPONDED: { label: "응답 완료", cls: "bg-emerald-50 text-emerald-600" },
  EXPIRED:   { label: "만료",      cls: "bg-slate-100 text-slate-500" },
  CANCELLED: { label: "취소",      cls: "bg-slate-100 text-slate-500" },
};

function RequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: (url: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [worker, setWorker] = useState<SearchResult | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [siteName, setSiteName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 2 || worker) { setResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/contracts/worker-search?q=${encodeURIComponent(query.trim())}`);
      const d = await r.json();
      if (d.success) setResults(d.items);
    }, 350);
    return () => clearTimeout(t);
  }, [query, worker]);

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
    <div className={T.modalOverlay} onClick={() => !saving && onClose()}>
      <div className={T.modalContent} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900">만족도 조사 요청</h2>
          <button onClick={() => !saving && onClose()} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className={T.label}>평가 대상 직무지도원 *</label>
            {worker ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <span className="text-sm font-black text-emerald-700">{worker.workerName} · {worker.phoneNumber}</span>
                <button onClick={() => { setWorker(null); setQuery(""); }} className="text-xs font-semibold text-slate-500">변경</button>
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
          <div className="space-y-1.5"><label className={T.label}>사업체명 (선택)</label><input value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="사업체명" className={`w-full ${T.input}`} /></div>
          <div className="space-y-1.5"><label className={T.label}>사업체 담당자명 (선택)</label><input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="담당자명" className={`w-full ${T.input}`} /></div>
          <div className="space-y-1.5"><label className={T.label}>사업체 담당자 연락처 * (알림톡 발송)</label><input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="010-1234-5678" className={`w-full ${T.input}`} /></div>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => !saving && onClose()} disabled={saving} className={T.btnSecondary}>취소</button>
          <button onClick={submit} disabled={saving} className={T.btnPrimary}>{saving ? "발송 중..." : "조사 요청 발송"}</button>
        </div>
      </div>
    </div>
  );
}

export default function ManagerSurveysPage() {
  const [items, setItems] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReq, setShowReq] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  function load() { fetch("/api/admin/surveys").then(r => r.json()).then(d => { if (d.success) setItems(d.items); }).catch(() => {}).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도원 만족도 조사 (Pro+)"
        sub="사업체 담당자에게 직무지도원 만족도 조사를 발송합니다. 결과는 운영자가 관리하며 공유 시 점수가 표시됩니다."
        actions={<button onClick={() => setShowReq(true)} className={T.btnPrimary}>+ 조사 요청</button>}
      />
      {lastUrl && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex-1"><p className="text-sm font-black text-emerald-700">조사가 생성되었습니다</p><p className="mt-0.5 break-all text-xs font-semibold text-slate-600">{lastUrl}</p></div>
          <button onClick={() => { navigator.clipboard.writeText(lastUrl); alert("복사되었습니다."); }} className="whitespace-nowrap rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">링크 복사</button>
        </div>
      )}
      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead><tr>{["직무지도원", "사업체/담당자", "상태", "결과", "요청일"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className={T.tdCenter}>로딩 중...</td></tr>
            : items.length === 0 ? <tr><td colSpan={5} className={T.tdCenter}>요청한 조사가 없습니다.</td></tr>
            : items.map(s => {
              const st = STATUS_CLS[s.status];
              return (
                <tr key={s.id} className={T.trBase}>
                  <td className={`${T.td} font-black text-slate-900`}>{s.workerName}</td>
                  <td className={T.td}><div className="text-slate-700">{s.siteName || "-"}</div><div className="text-xs text-slate-400">{s.recipientName || ""} {s.recipientPhone}</div></td>
                  <td className={T.td}><span className={`${T.badge} ${st.cls}`}>{st.label}</span>{s.auto && <span className="ml-1 text-[10px] text-slate-400">자동</span>}</td>
                  <td className={T.td}>{s.status === "RESPONDED" ? (s.sharedWithAgency && s.overallScore != null ? <span className="font-black text-slate-800">종합 {s.overallScore}/5</span> : <span className="text-xs text-slate-400">운영자 확인</span>) : "-"}</td>
                  <td className={`${T.td} text-xs text-slate-400`}>{s.createdAt.slice(0, 10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showReq && <RequestModal onClose={() => setShowReq(false)} onCreated={(url) => { setLastUrl(url); load(); }} />}
    </div>
  );
}
