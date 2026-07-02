"use client";

// 직무지도원 만족도 평가 — '근무(계약) 종료' 워크리스트.
//  · 목록 = 종료 계약 × 평가요청 상태(평가 미요청/평가 요청/평가 완료). 배정 관리와 같은 계약 키로 자동 동기화.
//  · '평가 요청' 버튼 → 미요청(근무 종료) 직무지도원 목록 + 검색 → 사업체 담당자 자동입력 발송.
import { useEffect, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { X } from "lucide-react";
import { workerLabel } from "../_format";

type ReqStatus = "NONE" | "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";
interface Item {
  assignmentId: string; agencyName: string; workerId: string; workerName: string; workerLoginId: string;
  siteName: string | null; recipientName: string | null; recipientPhone: string | null; hasContact: boolean;
  startDate: string; endDate: string;
  requestStatus: ReqStatus; requestedBy: string | null; surveyId: string | null;
  totalScore: number | null; overallScore: number | null;
  categoryScores: { name: string; weight: number; score: number }[] | null;
  sharedWithAgency: boolean;
  sentAt: string | null; respondedAt: string | null;
}

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  NONE:      { label: "평가 미요청", tone: "rose" },
  PENDING:   { label: "평가 요청",   tone: "amber" },
  RESPONDED: { label: "평가 완료",   tone: "emerald" },
  EXPIRED:   { label: "미회신 종료", tone: "slate" },
  CANCELLED: { label: "취소",       tone: "slate" },
};
// 행동 상태: 재요청 필요(NONE/EXPIRED/CANCELLED) / 요청됨(PENDING) / 완료(RESPONDED)
function actionOf(s: ReqStatus): "needs" | "requested" | "done" {
  if (s === "PENDING") return "requested";
  if (s === "RESPONDED") return "done";
  return "needs";
}
const PAGE_SIZE = 10;

// 평가 요청 발송 모달 — 워크리스트 항목(종료 배정) 기준. 사업체 담당자 자동입력.
// 평가표는 시스템 관리자 소유 — 매니저에겐 노출하지 않고, 발송 시 자동으로 활성 평가표 사용.
function SendModal({ item, onClose, onSent }: { item: Item; onClose: () => void; onSent: () => void }) {
  const [recipientName, setRecipientName] = useState(item.recipientName ?? "");
  const [recipientPhone, setRecipientPhone] = useState(item.recipientPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!recipientPhone.trim()) { setError("사업체 담당자 연락처를 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const r = await fetch("/api/admin/surveys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: item.workerId, assignmentId: item.assignmentId, recipientName, recipientPhone, siteName: item.siteName }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      alert(d.message || "평가 요청을 발송했습니다.");
      onSent(); onClose();
    } catch (e: any) { setError(e.message || "발송 실패"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" onClick={() => !saving && onClose()}>
      <div className={T.modalContent} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900">평가 요청 발송</h2>
          <button onClick={() => !saving && onClose()} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
          <p className="font-black text-slate-800">{item.workerName}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{item.siteName || "현장 미상"} · 배정 종료 {item.endDate}</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5"><label className={T.label}>사업체 담당자명 (선택)</label><input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="담당자명" className={`w-full ${T.input}`} /></div>
          <div className="space-y-1.5"><label className={T.label}>사업체 담당자 연락처 * (알림톡 발송)</label><input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="010-1234-5678" className={`w-full ${T.input}`} /></div>
          {!item.hasContact && <p className="text-xs font-semibold text-amber-600">현장에 등록된 담당자 연락처가 없어 직접 입력이 필요합니다.</p>}
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

// 평가 요청 picker — 미요청(근무 종료) 직무지도원 서버 조회(검색·페이지네이션) → 선택 발송
const PICK_SIZE = 10;
function RequestPickerModal({ onPick, onClose }: { onPick: (it: Item) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [debQ, setDebQ] = useState("");
  const [pp, setPp] = useState(1);
  const [list, setList] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setDebQ(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPp(1); }, [debQ]);
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(pp), pageSize: String(PICK_SIZE), state: "needs" });
    if (debQ.trim()) params.set("q", debQ.trim());
    fetch(`/api/admin/survey-targets?${params}`).then(r => r.json()).then(d => { if (d.success) { setList(d.items); setTotal(d.total); } }).catch(() => {}).finally(() => setLoading(false));
  }, [pp, debQ]);
  const pages = Math.max(1, Math.ceil(total / PICK_SIZE));
  return (
    <div className={T.modalOverlay} onClick={onClose}>
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">평가 요청 — 대상 선택 <span className="text-sm font-semibold text-slate-400">({total})</span></h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">근무(배정)가 종료됐고 아직 평가를 요청하지 않은 직무지도원입니다.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="직무지도원·현장 검색" className={`mb-3 w-full ${T.input}`} />
        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-100">
          {loading ? <p className="px-4 py-10 text-center text-sm font-semibold text-slate-300">불러오는 중...</p>
          : list.length === 0 ? <p className="px-4 py-10 text-center text-sm font-semibold text-slate-300">평가 미요청 대상이 없습니다.</p>
          : list.map(it => (
            <button key={it.assignmentId} onClick={() => onPick(it)} className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-sky-50">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">{it.workerName}
                  {it.requestStatus !== "NONE" && <span className="ml-1.5 align-middle"><StatusBadge status={it.requestStatus} map={STATUS_BADGE} /></span>}
                </p>
                <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">{it.siteName || "현장 미상"} · 배정 종료 {it.endDate}</p>
              </div>
              <span className="flex-shrink-0 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white">{it.requestStatus === "NONE" ? "발송" : "재요청"}</span>
            </button>
          ))}
        </div>
        <Pagination className="pt-3" page={pp} totalPages={pages} total={total} onPageChange={setPp} />
      </div>
    </div>
  );
}

