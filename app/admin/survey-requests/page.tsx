"use client";

// 운영자: 직무지도원 평가 관리 — 요청 + 결과 통합.
//  · 매니저 만족도 평가와 동일한 '배정(현장 근무) 종료' 워크리스트(전체 위탁기관 + 위탁기관명).
//  · 상태(평가 미요청/평가 요청/평가 완료)·검색·발송 + 평가 완료 행 클릭 시 결과 상세(문항·의견·총점)·위탁기관 전달 토글.
import { useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { X } from "lucide-react";

type ReqStatus = "NONE" | "PENDING" | "RESPONDED" | "EXPIRED" | "CANCELLED";
interface Item {
  assignmentId: string; agencyId: string; agencyName: string; workerId: string; workerName: string; workerLoginId: string;
  siteName: string | null; recipientName: string | null; recipientPhone: string | null; hasContact: boolean;
  startDate: string; endDate: string;
  requestStatus: ReqStatus; requestedBy: string | null; surveyId: string | null;
  totalScore: number | null; overallScore: number | null; sharedWithAgency: boolean;
  sentAt: string | null; respondedAt: string | null;
}
interface Detail {
  id: string; scores: Record<string, number> | null; overallScore: number | null; comment: string | null;
  sharedWithAgency: boolean; totalScore: number | null;
  categoryScores: { name: string; weight: number; score: number }[] | null;
  formSnapshot: { title: string; includeOpinion: boolean; categories: { name: string; weight: number; questions: { text: string; maxScore: number }[] }[] } | null;
}

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  NONE:      { label: "평가 미요청", tone: "rose" },
  PENDING:   { label: "평가 요청",   tone: "amber" },
  RESPONDED: { label: "평가 완료",   tone: "emerald" },
  EXPIRED:   { label: "미회신 종료", tone: "slate" },
  CANCELLED: { label: "취소",       tone: "slate" },
};
const SCORE_LABELS: Record<string, string> = { professionalism: "전문성", diligence: "성실성", communication: "의사소통", support: "지원 적절성" };
function actionOf(s: ReqStatus): "needs" | "requested" | "done" {
  if (s === "PENDING") return "requested";
  if (s === "RESPONDED") return "done";
  return "needs";
}
const PAGE_SIZE = 10;

