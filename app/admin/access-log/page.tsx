"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import Pagination from "../_components/Pagination";

const PAGE_SIZE = 20;

type AccessItem = {
  id: string;
  agencyId: string | null;
  actorType: "ADMIN" | "MANAGER";
  actorId: string | null;
  actorLabel: string | null;
  ip: string | null;
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string | null;
  resource: string;
  action: string;
  path: string | null;
  createdAt: string;
};

const ACTOR_MAP: Record<AccessItem["actorType"], { label: string; cls: string }> = {
  ADMIN:   { label: "시스템 관리자",   cls: "bg-emerald-50 text-emerald-600" },
  MANAGER: { label: "위탁기관 담당자", cls: "bg-sky-50 text-sky-600" },
};

// 열람 대상 개인정보(resource) 한글 라벨
const RESOURCE_MAP: Record<string, string> = {
  account:       "급여계좌·본인인증",
  worker_detail: "개인정보 상세",
  payslip:       "급여명세서",
  disability:    "장애정보(리포트)",
  contract:      "근로계약서",
};

const ACTION_MAP: Record<string, { label: string; cls: string }> = {
  view:   { label: "열람",     cls: "bg-sky-50 text-sky-600" },
  print:  { label: "출력",     cls: "bg-amber-50 text-amber-600" },
  export: { label: "내보내기", cls: "bg-amber-50 text-amber-600" },
};

const SUBJECT_MAP: Record<string, string> = { Worker: "직무지도원", Trainee: "훈련생" };

function resourceLabel(r: string) { return RESOURCE_MAP[r] ?? r; }
function actionBadge(action: string) {
  const m = ACTION_MAP[action];
  return <span className={`${T.badge} ${m?.cls ?? "bg-slate-100 text-slate-500"}`}>{m?.label ?? action}</span>;
}

