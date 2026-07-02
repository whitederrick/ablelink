"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import Pagination from "../_components/Pagination";

const PAGE_SIZE = 20;

type AuditItem = {
  id: string;
  agencyId: string | null;
  actorType: "ADMIN" | "MANAGER" | "WORKER" | "SYSTEM";
  actorId: string | null;
  actorLabel: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string | null;
  payload: unknown;
  createdAt: string;
};

const ACTOR_MAP: Record<AuditItem["actorType"], { label: string; cls: string }> = {
  ADMIN:   { label: "운영자", cls: "bg-emerald-50 text-emerald-600" },
  MANAGER: { label: "매니저", cls: "bg-sky-50 text-sky-600" },
  WORKER:  { label: "워커",   cls: "bg-amber-50 text-amber-600" },
  SYSTEM:  { label: "시스템", cls: "bg-slate-100 text-slate-500" },
};

const ACTION_MAP: Record<string, { label: string; cls: string }> = {
  create:     { label: "생성",     cls: "bg-emerald-50 text-emerald-600" },
  update:     { label: "수정",     cls: "bg-sky-50 text-sky-600" },
  delete:     { label: "삭제",     cls: "bg-rose-50 text-rose-600" },
  upsert:     { label: "upsert",   cls: "bg-violet-50 text-violet-600" },
  updateMany: { label: "일괄수정", cls: "bg-sky-50 text-sky-600" },
  deleteMany: { label: "일괄삭제", cls: "bg-rose-50 text-rose-600" },
};

function actionBadge(action: string) {
  const m = ACTION_MAP[action];
  return <span className={`${T.badge} ${m?.cls ?? "bg-slate-100 text-slate-500"}`}>{m?.label ?? action}</span>;
}

function payloadPreview(payload: unknown): string {
  if (payload == null) return "";
  try {
    const s = typeof payload === "string" ? payload : JSON.stringify(payload);
    return s.length > 120 ? s.slice(0, 120) + "…" : s;
  } catch { return ""; }
}

