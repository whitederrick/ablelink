"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { X } from "lucide-react";
import { workerLabel } from "../_format";

type Status = "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";
interface SurveyItem {
  id: string; workerName: string; workerLoginId: string; recipientName: string | null; recipientPhone: string;
  siteName: string | null; status: Status; auto: boolean; sharedWithAgency: boolean;
  overallScore: number | null; comment: string | null;
  sentAt: string | null; respondedAt: string | null; createdAt: string;
}
interface SearchResult { id: string; workerName: string; phoneNumber: string; siteName: string | null; }

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING:   { label: "응답 대기", tone: "amber" },
  RESPONDED: { label: "응답 완료", tone: "emerald" },
  EXPIRED:   { label: "만료",      tone: "slate" },
  CANCELLED: { label: "취소",      tone: "slate" },
};
const PAGE_SIZE = 10;

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
          <h2 className="text-base font-black text-slate-900">직무지도원 만족도 평가 요청</h2>
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
          <button onClick={submit} disabled={saving} className={T.btnPrimary}>{saving ? "발송 중..." : "평가 요청 발송"}</button>
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  function load() { fetch("/api/admin/surveys").then(r => r.json()).then(d => { if (d.success) setItems(d.items); }).catch(() => {}).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(s => statusFilter.length === 0 || statusFilter.includes(s.status))
      .filter(s => !q || s.workerName.toLowerCase().includes(q) || (s.siteName ?? "").toLowerCase().includes(q) || (s.recipientName ?? "").toLowerCase().includes(q) || s.recipientPhone.includes(q));
  }, [items, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const pendingCnt   = items.filter(s => s.status === "PENDING").length;
  const respondedCnt = items.filter(s => s.status === "RESPONDED").length;
  const closedCnt    = items.filter(s => s.status === "EXPIRED" || s.status === "CANCELLED").length;
  const filters: FilterChip[] = [
    { value: "PENDING", label: "응답 대기", count: pendingCnt },
    { value: "RESPONDED", label: "응답 완료", count: respondedCnt },
    { value: "EXPIRED", label: "만료", count: items.filter(s => s.status === "EXPIRED").length },
    { value: "CANCELLED", label: "취소", count: items.filter(s => s.status === "CANCELLED").length },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도원 만족도 평가 (Pro+)"
        sub="사업체 담당자에게 직무지도원 만족도 평가를 발송합니다. 결과는 운영자가 관리하며 공유 시 점수가 표시됩니다."
        actions={<button onClick={() => setShowReq(true)} className={T.btnPrimary}>+ 평가 요청</button>}
      />
      {lastUrl && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex-1"><p className="text-sm font-black text-emerald-700">조사가 생성되었습니다</p><p className="mt-0.5 break-all text-xs font-semibold text-slate-600">{lastUrl}</p></div>
          <button onClick={() => { navigator.clipboard.writeText(lastUrl); alert("복사되었습니다."); }} className="whitespace-nowrap rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">링크 복사</button>
        </div>
      )}

      <StatCardRow
        cols={4}
        items={[
          { label: "전체", value: items.length },
          { label: "응답 대기", value: pendingCnt, tone: "amber" },
          { label: "응답 완료", value: respondedCnt, tone: "emerald" },
          { label: "만료·취소", value: closedCnt, tone: "slate" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="직무지도원·사업체·담당자 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead><tr>{["직무지도원 성명(아이디)", "사업체명", "사업체 담당자", "상태", "결과", "요청일"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className={T.tdCenter}>로딩 중...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={6} className={T.tdCenter}>{items.length === 0 ? "요청한 조사가 없습니다." : "조건에 맞는 조사가 없습니다."}</td></tr>
            : pageItems.map(s => {
              return (
                <tr key={s.id} className={T.trBase}>
                  <td className={T.td}>{workerLabel(s.workerName, s.workerLoginId)}</td>
                  <td className={T.td}>{s.siteName || "-"}</td>
                  <td className={T.td}>{s.recipientName || "-"}{s.recipientPhone ? ` (${s.recipientPhone})` : ""}</td>
                  <td className={T.td}><StatusBadge status={s.status} map={STATUS_BADGE} />{s.auto && <span className="ml-1 text-[13px] text-slate-500">자동</span>}</td>
                  <td className={T.td}>{s.status === "RESPONDED" ? (s.sharedWithAgency && s.overallScore != null ? <span className="font-semibold text-slate-800">종합 {s.overallScore}/5</span> : <span className="text-slate-500">운영자 확인</span>) : "-"}</td>
                  <td className={T.td}>{s.createdAt.slice(0, 10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>
      {showReq && <RequestModal onClose={() => setShowReq(false)} onCreated={(url) => { setLastUrl(url); load(); }} />}
    </div>
  );
}