export default function AccessLogPage() {
  const [items, setItems] = useState<AccessItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AccessItem | null>(null);

  const [resourceOptions, setResourceOptions] = useState<string[]>([]);
  const [actionOptions, setActionOptions] = useState<string[]>([]);

  const [fActorType, setFActorType] = useState("");
  const [fResource, setFResource] = useState("");
  const [fAction, setFAction] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fQ, setFQ] = useState("");

  const [applied, setApplied] = useState({ actorType: "", resource: "", action: "", from: "", to: "", q: "" });

  const load = useCallback((p: number, a: typeof applied) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("pageSize", String(PAGE_SIZE));
    if (a.actorType) params.set("actorType", a.actorType);
    if (a.resource) params.set("resource", a.resource);
    if (a.action) params.set("action", a.action);
    if (a.from) params.set("from", a.from);
    if (a.to) params.set("to", a.to);
    if (a.q) params.set("q", a.q);
    fetch(`/api/admin/access-log?${params.toString()}`, { headers: { "x-admin-context": "1" } })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setItems(d.items);
          setTotal(d.total);
          if (Array.isArray(d.resourceOptions)) setResourceOptions(d.resourceOptions);
          if (Array.isArray(d.actionOptions)) setActionOptions(d.actionOptions);
        }
      })
      .catch(e => console.error("[admin/access-log] 로드 실패", e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(page, applied); }, [page, applied, load]);

  function apply() {
    setPage(1);
    setApplied({ actorType: fActorType, resource: fResource, action: fAction, from: fFrom, to: fTo, q: fQ });
  }
  function reset() {
    setFActorType(""); setFResource(""); setFAction(""); setFFrom(""); setFTo(""); setFQ("");
    setPage(1);
    setApplied({ actorType: "", resource: "", action: "", from: "", to: "", q: "" });
  }
  function downloadCsv() {
    const p = new URLSearchParams();
    if (applied.actorType) p.set("actorType", applied.actorType);
    if (applied.resource) p.set("resource", applied.resource);
    if (applied.action) p.set("action", applied.action);
    if (applied.from) p.set("from", applied.from);
    if (applied.to) p.set("to", applied.to);
    if (applied.q) p.set("q", applied.q);
    p.set("format", "csv");
    window.open(`/api/admin/access-log?${p.toString()}`, "_blank");
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="개인정보 접속기록" sub="취급자(운영자·위탁기관 담당자)가 정보주체의 민감·식별 개인정보를 열람/출력한 기록입니다." />

      {/* 필터 툴바 */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <select value={fActorType} onChange={e => setFActorType(e.target.value)} className={`${T.select} w-36`}>
            <option value="">취급자 전체</option>
            <option value="ADMIN">시스템 관리자</option>
            <option value="MANAGER">위탁기관 담당자</option>
          </select>
          <select value={fResource} onChange={e => setFResource(e.target.value)} className={`${T.select} w-44`}>
            <option value="">열람정보 전체</option>
            {resourceOptions.map(o => <option key={o} value={o}>{resourceLabel(o)}</option>)}
          </select>
          <select value={fAction} onChange={e => setFAction(e.target.value)} className={`${T.select} w-32`}>
            <option value="">수행 전체</option>
            {actionOptions.map(o => <option key={o} value={o}>{ACTION_MAP[o]?.label ?? o}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className={`${T.input} w-36`} />
            <span className="text-slate-400">~</span>
            <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className={`${T.input} w-36`} />
          </div>
          <input value={fQ} onChange={e => setFQ(e.target.value)} onKeyDown={e => e.key === "Enter" && apply()}
            placeholder="취급자·정보주체·IP 검색" className={`${T.input} w-52`} />
          <button onClick={apply} className={T.btnPrimary}>조회</button>
          <button onClick={reset} className={T.btnSecondary}>초기화</button>
          <button onClick={downloadCsv} className={`${T.btnSecondary} ml-auto`}>CSV 다운로드</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[150px]" />{/* 접속일시 */}
            <col className="w-[196px]" />{/* 취급자 */}
            <col className="w-[180px]" />{/* 정보주체 */}
            <col className="w-[150px]" />{/* 열람정보 */}
            <col className="w-[72px]" />{/* 수행 */}
            <col className="w-[130px]" />{/* IP */}
          </colgroup>
          <thead>
            <tr>{["접속일시", "취급자", "정보주체", "열람정보", "수행", "접속지(IP)"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={T.tdCenter}>로딩 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className={T.tdCenter}>접속기록이 없습니다.</td></tr>
            ) : items.map(e => (
              <tr key={e.id} onClick={() => setDetail(e)} className={`${T.trBase} cursor-pointer hover:bg-slate-50`}>
                <td className={`${T.td} truncate whitespace-nowrap text-[13px] text-slate-500`}>{new Date(e.createdAt).toLocaleString("ko-KR")}</td>
                <td className={`${T.td} truncate`}>
                  <span className={`${T.badge} ${ACTOR_MAP[e.actorType]?.cls ?? "bg-slate-100 text-slate-500"} mr-1.5`}>{ACTOR_MAP[e.actorType]?.label ?? e.actorType}</span>
                  <span className="text-slate-700">{e.actorLabel || "-"}</span>
                </td>
                <td className={`${T.td} truncate`}>
                  <span className="font-bold text-sky-600">{e.subjectLabel || "-"}</span>
                  <span className="text-slate-400"> {SUBJECT_MAP[e.subjectType] ?? e.subjectType}{e.subjectId ? ` #${e.subjectId}` : ""}</span>
                </td>
                <td className={`${T.td} truncate text-slate-700`}>{resourceLabel(e.resource)}</td>
                <td className={T.td}>{actionBadge(e.action)}</td>
                <td className={`${T.td} truncate whitespace-nowrap text-[13px] font-mono text-slate-500`}>{e.ip || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination className="pt-3" page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {/* 상세 모달 */}
      {detail && (
        <div className={T.modalOverlay} onClick={() => setDetail(null)}>
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={ev => ev.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`${T.badge} ${ACTOR_MAP[detail.actorType]?.cls ?? "bg-slate-100 text-slate-500"}`}>{ACTOR_MAP[detail.actorType]?.label ?? detail.actorType}</span>
                {actionBadge(detail.action)}
              </div>
              <button onClick={() => setDetail(null)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-[104px_1fr] gap-x-3 gap-y-2 text-sm">
              <span className="text-[13px] font-semibold text-slate-400">접속일시</span>
              <span className="font-semibold text-slate-800">{new Date(detail.createdAt).toLocaleString("ko-KR")}</span>
              <span className="text-[13px] font-semibold text-slate-400">취급자(계정)</span>
              <span className="font-semibold text-slate-800">{detail.actorLabel || "-"}{detail.actorId ? ` (id ${detail.actorId})` : ""}</span>
              <span className="text-[13px] font-semibold text-slate-400">위탁기관</span>
              <span className="font-semibold text-slate-800">{detail.agencyId ? `#${detail.agencyId}` : "-"}</span>
              <span className="text-[13px] font-semibold text-slate-400">접속지(IP)</span>
              <span className="font-mono font-semibold text-slate-800">{detail.ip || "-"}</span>
              <span className="text-[13px] font-semibold text-slate-400">정보주체</span>
              <span className="font-semibold text-slate-800">{detail.subjectLabel || "-"} <span className="text-slate-400">{SUBJECT_MAP[detail.subjectType] ?? detail.subjectType}{detail.subjectId ? ` #${detail.subjectId}` : ""}</span></span>
              <span className="text-[13px] font-semibold text-slate-400">열람정보</span>
              <span className="font-semibold text-slate-800">{resourceLabel(detail.resource)}</span>
              <span className="text-[13px] font-semibold text-slate-400">수행업무</span>
              <span className="font-semibold text-slate-800">{ACTION_MAP[detail.action]?.label ?? detail.action}</span>
              {detail.path && <>
                <span className="text-[13px] font-semibold text-slate-400">경로</span>
                <span className="font-mono text-[13px] text-slate-600 break-all">{detail.path}</span>
              </>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