function prettyJson(payload: unknown): string {
  if (payload == null) return "";
  try {
    const obj = typeof payload === "string" ? JSON.parse(payload) : payload;
    return JSON.stringify(obj, null, 2);
  } catch {
    return typeof payload === "string" ? payload : String(payload);
  }
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AuditItem | null>(null);

  const [entityOptions, setEntityOptions] = useState<string[]>([]);
  const [actionOptions, setActionOptions] = useState<string[]>([]);

  // 입력 중 필터(조회 버튼으로 적용)
  const [fActorType, setFActorType] = useState("");
  const [fEntityType, setFEntityType] = useState("");
  const [fAction, setFAction] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fQ, setFQ] = useState("");

  // 실제 적용된 필터
  const [applied, setApplied] = useState({ actorType: "", entityType: "", action: "", from: "", to: "", q: "" });

  const load = useCallback((p: number, a: typeof applied) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("pageSize", String(PAGE_SIZE));
    if (a.actorType) params.set("actorType", a.actorType);
    if (a.entityType) params.set("entityType", a.entityType);
    if (a.action) params.set("action", a.action);
    if (a.from) params.set("from", a.from);
    if (a.to) params.set("to", a.to);
    if (a.q) params.set("q", a.q);
    fetch(`/api/admin/audit?${params.toString()}`, { headers: { "x-admin-context": "1" } })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setItems(d.items);
          setTotal(d.total);
          if (Array.isArray(d.entityTypeOptions)) setEntityOptions(d.entityTypeOptions);
          if (Array.isArray(d.actionOptions)) setActionOptions(d.actionOptions);
        }
      })
      .catch(e => console.error("[admin/audit] 로드 실패", e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(page, applied); }, [page, applied, load]);

  function apply() {
    setPage(1);
    setApplied({ actorType: fActorType, entityType: fEntityType, action: fAction, from: fFrom, to: fTo, q: fQ });
  }
  function reset() {
    setFActorType(""); setFEntityType(""); setFAction(""); setFFrom(""); setFTo(""); setFQ("");
    setPage(1);
    setApplied({ actorType: "", entityType: "", action: "", from: "", to: "", q: "" });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="감사 로그" sub="시스템의 모든 데이터 변경 이력(누가·언제·무엇을)." />

      {/* 필터 툴바 */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <select value={fActorType} onChange={e => setFActorType(e.target.value)} className={`${T.select} w-32`}>
            <option value="">행위자 전체</option>
            <option value="ADMIN">운영자</option>
            <option value="MANAGER">매니저</option>
            <option value="WORKER">워커</option>
            <option value="SYSTEM">시스템</option>
          </select>
          <select value={fEntityType} onChange={e => setFEntityType(e.target.value)} className={`${T.select} w-40`}>
            <option value="">대상 전체</option>
            {entityOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={fAction} onChange={e => setFAction(e.target.value)} className={`${T.select} w-36`}>
            <option value="">액션 전체</option>
            {actionOptions.map(o => <option key={o} value={o}>{ACTION_MAP[o]?.label ?? o}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className={`${T.input} w-36`} />
            <span className="text-slate-400">~</span>
            <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className={`${T.input} w-36`} />
          </div>
          <input value={fQ} onChange={e => setFQ(e.target.value)} onKeyDown={e => e.key === "Enter" && apply()}
            placeholder="행위자·대상·대상ID 검색" className={`${T.input} w-56`} />
          <button onClick={apply} className={T.btnPrimary}>조회</button>
          <button onClick={reset} className={T.btnSecondary}>초기화</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1080px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[160px]" />{/* 시각 */}
            <col className="w-[150px]" />{/* 행위자 */}
            <col className="w-[200px]" />{/* 대상 */}
            <col className="w-[110px]" />{/* 액션 */}
            <col className="w-[360px]" />{/* 요약/변경 */}
          </colgroup>
          <thead>
            <tr>{["시각", "행위자", "대상", "액션", "요약/변경"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className={T.tdCenter}>감사 로그가 없습니다.</td></tr>
            ) : items.map(e => (
              <tr key={e.id} onClick={() => setDetail(e)} className={`${T.trBase} cursor-pointer hover:bg-slate-50`}>
                <td className={`${T.td} truncate whitespace-nowrap text-[13px] text-slate-500`}>{new Date(e.createdAt).toLocaleString("ko-KR")}</td>
                <td className={`${T.td} truncate`}>
                  <span className={`${T.badge} ${ACTOR_MAP[e.actorType].cls} mr-1.5`}>{ACTOR_MAP[e.actorType].label}</span>
                  <span className="text-slate-700">{e.actorLabel || "-"}</span>
                </td>
                <td className={`${T.td} truncate`}>
                  <span className="font-bold text-sky-600">{e.entityType}</span>
                  {e.entityId ? <span className="text-slate-400"> #{e.entityId}</span> : null}
                </td>
                <td className={T.td}>{actionBadge(e.action)}</td>
                <td className={`${T.td} truncate text-slate-600`}>{e.summary || payloadPreview(e.payload) || <span className="text-slate-300">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination className="pt-3" page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {/* 상세 모달 */}
      {detail && (
        <div className={T.modalOverlay} onClick={() => setDetail(null)}>
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={ev => ev.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`${T.badge} ${ACTOR_MAP[detail.actorType].cls}`}>{ACTOR_MAP[detail.actorType].label}</span>
                {actionBadge(detail.action)}
              </div>
              <button onClick={() => setDetail(null)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 text-sm">
              <span className="text-[13px] font-semibold text-slate-400">시각</span>
              <span className="font-semibold text-slate-800">{new Date(detail.createdAt).toLocaleString("ko-KR")}</span>
              <span className="text-[13px] font-semibold text-slate-400">행위자</span>
              <span className="font-semibold text-slate-800">{detail.actorLabel || "-"}{detail.actorId ? ` (id ${detail.actorId})` : ""}</span>
              <span className="text-[13px] font-semibold text-slate-400">위탁기관</span>
              <span className="font-semibold text-slate-800">{detail.agencyId ? `#${detail.agencyId}` : "-"}</span>
              <span className="text-[13px] font-semibold text-slate-400">대상</span>
              <span className="font-semibold text-slate-800">{detail.entityType}{detail.entityId ? ` #${detail.entityId}` : ""}</span>
              <span className="text-[13px] font-semibold text-slate-400">액션</span>
              <span className="font-semibold text-slate-800">{ACTION_MAP[detail.action]?.label ?? detail.action}</span>
              {detail.summary && <>
                <span className="text-[13px] font-semibold text-slate-400">요약</span>
                <span className="font-semibold text-slate-800">{detail.summary}</span>
              </>}
            </div>
            {detail.payload != null && (
              <div className="mt-4">
                <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Payload</p>
                <pre className="max-h-[45vh] overflow-auto rounded-lg bg-slate-50 p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap break-all">{prettyJson(detail.payload)}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
