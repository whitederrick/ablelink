"use client";

import { useEffect, useState } from "react";
import { T } from "../_styles";

type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

const DOC_GROUPS = [
  { group: "출퇴근", docs: [
    { id: "attendance-sheet"      as DocType, label: "출근부",          icon: "📋", needsTrainee: false },
  ]},
  { group: "훈련", docs: [
    { id: "training-daily-log"    as DocType, label: "훈련일지",        icon: "📝", needsTrainee: true  },
    { id: "trainee-final-eval"    as DocType, label: "훈련생 종합평가", icon: "📊", needsTrainee: true  },
  ]},
  { group: "적응지도", docs: [
    { id: "adaptation-daily-log"  as DocType, label: "적응지도 일지",   icon: "📄", needsTrainee: true  },
    { id: "adaptation-final-eval" as DocType, label: "적응지도 종합평가", icon: "📈", needsTrainee: true },
  ]},
];

interface Worker {
  userId: string; userName: string; siteName: string;
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
  const [docType,       setDocType]       = useState<DocType>("attendance-sheet");
  const [traineeId,     setTraineeId]     = useState("");
  const [periodStart,   setPeriodStart]   = useState(def.start);
  const [periodEnd,     setPeriodEnd]     = useState(def.end);
  const [mode,          setMode]          = useState<"select" | "view">("select");
  const [iframeKey,     setIframeKey]     = useState(0);
  const [loadingCoaches, setLoadingCoaches] = useState(false);
  const [toEmail,       setToEmail]       = useState("");
  const [managerEmail,  setManagerEmail]  = useState("");
  const [sending,       setSending]       = useState(false);
  const [sendResult,    setSendResult]    = useState<{ success: boolean; msg: string } | null>(null);
  const [signing,       setSigning]       = useState(false);
  const [signResult,    setSignResult]    = useState<{ success: boolean; msg: string } | null>(null);
  const [auditLoading,  setAuditLoading]  = useState(false);