// 만족도 평가 상세 — 행 클릭 시 결과 조회(매니저는 총점+카테고리만, 공유 시).
function ResultDetailModal({ item, onSend, onClose }: { item: Item; onSend: () => void; onClose: () => void }) {
  const act = actionOf(item.requestStatus);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900">만족도 평가 상세</h3>
            <p className="mt-0.5 text-[13px] font-semibold text-slate-400">{item.workerName} · {item.siteName || "현장 미상"} · 배정 종료 {item.endDate}</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <span className="text-sm font-semibold text-slate-500">진행 상태</span>
            <StatusBadge status={item.requestStatus} map={STATUS_BADGE} />
          </div>
          <div className="rounded-xl border border-slate-100 px-4 py-3 text-sm">
            <div className="flex justify-between"><span className="font-semibold text-slate-400">사업체 담당자</span><span className="font-semibold text-slate-700">{item.recipientName || "-"}</span></div>
            <div className="mt-1 flex justify-between"><span className="font-semibold text-slate-400">연락처</span><span className="font-semibold text-slate-700">{item.recipientPhone || "-"}</span></div>
          </div>
          {act === "done" ? (
            item.sharedWithAgency && item.totalScore != null ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-500">종합 점수</span>
                  <span className="text-lg font-black text-sky-600">{item.totalScore}<span className="text-xs text-slate-400">/100</span></span>
                </div>
                {Array.isArray(item.categoryScores) && item.categoryScores.length > 0 && (
                  <div className="space-y-1.5">
                    {item.categoryScores.map((c, i) => (
                      <div key={i} className="rounded-lg border border-slate-100 px-3 py-2">
                        <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-600">{c.name}</span><span className="text-sm font-black text-slate-800">{c.score}<span className="text-xs font-semibold text-slate-400">/{c.weight}</span></span></div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-500" style={{ width: `${c.weight ? Math.round((c.score / c.weight) * 100) : 0}%` }} /></div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs font-semibold text-slate-400">문항별 점수·작성 의견은 비공개입니다(시스템 관리자 보관).</p>
              </>
            ) : (
              <p className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-400">평가는 완료됐습니다. 시스템 관리자 전달(공유) 후 총점·카테고리 점수가 표시됩니다.</p>
            )
          ) : act === "requested" ? (
            <p className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-400">사업체 담당자 응답 대기 중입니다.</p>
          ) : (
            <p className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-400">아직 평가를 요청하지 않았습니다.</p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {act === "needs" && <button onClick={onSend} className={T.btnPrimary}>{item.requestStatus === "NONE" ? "평가 요청 발송" : "재요청"}</button>}
          <button onClick={onClose} className={T.btnSecondary}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export default function ManagerSurveysPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ needs: 0, requested: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const reload = () => setTick(t => t + 1);
  const [showPicker, setShowPicker] = useState(false);
  const [sendItem, setSendItem] = useState<Item | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedQuery(query), 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => { setPage(1); }, [debouncedQuery, stateFilter]);
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (stateFilter.length) params.set("state", stateFilter.join(","));
    fetch(`/api/admin/survey-targets?${params}`).then(r => r.json()).then(d => { if (d.success) { setItems(d.items); setTotal(d.total); setCounts(d.counts); } }).catch(() => {}).finally(() => setLoading(false));
  }, [page, debouncedQuery, stateFilter, tick]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filters: FilterChip[] = [
    { value: "needs", label: "평가 미요청", count: counts.needs },
    { value: "requested", label: "평가 요청", count: counts.requested },
    { value: "done", label: "평가 완료", count: counts.done },
  ];
  const toggle = (v: string) => setStateFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도원 만족도 평가 (Pro+)"
        sub="근무(배정)가 종료된 직무지도원을 대상으로 사업체 담당자에게 만족도 평가를 요청합니다. 배정 관리에서 요청한 건도 여기에 함께 표시됩니다. 결과는 시스템 관리자가 관리하며 공유 시 점수가 표시됩니다."
        actions={<button onClick={() => setShowPicker(true)} className={T.btnPrimary}>+ 평가 요청</button>}
      />

      <StatCardRow
        cols={3}
        items={[
          { label: "평가 미요청", value: counts.needs, tone: counts.needs > 0 ? "rose" : "slate" },
          { label: "평가 요청(대기)", value: counts.requested, tone: "amber" },
          { label: "평가 완료", value: counts.done, tone: "emerald" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="직무지도원·현장(사업체) 검색"
        filters={filters}
        selected={stateFilter}
        onToggleFilter={toggle}
      />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] border-collapse">
          <thead><tr>{["직무지도원 성명(아이디)", "현장(사업체)", "사업체 담당자 성명", "전화번호", "배정 종료", "진행 상태", "결과", "관리"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className={T.tdCenter}>로딩 중...</td></tr>
            : items.length === 0 ? <tr><td colSpan={8} className={T.tdCenter}>{total === 0 ? "근무 종료된 직무지도원이 없습니다." : "조건에 맞는 대상이 없습니다."}</td></tr>
            : items.map(it => {
              const act = actionOf(it.requestStatus);
              return (
                <tr key={it.assignmentId} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetail(it)}>
                  <td className={`${T.td} whitespace-nowrap`}>{workerLabel(it.workerName, it.workerLoginId)}</td>
                  <td className={T.td}><div className="max-w-[150px] truncate">{it.siteName || "-"}</div></td>
                  <td className={`${T.td} whitespace-nowrap`}>{it.recipientName || "-"}</td>
                  <td className={`${T.td} whitespace-nowrap`}>{it.recipientPhone || (it.hasContact ? "-" : <span className="text-slate-300">연락처 없음</span>)}</td>
                  <td className={`${T.td} whitespace-nowrap`}>{it.endDate}</td>
                  <td className={`${T.td} whitespace-nowrap`}><StatusBadge status={it.requestStatus} map={STATUS_BADGE} /></td>
                  <td className={`${T.td} whitespace-nowrap`}>{act === "done"
                    ? (it.sharedWithAgency && it.totalScore != null ? <span className="font-semibold text-sky-700">종합 {it.totalScore}/100</span>
                       : it.sharedWithAgency && it.overallScore != null ? <span className="font-semibold text-slate-800">종합 {it.overallScore}/5</span>
                       : <span className="text-slate-500">시스템 관리자 확인</span>)
                    : "-"}</td>
                  <td className={T.td} onClick={e => e.stopPropagation()}>
                    {act === "needs"
                      ? <button onClick={() => setSendItem(it)} className="inline-flex h-7 items-center rounded-lg bg-slate-950 px-2.5 text-[13px] font-bold text-white hover:bg-slate-800">{it.requestStatus === "NONE" ? "발송" : "재요청"}</button>
                      : <span className="text-[13px] text-slate-300">{act === "requested" ? "요청됨" : "완료"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {showPicker && <RequestPickerModal onPick={(it) => { setShowPicker(false); setSendItem(it); }} onClose={() => setShowPicker(false)} />}
      {sendItem && <SendModal item={sendItem} onClose={() => setSendItem(null)} onSent={reload} />}
      {detail && <ResultDetailModal item={detail} onSend={() => { setSendItem(detail); setDetail(null); }} onClose={() => setDetail(null)} />}
    </div>
  );
}
