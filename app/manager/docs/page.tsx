"use client";

// 문서 조회 — 조회·미리보기 전용. (확정·서명·발송·다운로드·감사ZIP은 '일지 관리')
// 상단: 기간 + 직무지도원 검색. 좌측: 직무지도원별 행 + 문서종류 뱃지(서비스단계 기준 활성).
// 우측: 선택 문서 미리보기.
import { useEffect, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";

const PAGE_SIZE = 10;

type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

// 문서 정의 + 서비스 단계 적용 여부(출근부는 공통, 훈련/적응은 단계별)
const DOC_DEFS: { id: DocType; label: string; short: string; needsTrainee: boolean; kind: "COMMON" | "TRAINING" | "ADAPTATION" }[] = [
  { id: "attendance-sheet",     label: "출근부",          short: "출근부",   needsTrainee: false, kind: "COMMON" },
  { id: "training-daily-log",   label: "훈련일지",        short: "훈련일지", needsTrainee: true,  kind: "TRAINING" },
  { id: "trainee-final-eval",   label: "훈련생 종합평가", short: "훈련평가", needsTrainee: true,  kind: "TRAINING" },
  { id: "adaptation-daily-log", label: "적응지도 일지",   short: "적응일지", needsTrainee: true,  kind: "ADAPTATION" },
  { id: "adaptation-final-eval",label: "적응 종합평가",   short: "적응평가", needsTrainee: true,  kind: "ADAPTATION" },
];

function docActive(kind: "COMMON" | "TRAINING" | "ADAPTATION", serviceStep: string): boolean {
  if (kind === "COMMON") return true;
  return serviceStep === "ADAPTATION" ? kind === "ADAPTATION" : kind === "TRAINING";
}

// 페이지 docType id → DocumentRun.docType(enum) (공단 제출 제외 매칭용)
const RUN_DOC_TYPE: Record<DocType, string> = {
  "attendance-sheet":     "ATTENDANCE_SHEET",
  "training-daily-log":   "TRAINING_DAILY_LOG",
  "trainee-final-eval":   "TRAINEE_COMPREHENSIVE_EVAL",
  "adaptation-daily-log": "POST_EMPLOY_ADAPT_LOG",
  "adaptation-final-eval":"ADAPTATION_COMPREHENSIVE_EVAL",
};
// ★siteId 포함(서버 /api/admin/docs/submitted와 형식 동기) — 멀티현장 워커의 A현장 제출이 B현장 행을 가리지 않게.
function submittedKey(workerId: string, docType: DocType, siteId: string, traineeId?: string) {
  return `${workerId}:${RUN_DOC_TYPE[docType]}:${traineeId ?? ""}:${siteId}`;
}

// 행 = 배정(워커×현장). 멀티현장 워커는 현장 수만큼 행 — 각 행이 해당 현장 문서로 주소지정된다.
interface DocRow {
  assignmentId: string; workerId: string; workerName: string;
  siteId: string; siteName: string; serviceStep: string;
  trainees: { id: string; name: string }[];
}

function defaultPeriod() {
  const n = new Date(), y = n.getFullYear(), m = String(n.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, n.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

export default function AdminDocsPage() {
  const def = defaultPeriod();
  const [rows, setRows]             = useState<DocRow[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState("");
  const [docType,       setDocType]       = useState<DocType | "">("");
  const [traineeId,     setTraineeId]     = useState("");
  const [periodStart,   setPeriodStart]   = useState(def.start);
  const [periodEnd,     setPeriodEnd]     = useState(def.end);
  const [query,         setQuery]         = useState("");
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  // 공단 제출(SUBMITTED) 완료 → 문서 조회에서 제외할 키 집합
  const [submittedKeys, setSubmittedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoadingWorkers(true);
    // 현장(배정)별 행 — 멀티현장 워커는 배정 수만큼 행(각 현장 문서 주소지정).
    fetch("/api/admin/docs/workers")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setRows(((d.data || []) as Omit<DocRow, "trainees">[]).map((a) => ({ ...a, trainees: [] })));
        }
      })
      .finally(() => setLoadingWorkers(false));
  }, []);

  // 기간이 바뀌면 공단 제출 완료(SUBMITTED) 키 갱신 → 해당 문서는 조회에서 제외
  useEffect(() => {
    fetch(`/api/admin/docs/submitted?periodStart=${periodStart}&periodEnd=${periodEnd}`)
      .then(r => r.json())
      .then(d => { if (d.success) setSubmittedKeys(new Set<string>(d.keys || [])); })
      .catch(() => {});
  }, [periodStart, periodEnd]);

  const row = rows.find(c => c.assignmentId === selectedAssignment);

  // 배정(현장) 선택 시 훈련생 로드 — assignmentId로 해당 현장 재적 훈련생만(멀티현장 타현장 훈련생 혼입 방지)
  useEffect(() => {
    if (!selectedAssignment) return;
    const r = rows.find(c => c.assignmentId === selectedAssignment);
    if (!r) return;
    fetch(`/api/admin/docs/trainees?workerId=${r.workerId}&assignmentId=${r.assignmentId}`)
      .then(res => res.json())
      .then(d => {
        if (d.success && d.trainees) {
          setRows(prev => prev.map(c => c.assignmentId === selectedAssignment ? { ...c, trainees: d.trainees } : c));
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignment]);

  const curDoc = DOC_DEFS.find(d => d.id === docType);
  const needsTrainee = curDoc?.needsTrainee ?? false;
  const ready = !!selectedAssignment && !!docType && (!needsTrainee || !!traineeId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(c => !q || c.workerName.toLowerCase().includes(q) || c.siteName.toLowerCase().includes(q));
  }, [rows, query]);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query]);

  function previewUrl() {
    if (!row) return "";
    // assignmentId 명시 = 이 행(현장)의 배정으로 주소지정(preview C2 — 미지정 시 최신 배정 폴백이라 멀티현장 오지정).
    const p = new URLSearchParams({ workerId: row.workerId, assignmentId: row.assignmentId, docType, periodStart, periodEnd, ...(traineeId ? { traineeId } : {}) });
    return `/api/admin/docs/preview?${p.toString()}`;
  }

  function pickDoc(aId: string, dId: DocType) {
    setSelectedAssignment(aId);
    setDocType(dId);
    setTraineeId("");
  }

  return (
    <div>
      <PageHeader
        title="문서 조회"
        sub="기간을 정하고 직무지도원의 문서를 선택하면 우측에서 바로 조회·미리보기할 수 있습니다. (확정·서명·발송은 ‘일지 관리’)"
      />

      {/* 상단: 기간 + 검색 */}
      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="직무지도원·현장 검색"
          extra={
            <div className="flex items-center gap-1.5">
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={`w-auto ${T.input}`} />
              <span className="text-slate-400">~</span>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={`w-auto ${T.input}`} />
            </div>
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[5fr_7fr]">
        {/* 좌측: 게시판(제목줄 + 직무지도원 행 + 문서 버튼 한 줄) */}
        <div>
          {loadingWorkers ? (
            <p className={T.empty}>불러오는 중…</p>
          ) : filtered.length === 0 ? (
            <p className={T.empty}>{rows.length === 0 ? "배정된 직무지도원이 없습니다." : "조건에 맞는 직무지도원이 없습니다."}</p>
          ) : (
            <div className={T.tableWrap}>
              <table className="w-full">
                <thead>
                  <tr>{["구분", "직무지도원 성명", "현장(사업체)", "문서"].map(h => (
                    <th key={h} className="border-b border-slate-100 bg-slate-50 px-2.5 py-2 text-left text-[13px] font-black text-slate-500 whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {pageItems.map(c => {
                    const isAdapt = c.serviceStep === "ADAPTATION";
                    return (
                      <tr key={c.assignmentId} className={`${T.trBase} ${selectedAssignment === c.assignmentId ? "bg-slate-50" : ""}`}>
                        <td className="px-2.5 py-1.5 align-middle whitespace-nowrap">
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[12px] font-black ${isAdapt ? "bg-teal-50 text-teal-600" : "bg-sky-50 text-sky-600"}`}>{isAdapt ? "적응지도" : "지원훈련"}</span>
                        </td>
                        <td className="px-2.5 py-1.5 align-middle text-[14px] font-bold text-slate-800"><div className="max-w-[120px] truncate">{c.workerName}</div></td>
                        <td className="px-2.5 py-1.5 align-middle text-[13px] text-slate-500"><div className="max-w-[140px] truncate">{c.siteName}</div></td>
                        <td className="px-2.5 py-1.5 align-middle">
                          <div className="flex flex-nowrap items-center gap-2">
                            {DOC_DEFS.map(doc => {
                              const active = docActive(doc.kind, c.serviceStep);
                              const selected = selectedAssignment === c.assignmentId && docType === doc.id;
                              // 훈련생 비요구 문서(출근부)는 버튼 단계에서 제출여부 확정 가능 → 제출됐으면 비활성.
                              const submittedHere = !doc.needsTrainee && submittedKeys.has(submittedKey(c.workerId, doc.id, c.siteId));
                              const disabled = !active || submittedHere;
                              return (
                                <button key={doc.id} disabled={disabled} onClick={() => pickDoc(c.assignmentId, doc.id)}
                                  title={submittedHere ? "공단 제출 완료 — '공단 제출 내역'에서 확인" : undefined}
                                  className={`inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[12px] font-bold transition ${
                                    selected ? "border-slate-950 bg-slate-950 text-white"
                                    : submittedHere ? "border-slate-100 bg-slate-50 text-slate-300 line-through cursor-not-allowed"
                                    : active ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                    : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                                  }`}>
                                  {doc.short}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > 0 && (
            <Pagination className="mt-4" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
          )}
        </div>

        {/* 우측: 선택 문서 미리보기 */}
        <div className="lg:sticky lg:top-4 h-fit space-y-3">
          {!selectedAssignment || !docType ? (
            <div className={`${T.card} text-center`}>
              <p className="py-10 text-sm font-semibold text-slate-300">좌측에서 직무지도원과 문서를<br />선택하면 미리보기가 표시됩니다.</p>
            </div>
          ) : (
            <div className={T.card}>
              {/* 헤더: 직무지도원·현장·문서 + 훈련생 선택(옆) */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    <p className="text-sm font-black text-slate-900">{row?.workerName}{row?.siteName && row.siteName !== "-" ? ` · ${row.siteName}` : ""} · {curDoc?.label}</p>
                    {needsTrainee && (
                      <div className="flex flex-wrap items-center gap-1.5 border-l border-slate-200 pl-5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] font-black text-slate-700">훈련생</span>
                        {(row?.trainees || []).length === 0 ? (
                          <span className="text-xs font-semibold text-slate-400">담당 훈련생 없음</span>
                        ) : (row?.trainees || []).map(t => (
                          <button key={t.id} onClick={() => setTraineeId(t.id)}
                            className={`inline-flex h-7 items-center rounded-md border px-2 text-[12px] font-bold transition ${
                              traineeId === t.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}>
                            {t.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs font-semibold text-slate-400">{periodStart} ~ {periodEnd}</p>
                </div>
              </div>

              {/* 미리보기 */}
              {ready && docType && row && submittedKeys.has(submittedKey(row.workerId, docType, row.siteId, needsTrainee ? traineeId : undefined)) ? (
                <div className="flex h-[120px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
                  <p className="text-sm font-bold text-slate-500">이미 공단에 제출된 문서입니다.</p>
                  <p className="text-xs font-semibold text-slate-400">제출본은 ‘공단 제출 내역’에서 확인하세요. (문서 조회에서는 제출 전 문서만 표시)</p>
                </div>
              ) : ready ? (
                <iframe src={previewUrl()} className="h-[530px] w-full rounded-xl border border-slate-200 bg-slate-100" title="문서 미리보기" />
              ) : (
                <div className="flex h-[100px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50">
                  <p className="text-sm font-semibold text-slate-400">훈련생을 선택하면 미리보기가 표시됩니다.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