  useEffect(() => {
    setLoadingCoaches(true);
    fetch("/api/admin/workers?pageSize=100")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setWorkers((d.data || [])
            .filter((u: any) => u.activeAssignment)
            .map((u: any) => ({
              userId: u.id, userName: u.userName,
              siteName: u.activeAssignment?.siteName || "-", trainees: [],
            })));
        }
      })
      .finally(() => setLoadingCoaches(false));
  }, []);

  useEffect(() => {
    if (!selectedWorker) return;
    fetch(`/api/admin/docs/trainees?coachUserId=${selectedWorker}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.trainees) {
          setWorkers(prev => prev.map(c => c.userId === selectedWorker ? { ...c, trainees: d.trainees } : c));
        }
      });
    fetch(`/api/admin/docs/manager-email?coachUserId=${selectedWorker}`)
      .then(r => r.json())
      .then(d => { if (d.success && d.email) { setManagerEmail(d.email); setToEmail(d.email); } });
  }, [selectedWorker]);

  const worker = workers.find(c => c.userId === selectedWorker);
  const needsTrainee = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.needsTrainee ?? false;

  function previewUrl() {
    const p = new URLSearchParams({ coachUserId: selectedWorker, docType, periodStart, periodEnd, ...(traineeId ? { traineeId } : {}) });
    return `/api/admin/docs/preview?${p.toString()}`;
  }

  function handleDownload() { window.open(previewUrl(), "_blank"); }

  async function handleSend() {
    if (!toEmail) { alert("수신 이메일을 입력해주세요."); return; }
    setSending(true); setSendResult(null);
    try {
      const res = await fetch("/api/admin/docs/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachUserId: selectedWorker, docType, periodStart, periodEnd, traineeId: traineeId || undefined, toEmail }),
      });
      const d = await res.json();
      setSendResult({ success: d.success, msg: d.message || (d.success ? "발송 완료" : "발송 실패") });
    } catch { setSendResult({ success: false, msg: "서버 연결 실패" }); }
    finally { setSending(false); }
  }

  function handleView() {
    if (!selectedWorker) { alert("직무지도원을 선택해주세요."); return; }
    if (needsTrainee && !traineeId) { alert("훈련생을 선택해주세요."); return; }
    setIframeKey(k => k + 1);
    setSignResult(null);
    setMode("view");
  }

  async function handleSign() {
    if (!toEmail) { alert("수신 이메일을 입력해주세요."); return; }
    setSigning(true); setSignResult(null);
    try {
      const res = await fetch("/api/admin/docs/sign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachUserId: selectedWorker, docType, periodStart, periodEnd, traineeId: traineeId || undefined, toEmail }),
      });
      const d = await res.json();
      if (d.success && d.pdfBase64) {
        const blob = new Blob([Uint8Array.from(atob(d.pdfBase64), c => c.charCodeAt(0))], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = d.fileName || "signed.pdf"; a.click();
        URL.revokeObjectURL(url);
      }
      setSignResult({ success: d.success, msg: d.message || (d.success ? "서명 완료" : "서명 실패") });
    } catch { setSignResult({ success: false, msg: "서버 연결 실패" }); }
    finally { setSigning(false); }
  }

  const docLabel = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.label || "문서";

  async function handleAuditDownload() {
    if (!selectedWorker) { alert("직무지도원을 선택해주세요."); return; }
    setAuditLoading(true);
    try {
      const p = new URLSearchParams({ coachUserId: selectedWorker, periodStart, periodEnd });
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

  if (mode === "view") {
    return (
      <div className="flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <button onClick={() => setMode("select")} className={T.btnSecondary}>← 목록으로</button>
          <div className="text-center">
            <p className="font-black text-slate-900">{docLabel}</p>
            <p className="text-xs font-semibold text-slate-400">{worker?.userName} · {periodStart} ~ {periodEnd}</p>
          </div>
          <button onClick={handleDownload} className={T.btnPrimary}>📥 PDF 다운로드</button>
        </div>

        <iframe key={iframeKey} src={previewUrl()} className="flex-1 border-none bg-slate-100" title="문서 미리보기" />

        <div className="border-t border-slate-100 bg-white px-5 py-3">
          <div className="mb-2 flex gap-2">
            <input type="email" value={toEmail} onChange={e => { setToEmail(e.target.value); setSendResult(null); }}
              placeholder={managerEmail ? `담당자: ${managerEmail}` : "수신 이메일 주소"}
              className={`flex-1 ${T.input}`} />
            <button onClick={handleSend} disabled={sending}
              className="whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
              {sending ? "발송 중..." : "📧 발송"}
            </button>
          </div>
          {sendResult && (
            <p className={`mb-2 text-sm font-semibold ${sendResult.success ? "text-emerald-600" : "text-rose-600"}`}>
              {sendResult.success ? "✅" : "❌"} {sendResult.msg}
            </p>
          )}

          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-black text-slate-500">에이전시 담당자 서명 후 발송</p>
            <button onClick={handleSign} disabled={signing}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {signing ? "서명 생성 중..." : "✍️ 내 서명 넣어 발송 (서명완료 PDF)"}
            </button>
            {signResult && (
              <p className={`mt-2 text-xs font-semibold ${signResult.success ? "text-emerald-600" : "text-rose-600"}`}>
                {signResult.success ? "✅" : "❌"} {signResult.msg}
              </p>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <button onClick={() => { setMode("select"); setSendResult(null); setSignResult(null); }}
              className={`flex-1 ${T.btnSecondary}`}>← 목록으로</button>
            <button onClick={handleDownload} className={`flex-[2] ${T.btnPrimary}`}>📥 PDF 다운로드</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className={T.pageTitle}>문서 조회</h1>

      {/* 직무지도원 선택 */}
      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-900">직무지도원 선택</p>
        {loadingCoaches ? (
          <p className={T.empty}>불러오는 중...</p>
        ) : workers.length === 0 ? (
          <p className={T.empty}>배정된 직무지도원이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {workers.map(c => (
              <button key={c.userId} onClick={() => { setSelectedWorker(c.userId); setTraineeId(""); }}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition active:scale-95 ${
                  selectedWorker === c.userId ? "border-slate-950 bg-slate-950" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                }`}>
                <div>
                  <p className={`font-black ${selectedWorker === c.userId ? "text-white" : "text-slate-900"}`}>{c.userName}</p>
                  <p className={`text-xs font-semibold ${selectedWorker === c.userId ? "text-white/70" : "text-slate-400"}`}>📍 {c.siteName}</p>
                </div>
                {selectedWorker === c.userId && <span className="text-lg text-white">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 문서 종류 */}
      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-900">문서 종류</p>
        {DOC_GROUPS.map(({ group, docs }) => (
          <div key={group} className="mb-3">
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">{group}</p>
            <div className="flex flex-wrap gap-2">
              {docs.map(d => (
                <button key={d.id} onClick={() => { setDocType(d.id); setTraineeId(""); }}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-95 ${
                    docType === d.id ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}>
                  <span>{d.icon}</span>
                  <span>{d.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 훈련생 선택 */}
      {needsTrainee && selectedWorker && (
        <div className={T.card}>
          <p className="mb-3 text-sm font-black text-slate-900">훈련생 선택</p>
          {(worker?.trainees || []).length === 0 ? (
            <p className={T.empty}>담당 훈련생이 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(worker?.trainees || []).map(t => (
                <button key={t.id} onClick={() => setTraineeId(t.id)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-95 ${
                    traineeId === t.id ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 기간 */}
      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-900">조회 기간</p>
        <div className="flex items-center gap-2">
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={`flex-1 ${T.input}`} />
          <span className="text-slate-400">~</span>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={`flex-1 ${T.input}`} />
        </div>
      </div>

      <button onClick={handleView} className={`w-full py-4 text-base ${T.btnPrimary}`}>
        📄 {docLabel} 조회
      </button>

      {/* 감사 대응 서류 패키지 */}
      {selectedWorker && (
        <div className={`${T.card} border-amber-100 bg-amber-50`}>
          <p className="mb-1 text-sm font-black text-amber-900">감사 대응 서류 패키지 (STANDARD+)</p>
          <p className="mb-3 text-xs font-semibold text-amber-700">
            위 기간의 모든 문서(출근부 + 훈련생별 훈련일지·종합평가·적응지도)를 ZIP으로 일괄 다운로드합니다.
          </p>
          <button
            onClick={handleAuditDownload}
            disabled={auditLoading}
            className="w-full rounded-xl bg-amber-600 py-3 text-sm font-black text-white transition hover:bg-amber-700 disabled:opacity-60"
          >
            {auditLoading ? "생성 중... (잠시 기다려주세요)" : "📦 전체 서류 ZIP 다운로드"}
          </button>
        </div>
      )}
    </div>
  );
}
