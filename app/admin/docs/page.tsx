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

interface Coach {
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
  const [coaches,       setCoaches]       = useState<Coach[]>([]);
  const [selectedCoach, setSelectedCoach] = useState("");
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

  useEffect(() => {
    setLoadingCoaches(true);
    fetch("/api/admin/coaches?pageSize=100")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setCoaches((d.data || [])
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
    if (!selectedCoach) return;
    fetch(`/api/admin/docs/trainees?coachUserId=${selectedCoach}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.trainees) {
          setCoaches(prev => prev.map(c => c.userId === selectedCoach ? { ...c, trainees: d.trainees } : c));
        }
      });
    fetch(`/api/admin/docs/manager-email?coachUserId=${selectedCoach}`)
      .then(r => r.json())
      .then(d => { if (d.success && d.email) { setManagerEmail(d.email); setToEmail(d.email); } });
  }, [selectedCoach]);

  const coach = coaches.find(c => c.userId === selectedCoach);
  const needsTrainee = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.needsTrainee ?? false;

  function previewUrl() {
    const p = new URLSearchParams({ coachUserId: selectedCoach, docType, periodStart, periodEnd, ...(traineeId ? { traineeId } : {}) });
    return `/api/admin/docs/preview?${p.toString()}`;
  }

  function handleDownload() { window.open(previewUrl(), "_blank"); }

  async function handleSend() {
    if (!toEmail) { alert("수신 이메일을 입력해주세요."); return; }
    setSending(true); setSendResult(null);
    try {
      const res = await fetch("/api/admin/docs/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachUserId: selectedCoach, docType, periodStart, periodEnd, traineeId: traineeId || undefined, toEmail }),
      });
      const d = await res.json();
      setSendResult({ success: d.success, msg: d.message || (d.success ? "발송 완료" : "발송 실패") });
    } catch { setSendResult({ success: false, msg: "서버 연결 실패" }); }
    finally { setSending(false); }
  }

  function handleView() {
    if (!selectedCoach) { alert("직무지도원을 선택해주세요."); return; }
    if (needsTrainee && !traineeId) { alert("훈련생을 선택해주세요."); return; }
    setIframeKey(k => k + 1);
    setMode("view");
  }

  const docLabel = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.label || "문서";

  if (mode === "view") {
    return (
      <div className="flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <button onClick={() => setMode("select")} className={T.btnSecondary}>← 목록으로</button>
          <div className="text-center">
            <p className="font-black text-slate-900">{docLabel}</p>
            <p className="text-xs font-semibold text-slate-400">{coach?.userName} · {periodStart} ~ {periodEnd}</p>
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
          <div className="flex gap-2">
            <button onClick={() => { setMode("select"); setSendResult(null); }}
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
        ) : coaches.length === 0 ? (
          <p className={T.empty}>배정된 직무지도원이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {coaches.map(c => (
              <button key={c.userId} onClick={() => { setSelectedCoach(c.userId); setTraineeId(""); }}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition active:scale-95 ${
                  selectedCoach === c.userId ? "border-slate-950 bg-slate-950" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                }`}>
                <div>
                  <p className={`font-black ${selectedCoach === c.userId ? "text-white" : "text-slate-900"}`}>{c.userName}</p>
                  <p className={`text-xs font-semibold ${selectedCoach === c.userId ? "text-white/70" : "text-slate-400"}`}>📍 {c.siteName}</p>
                </div>
                {selectedCoach === c.userId && <span className="text-lg text-white">✓</span>}
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
      {needsTrainee && selectedCoach && (
        <div className={T.card}>
          <p className="mb-3 text-sm font-black text-slate-900">훈련생 선택</p>
          {(coach?.trainees || []).length === 0 ? (
            <p className={T.empty}>담당 훈련생이 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(coach?.trainees || []).map(t => (
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
    </div>
  );
}