type FormOpt = { id: string; title: string; isActive: boolean; questionCount: number };
function SendModal({ item, onClose, onSent }: { item: Item; onClose: () => void; onSent: () => void }) {
  const [recipientName, setRecipientName] = useState(item.recipientName ?? "");
  const [recipientPhone, setRecipientPhone] = useState(item.recipientPhone ?? "");
  const [forms, setForms] = useState<FormOpt[]>([]);
  const [formId, setFormId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/admin/eval-forms/options").then(r => r.json()).then(d => {
      if (d.success) { setForms(d.forms); const act = d.forms.find((f: FormOpt) => f.isActive) ?? d.forms[0]; if (act) setFormId(act.id); }
    }).catch(() => {});
  }, []);
  async function submit() {
    if (!recipientPhone.trim()) { setError("사업체 담당자 연락처를 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const r = await fetch("/api/admin/system/surveys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId: item.assignmentId, recipientName, recipientPhone, formId: formId || undefined }) });
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
          <p className="font-black text-slate-800">{item.workerName} <span className="font-semibold text-slate-400">· {item.agencyName}</span></p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{item.siteName || "현장 미상"} · 배정 종료 {item.endDate}</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className={T.label}>평가표</label>
            {forms.length === 0
              ? <p className="text-xs font-semibold text-amber-600">등록된 평가표가 없습니다. 평가표 관리에서 먼저 등록하세요.</p>
              : <select value={formId} onChange={e => setFormId(e.target.value)} className={`w-full ${T.input}`}>
                  {forms.map(f => <option key={f.id} value={f.id}>{f.title}{f.isActive ? " · 활성" : ""} ({f.questionCount}문항)</option>)}
                </select>}
          </div>
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
    fetch(`/api/admin/system/survey-targets?${params}`).then(r => r.json()).then(d => { if (d.success) { setList(d.items); setTotal(d.total); } }).catch(() => {}).finally(() => setLoading(false));
  }, [pp, debQ]);
  const pages = Math.max(1, Math.ceil(total / PICK_SIZE));
  return (
    <div className={T.modalOverlay} onClick={onClose}>
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">평가 요청 — 대상 선택 <span className="text-sm font-semibold text-slate-400">({total})</span></h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">근무(배정)가 종료됐고 아직 평가를 요청하지 않은 직무지도원입니다. (전체 위탁기관)</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="직무지도원·현장·위탁기관 검색" className={`mb-3 w-full ${T.input}`} />
        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-100">
          {loading ? <p className="px-4 py-10 text-center text-sm font-semibold text-slate-300">불러오는 중...</p>
          : list.length === 0 ? <p className="px-4 py-10 text-center text-sm font-semibold text-slate-300">평가 미요청 대상이 없습니다.</p>
          : list.map(it => (
            <button key={it.assignmentId} onClick={() => onPick(it)} className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-sky-50">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">{it.workerName} <span className="font-semibold text-slate-400">· {it.agencyName}</span>
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

// 평가 완료 결과 상세 — 기본: 종합·영역 요약. '상세 항목별 결과 보기' → 같은 모달에서 문항별(배점/평가) 펼침.
function ResultDetail({ d, onToggleShare }: { d: Detail; onToggleShare: () => void }) {
  const [showItems, setShowItems] = useState(false);
  const hasForm = !!d.formSnapshot && d.totalScore != null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {d.totalScore != null
          ? <span className="rounded-xl bg-sky-600 px-3 py-1.5 text-sm font-black text-white">종합 {d.totalScore}/100</span>
          : d.overallScore != null ? <span className="rounded-xl bg-amber-500 px-3 py-1.5 text-sm font-black text-white">종합 {d.overallScore}/5</span> : null}
        {d.formSnapshot && <span className="text-xs font-semibold text-slate-400">{d.formSnapshot.title}</span>}
        <div className="ml-auto flex items-center gap-2">
          {hasForm && (
            <button onClick={() => setShowItems(s => !s)} className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-xs font-bold text-sky-700 hover:bg-sky-50">
              {showItems ? "요약만 보기" : "상세 항목별 결과 보기"}
            </button>
          )}
          <button onClick={onToggleShare} className={`rounded-lg px-2.5 py-1 text-xs font-bold ${d.sharedWithAgency ? "bg-emerald-50 text-emerald-600" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{d.sharedWithAgency ? "위탁기관 전달됨 ✓" : "위탁기관 전달하기"}</button>
        </div>
      </div>
      {hasForm ? (
        <div className={showItems ? "space-y-2" : "grid gap-2 lg:grid-cols-2"}>
          {d.formSnapshot!.categories.map((cat, ci) => {
            const cs = d.categoryScores?.find(c => c.name === cat.name);
            return (
              <div key={ci} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <p className="min-w-0 truncate text-sm font-black text-slate-800">{ci + 1}. {cat.name}</p>
                  <span className="flex flex-shrink-0 items-center gap-2">
                    {(() => { const f = Math.max(0, Math.min(5, Math.round((cat.weight ? (cs?.score ?? 0) / cat.weight : 0) * 5))); return (
                      <span className="whitespace-nowrap text-sm leading-none tracking-[0.05em]"><span className="text-amber-400">{"★".repeat(f)}</span><span className="text-slate-200">{"★".repeat(5 - f)}</span></span>
                    ); })()}
                    <span className="w-[58px] text-right text-sm font-black tabular-nums text-sky-700">{cs ? cs.score : 0}<span className="text-xs font-semibold text-slate-400">/{cat.weight}</span></span>
                  </span>
                </div>
                {showItems && (
                  <div className="divide-y divide-slate-50 border-t border-slate-100">
                    {cat.questions.map((q, qi) => (
                      <div key={qi} className="flex items-center justify-between gap-3 px-3.5 py-2">
                        <span className="text-[13px] text-slate-700">{qi + 1}. {q.text}</span>
                        <span className="flex flex-shrink-0 items-center gap-2.5 text-[13px]">
                          <span className="text-slate-400">배점 {q.maxScore}</span>
                          <span className="font-black text-amber-500">평가 ★ {d.scores?.[`${ci}_${qi}`] ?? "-"}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {d.scores && Object.entries(d.scores).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center"><p className="text-[11px] font-semibold text-slate-400">{SCORE_LABELS[k] || k}</p><p className="text-lg font-black text-slate-800">{v}<span className="text-xs text-slate-400">/5</span></p></div>
          ))}
        </div>
      )}
      {d.comment && <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11px] font-semibold text-slate-400">사업체 담당자 의견</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{d.comment}</p></div>}
    </div>
  );
}

export default function AdminEvalManagePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ needs: 0, requested: 0, done: 0 });
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const reload = () => setTick(t => t + 1);
  const [showPicker, setShowPicker] = useState(false);
  const [sendItem, setSendItem] = useState<Item | null>(null);
  const [detailItem, setDetailItem] = useState<Item | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedQuery(query), 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => { setPage(1); }, [debouncedQuery, stateFilter]);
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (stateFilter.length) params.set("state", stateFilter.join(","));
    Promise.all([
      fetch(`/api/admin/system/survey-targets?${params}`).then(r => r.json()),
      fetch("/api/admin/system/surveys").then(r => r.json()),
    ]).then(([wl, sv]) => {
      if (wl.success) { setItems(wl.items); setTotal(wl.total); setCounts(wl.counts); }
      if (sv.success) {
        const map: Record<string, Detail> = {};
        for (const s of sv.items) map[String(s.id)] = s;
        setDetails(map);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [page, debouncedQuery, stateFilter, tick]);

  async function toggleShare(d: Detail) {
    await fetch("/api/admin/system/surveys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id, sharedWithAgency: !d.sharedWithAgency }) });
    setDetails(prev => ({ ...prev, [d.id]: { ...d, sharedWithAgency: !d.sharedWithAgency } }));
    setItems(prev => prev.map(it => it.surveyId === d.id ? { ...it, sharedWithAgency: !d.sharedWithAgency } : it));
  }

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
        title="직무지도원 평가 관리"
        sub="근무(배정)가 종료된 직무지도원의 평가 요청·결과를 한 곳에서 관리합니다(전체 위탁기관). 평가 완료 건은 행을 눌러 점수·의견을 확인하고, 위탁기관 전달 여부를 설정합니다."
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

      <ListToolbar query={query} onQueryChange={setQuery} placeholder="직무지도원·현장·위탁기관 검색" filters={filters} selected={stateFilter} onToggleFilter={toggle} />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1180px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[140px]" />{/* 위탁기관 */}
            <col className="w-[110px]" />{/* 직무지도원 */}
            <col className="w-[150px]" />{/* 현장(사업체) */}
            <col className="w-[120px]" />{/* 사업체 담당자 성명 */}
            <col className="w-[130px]" />{/* 전화번호 */}
            <col className="w-[110px]" />{/* 배정 종료 */}
            <col className="w-[110px]" />{/* 진행 상태 */}
            <col className="w-[110px]" />{/* 결과 */}
            <col className="w-[100px]" />{/* 관리 */}
          </colgroup>
          <thead><tr>{["위탁기관", "직무지도원", "현장(사업체)", "사업체 담당자 성명", "전화번호", "배정 종료", "진행 상태", "결과", "관리"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className={T.tdCenter}>로딩 중...</td></tr>
            : items.length === 0 ? <tr><td colSpan={9} className={T.tdCenter}>{total === 0 ? "근무 종료된 직무지도원이 없습니다." : "조건에 맞는 대상이 없습니다."}</td></tr>
            : items.map(it => {
              const act = actionOf(it.requestStatus);
              return (
                <tr key={it.assignmentId} className={`${T.trBase} ${act === "done" ? "cursor-pointer hover:bg-slate-50" : ""}`} onClick={() => act === "done" && setDetailItem(it)}>
                  <td className={`${T.td} truncate`}>{it.agencyName}</td>
                  <td className={`${T.td} truncate`}><span className="font-semibold text-slate-800">{it.workerName}</span></td>
                  <td className={`${T.td} truncate`}>{it.siteName || "-"}</td>
                  <td className={`${T.td} truncate`}>{it.recipientName || "-"}</td>
                  <td className={`${T.td} truncate`}>{it.recipientPhone || (it.hasContact ? "-" : <span className="text-slate-300">연락처 없음</span>)}</td>
                  <td className={`${T.td} truncate`}>{it.endDate}</td>
                  <td className={T.td}><StatusBadge status={it.requestStatus} map={STATUS_BADGE} /></td>
                  <td className={`${T.td} truncate`}>{act === "done"
                    ? <span className="font-semibold text-sky-700">{it.totalScore != null ? `${it.totalScore}/100` : it.overallScore != null ? `${it.overallScore}/5` : "집계 대기"}</span>
                    : "-"}</td>
                  <td className={T.td} onClick={e => e.stopPropagation()}>
                    {act === "needs"
                      ? <button onClick={() => setSendItem(it)} className="inline-flex h-7 items-center rounded-lg bg-slate-950 px-2.5 text-[13px] font-bold text-white hover:bg-slate-800">{it.requestStatus === "NONE" ? "발송" : "재발송"}</button>
                      : act === "done"
                        ? <button onClick={() => setDetailItem(it)} className="inline-flex h-7 items-center rounded-lg border border-slate-200 px-2.5 text-[13px] font-bold text-slate-600 hover:bg-slate-50">상세</button>
                        : <span className="text-[13px] text-slate-300">요청됨</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination className="pt-3" page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {showPicker && <RequestPickerModal onPick={(it) => { setShowPicker(false); setSendItem(it); }} onClose={() => setShowPicker(false)} />}
      {sendItem && <SendModal item={sendItem} onClose={() => setSendItem(null)} onSent={reload} />}

      {/* 평가 결과 상세 모달 */}
      {detailItem && (
        <div className={T.modalOverlay} onClick={() => setDetailItem(null)} style={{ zIndex: 1050 }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-black text-slate-900">{detailItem.workerName} <span className="font-semibold text-slate-400">· {detailItem.agencyName}</span></h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-400">{detailItem.siteName || "현장 미상"} · 배정 종료 {detailItem.endDate}</p>
              </div>
              <button onClick={() => setDetailItem(null)} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto pr-1">
              {(() => {
                const d = detailItem.surveyId ? details[detailItem.surveyId] : undefined;
                return d
                  ? <ResultDetail d={d} onToggleShare={() => toggleShare(d)} />
                  : <p className="py-10 text-center text-sm font-semibold text-slate-400">결과를 불러오는 중...</p>;
              })()}
            </div>
            <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
              <button onClick={() => setDetailItem(null)} className={T.btnSecondary}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
