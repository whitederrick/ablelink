"use client";

// 문서 조회·출력 — 위저드式 폐기, 게시판(목록+우측 상세) 재설계.
// 상단: 기간 + 직무지도원 검색. 좌측: 직무지도원별 행 + 문서종류 뱃지(서비스단계 기준 활성).
// 우측: 선택 문서 미리보기 + 다운로드·이메일 발송 + 감사 ZIP.
import { useEffect, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar from "../_components/ListToolbar";

type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

// 문서 정의 + 서비스 단계 적용 여부(출근부는 공통, 훈련/적응은 단계별)
const DOC_DEFS: { id: DocType; label: string; needsTrainee: boolean; kind: "COMMON" | "TRAINING" | "ADAPTATION" }[] = [
  { id: "attendance-sheet",     label: "출근부",          needsTrainee: false, kind: "COMMON" },
  { id: "training-daily-log",   label: "훈련일지",        needsTrainee: true,  kind: "TRAINING" },
  { id: "trainee-final-eval",   label: "훈련생 종합평가", needsTrainee: true,  kind: "TRAINING" },
  { id: "adaptation-daily-log", label: "적응지도 일지",   needsTrainee: true,  kind: "ADAPTATION" },
  { id: "adaptation-final-eval",label: "적응 종합평가",   needsTrainee: true,  kind: "ADAPTATION" },
];

function docActive(kind: "COMMON" | "TRAINING" | "ADAPTATION", serviceStep: string): boolean {
  if (kind === "COMMON") return true;
  return serviceStep === "ADAPTATION" ? kind === "ADAPTATION" : kind === "TRAINING";
}

interface Worker {
  workerId: string; workerName: string; siteName: string; serviceStep: string;
  trainees: { id: string; name: string }[];
}

function defaultPeriod() {
  const n = new Date(), y = n.getFullYear(), m = String(n.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, n.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

export default function AdminDocsPage() {
  const def = defaultPeriod();
  const [workers, setWorkers]       = useState<Worker[]>([]);
  const [selectedWorker, setSelectedWorker] = useState("");
  const [docType,       setDocType]       = useState<DocType | "">("");
  const [traineeId,     setTraineeId]     = useState("");
  const [periodStart,   setPeriodStart]   = useState(def.start);
  const [periodEnd,     setPeriodEnd]     = useState(def.end);
  const [query,         setQuery]         = useState("");
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [toEmail,       setToEmail]       = useState("");
  const [managerEmail,  setManagerEmail]  = useState("");
  const [sending,       setSending]       = useState(false);
  const [sendResult,    setSendResult]    = useState<{ success: boolean; msg: string } | null>(null);
  const [auditLoading,  setAuditLoading]  = useState(false);

  useEffect(() => {
    setLoadingWorkers(true);
    fetch("/api/admin/workers?pageSize=100")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setWorkers((d.data || [])
            .filter((u: any) => u.activeAssignment)
            .map((u: any) => ({
              workerId: u.id, workerName: u.workerName,
              siteName: u.activeAssignment?.siteName || "-",
              serviceStep: u.activeAssignment?.serviceStep || "FIELD_TRAINING",
              trainees: [],
            })));
        }
      })
      .finally(() => setLoadingWorkers(false));
  }, []);

  // 직무지도원 선택 시 훈련생·담당자 이메일 로드
  useEffect(() => {
    if (!selectedWorker) return;
    fetch(`/api/admin/docs/trainees?workerId=${selectedWorker}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.trainees) {
          setWorkers(prev => prev.map(c => c.workerId === selectedWorker ? { ...c, trainees: d.trainees } : c));
        }
      });
    fetch(`/api/admin/docs/manager-email?workerId=${selectedWorker}`)
      .then(r => r.json())
      .then(d => { if (d.success && d.email) { setManagerEmail(d.email); setToEmail(d.email); } });
  }, [selectedWorker]);

  const worker = workers.find(c => c.workerId === selectedWorker);
  const curDoc = DOC_DEFS.find(d => d.id === docType);
  const needsTrainee = curDoc?.needsTrainee ?? false;
  const ready = !!selectedWorker && !!docType && (!needsTrainee || !!traineeId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workers.filter(c => !q || c.workerName.toLowerCase().includes(q) || c.siteName.toLowerCase().includes(q));
  }, [workers, query]);

  function previewUrl() {
    const p = new URLSearchParams({ workerId: selectedWorker, docType, periodStart, periodEnd, ...(traineeId ? { traineeId } : {}) });
    return `/api/admin/docs/preview?${p.toString()}`;
  }
  function handleDownload() { if (ready) window.open(previewUrl(), "_blank"); }

  function pickDoc(wId: string, dId: DocType) {
    setSelectedWorker(wId);
    setDocType(dId);
    setTraineeId("");
    setSendResult(null);
  }

  async function handleSend() {
    if (!toEmail) { alert("수신 이메일을 입력해주세요."); return; }
    setSending(true); setSendResult(null);
    try {
      const res = await fetch("/api/admin/docs/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: selectedWorker, docType, periodStart, periodEnd, traineeId: traineeId || undefined, toEmail }),
      });
      const d = await res.json();
      setSendResult({ success: d.success, msg: d.message || (d.success ? "발송 완료" : "발송 실패") });
    } catch { setSendResult({ success: false, msg: "서버 연결 실패" }); }
    finally { setSending(false); }
  }

  async function handleAuditDownload() {
    if (!selectedWorker) { alert("직무지도원을 선택해주세요."); return; }
    setAuditLoading(true);
    try {
      const p = new URLSearchParams({ workerId: selectedWorker, periodStart, periodEnd });
      const res = await fetch(`/api/admin/audit-package?${p.toString()}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.message || "다운로드 실패");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const nameMatch = cd.match(/filename\*?=(?:UTF-8'')?(.+)/i);
      const filename  = nameMatch ? decodeURIComponent(nameMatch[1].replace(/"/g, "")) : "감사서류.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("서버 연결 실패"); }
    finally { setAuditLoading(false); }
  }

  return (
    <div>
      <PageHeader
        title="문서 조회·출력 (Starter+)"
        sub="기간을 정하고 직무지도원의 문서를 선택하면 우측에서 바로 조회·출력·발송할 수 있습니다. (서명은 ‘제출 문서 확인·확정’)"
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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 좌측: 직무지도원 + 문서 뱃지 목록 */}
        <div className="space-y-2.5">
          {loadingWorkers ? (
            <p className={T.empty}>불러오는 중…</p>
          ) : filtered.length === 0 ? (
            <p className={T.empty}>{workers.length === 0 ? "배정된 직무지도원이 없습니다." : "조건에 맞는 직무지도원이 없습니다."}</p>
          ) : filtered.map(c => {
            const isAdapt = c.serviceStep === "ADAPTATION";
            return (
              <div key={c.workerId}
                className={`rounded-2xl border bg-white p-3.5 transition ${selectedWorker === c.workerId ? "border-slate-950 ring-2 ring-slate-100" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-slate-800">
                  <span className="font-semibold">{c.workerName}</span>
                  <span className="text-[13px] text-slate-500">📍 {c.siteName}</span>
                  <span className={`${T.badge} ${isAdapt ? "bg-violet-50 text-violet-600" : "bg-sky-50 text-sky-600"}`}>
                    {isAdapt ? "적응지도" : "지원고용"}
                  </span>
                  <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" />
                  {DOC_DEFS.map(doc => {
                    const active = docActive(doc.kind, c.serviceStep);
                    const selected = selectedWorker === c.workerId && docType === doc.id;
                    return (
                      <button key={doc.id} disabled={!active}
                        onClick={() => pickDoc(c.workerId, doc.id)}
                        className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-[13px] font-bold transition ${
                          selected ? "border-slate-950 bg-slate-950 text-white"
                          : active ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                        }`}>
                        {doc.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* 우측: 선택 문서 상세(미리보기 + 발송/다운로드 + 감사 ZIP) */}
        <div className="lg:sticky lg:top-4 h-fit space-y-3">
          {!selectedWorker || !docType ? (
            <div className={`${T.card} text-center`}>
              <p className="py-10 text-sm font-semibold text-slate-300">좌측에서 직무지도원과 문서를<br />선택하면 미리보기가 표시됩니다.</p>
            </div>
          ) : (
            <>
              <div className={T.card}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-slate-900">{worker?.workerName} · {curDoc?.label}</p>
                    <p className="text-xs font-semibold text-slate-400">{periodStart} ~ {periodEnd}</p>
                  </div>
                  {ready && <button onClick={handleDownload} className={T.btnPrimary}>📥 PDF 다운로드</button>}
                </div>

                {/* 훈련생 선택(필요 문서) */}
                {needsTrainee && (
                  <div className="mb-3">
                    <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">훈련생 선택</p>
                    {(worker?.trainees || []).length === 0 ? (
                      <p className="text-xs font-semibold text-slate-400">담당 훈련생이 없습니다.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(worker?.trainees || []).map(t => (
                          <button key={t.id} onClick={() => setTraineeId(t.id)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition ${
                              traineeId === t.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}>
                            {t.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 미리보기 */}
                {ready ? (
                  <iframe src={previewUrl()} className="h-[480px] w-full rounded-xl border border-slate-200 bg-slate-100" title="문서 미리보기" />
                ) : (
                  <div className="flex h-[120px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50">
                    <p className="text-sm font-semibold text-slate-400">훈련생을 선택하면 미리보기가 표시됩니다.</p>
                  </div>
                )}

                {/* 이메일 발송 */}
                {ready && (
                  <div className="mt-3">
                    <div className="flex gap-2">
                      <input type="email" value={toEmail} onChange={e => { setToEmail(e.target.value); setSendResult(null); }}
                        placeholder={managerEmail ? `담당자: ${managerEmail}` : "수신 이메일 주소"}
                        className={`flex-1 ${T.input}`} />
                      <button onClick={handleSend} disabled={sending}
                        className="whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
                        {sending ? "발송 중..." : "📧 발송"}
                      </button>
                    </div>
                    {sendResult && (
                      <p className={`mt-2 text-sm font-semibold ${sendResult.success ? "text-emerald-600" : "text-rose-600"}`}>
                        {sendResult.success ? "✅" : "❌"} {sendResult.msg}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 감사 대응 서류 패키지 */}
              <div className={`${T.card} border-amber-100 bg-amber-50`}>
                <p className="mb-1 text-sm font-black text-amber-900">감사 대응 서류 패키지 (STANDARD+)</p>
                <p className="mb-3 text-xs font-semibold text-amber-700">
                  위 기간의 모든 문서(출근부 + 훈련생별 일지·종합평가)를 ZIP으로 일괄 다운로드합니다.
                </p>
                <button onClick={handleAuditDownload} disabled={auditLoading}
                  className="w-full rounded-xl bg-amber-600 py-2.5 text-sm font-black text-white transition hover:bg-amber-700 disabled:opacity-60">
                  {auditLoading ? "생성 중… (잠시 기다려주세요)" : "📦 전체 서류 ZIP 다운로드"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
