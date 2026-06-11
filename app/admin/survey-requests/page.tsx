"use client";

// 운영자: 직무지도원 평가 요청 관리.
// 계약이 종료된(또는 임박한) 직무지도원 대상자를 한 곳에서 식별하고,
// 에이전시 매니저가 요청하지 않은 건을 운영자가 직접 평가 요청(사업체 담당자 알림톡) 발송.
import { useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { X } from "lucide-react";

const PAGE_SIZE = 10;

const REQ_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  NONE:      { label: "미요청",    tone: "rose" },
  PENDING:   { label: "응답 대기", tone: "amber" },
  RESPONDED: { label: "응답 완료", tone: "emerald" },
  EXPIRED:   { label: "만료",      tone: "slate" },
  CANCELLED: { label: "취소",      tone: "slate" },
};
const BY_LABEL: Record<string, string> = { AUTO: "자동", MANAGER: "매니저", OPERATOR: "운영자" };

interface Target {
  contractId: string; agencyId: string; agencyName: string;
  workerId: string; workerName: string;
  siteName: string | null; recipientName: string | null; recipientPhone: string | null; hasContact: boolean;
  contractStart: string; contractEnd: string; ended: boolean;
  requestStatus: "NONE" | "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";
  requestedBy: "AUTO" | "MANAGER" | "OPERATOR" | null;
  surveyId: string | null; overallScore: number | null; sharedWithAgency: boolean;
  sentAt: string | null; respondedAt: string | null;
}

function SendModal({ target, onClose, onSent }: { target: Target; onClose: () => void; onSent: () => void }) {
  const [recipientName, setRecipientName] = useState(target.recipientName ?? "");
  const [recipientPhone, setRecipientPhone] = useState(target.recipientPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!recipientPhone.trim()) { setError("사업체 담당자 연락처를 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const r = await fetch("/api/admin/system/surveys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: target.contractId, recipientName, recipientPhone }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      alert(d.message);
      onSent(); onClose();
    } catch (e: any) { setError(e.message || "발송 실패"); }
    finally { setSaving(false); }
  }

  return (
    <div className={T.modalOverlay} onClick={() => !saving && onClose()}>
      <div className={T.modalContent} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900">평가 요청 발송</h2>
          <button onClick={() => !saving && onClose()} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
          <p className="font-black text-slate-800">{target.workerName} <span className="font-semibold text-slate-400">· {target.agencyName}</span></p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{target.siteName || "현장 미상"} · 계약종료 {target.contractEnd}</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5"><label className={T.label}>사업체 담당자명 (선택)</label><input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="담당자명" className={`w-full ${T.input}`} /></div>
          <div className="space-y-1.5"><label className={T.label}>사업체 담당자 연락처 * (알림톡 발송)</label><input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="010-1234-5678" className={`w-full ${T.input}`} /></div>
          {!target.hasContact && <p className="text-xs font-semibold text-amber-600">현장에 등록된 담당자 연락처가 없어 직접 입력이 필요합니다.</p>}
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

export default function AdminSurveyRequestsPage() {
  const [items, setItems] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [sendTarget, setSendTarget] = useState<Target | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/admin/system/survey-targets").then(r => r.json()).then(d => { if (d.success) setItems(d.items); }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(t => statusFilter.length === 0 || statusFilter.includes(t.requestStatus))
      .filter(t => !q || t.agencyName.toLowerCase().includes(q) || t.workerName.toLowerCase().includes(q) || (t.siteName ?? "").toLowerCase().includes(q));
  }, [items, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const noneCnt = items.filter(t => t.requestStatus === "NONE").length;
  const pendingCnt = items.filter(t => t.requestStatus === "PENDING").length;
  const respondedCnt = items.filter(t => t.requestStatus === "RESPONDED").length;

  const filters: FilterChip[] = [
    { value: "NONE", label: "미요청", count: noneCnt },
    { value: "PENDING", label: "응답 대기", count: pendingCnt },
    { value: "RESPONDED", label: "응답 완료", count: respondedCnt },
    { value: "EXPIRED", label: "만료", count: items.filter(t => t.requestStatus === "EXPIRED").length },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도원 평가 요청 관리"
        sub="계약이 종료된 직무지도원의 평가 요청 현황입니다. 에이전시 매니저가 요청하지 않은 건을 운영자가 직접 사업체 담당자에게 발송할 수 있습니다."
      />

      <StatCardRow
        cols={3}
        items={[
          { label: "미요청 대상", value: noneCnt, tone: noneCnt > 0 ? "rose" : "slate" },
          { label: "응답 대기", value: pendingCnt, tone: "amber" },
          { label: "응답 완료", value: respondedCnt, tone: "emerald" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="에이전시·직무지도원·사업체 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead><tr>{["에이전시", "직무지도원", "사업체/담당자", "계약종료", "요청상태", "발송"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className={T.tdCenter}>로딩 중...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={6} className={T.tdCenter}>{items.length === 0 ? "평가 요청 대상자가 없습니다." : "조건에 맞는 대상자가 없습니다."}</td></tr>
            : pageItems.map(t => {
              const canSend = t.requestStatus === "NONE" || t.requestStatus === "EXPIRED" || t.requestStatus === "CANCELLED";
              return (
                <tr key={t.contractId} className={T.trBase}>
                  <td className={T.td}>{t.agencyName}</td>
                  <td className={T.td}>{t.workerName}</td>
                  <td className={T.td}>
                    <div className="text-slate-700">{t.siteName || "-"}</div>
                    <div className="text-xs text-slate-400">{t.recipientName || ""} {t.recipientPhone || (t.hasContact ? "" : "연락처 없음")}</div>
                  </td>
                  <td className={`${T.td} whitespace-nowrap`}>
                    {t.contractEnd}
                    {!t.ended && <span className="ml-1 rounded bg-sky-50 px-1 py-0.5 text-[11px] font-bold text-sky-600">임박</span>}
                  </td>
                  <td className={T.td}>
                    <StatusBadge status={t.requestStatus} map={REQ_BADGE} />
                    {t.requestedBy && <span className="ml-1 text-[12px] text-slate-400">{BY_LABEL[t.requestedBy]}</span>}
                    {t.requestStatus === "RESPONDED" && t.overallScore != null && <span className="ml-1 text-[13px] font-bold text-slate-700">{t.overallScore}/5</span>}
                  </td>
                  <td className={T.td}>
                    {canSend
                      ? <button onClick={() => setSendTarget(t)} className="rounded-lg bg-slate-950 px-2.5 py-1 text-xs font-bold text-white hover:bg-slate-800">{t.requestStatus === "NONE" ? "발송" : "재발송"}</button>
                      : <span className="text-xs font-semibold text-slate-300">발송됨</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>

      {sendTarget && <SendModal target={sendTarget} onClose={() => setSendTarget(null)} onSent={load} />}
    </div>
  );
}
