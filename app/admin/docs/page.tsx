"use client";
// app/admin/docs/page.tsx
// 관리자 문서 뷰어 — 직무지도원별 jsreport 문서 미리보기 + PDF 다운로드

import { useEffect, useState } from "react";

type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

const DOC_GROUPS = [
  { group: "출퇴근", docs: [
    { id: "attendance-sheet"     as DocType, label: "출근부",          icon: "📋", needsTrainee: false },
  ]},
  { group: "훈련", docs: [
    { id: "training-daily-log"   as DocType, label: "훈련일지",        icon: "📝", needsTrainee: true  },
    { id: "trainee-final-eval"   as DocType, label: "훈련생 종합평가", icon: "📊", needsTrainee: true  },
  ]},
  { group: "적응지도", docs: [
    { id: "adaptation-daily-log" as DocType, label: "적응지도 일지",    icon: "📄", needsTrainee: true  },
    { id: "adaptation-final-eval"as DocType, label: "적응지도 종합평가",icon: "📈", needsTrainee: true  },
  ]},
];

interface Coach {
  userId: string;
  userName: string;
  siteName: string;
  trainees: { id: string; name: string }[];
}

function defaultPeriod() {
  const n = new Date(), y = n.getFullYear(), m = String(n.getMonth()+1).padStart(2,"0");
  const last = new Date(y, n.getMonth()+1, 0).getDate();
  return { start:`${y}-${m}-01`, end:`${y}-${m}-${String(last).padStart(2,"0")}` };
}

export default function AdminDocsPage() {
  const def = defaultPeriod();
  const [coaches,      setCoaches]      = useState<Coach[]>([]);
  const [selectedCoach,setSelectedCoach]= useState("");
  const [docType,      setDocType]      = useState<DocType>("attendance-sheet");
  const [traineeId,    setTraineeId]    = useState("");
  const [periodStart,  setPeriodStart]  = useState(def.start);
  const [periodEnd,    setPeriodEnd]    = useState(def.end);
  const [mode,         setMode]         = useState<"select"|"view">("select");
  const [iframeKey,    setIframeKey]    = useState(0);
  const [loadingCoaches, setLoadingCoaches] = useState(false);
  const [toEmail,      setToEmail]      = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [sending,      setSending]      = useState(false);
  const [sendResult,   setSendResult]   = useState<{success:boolean;msg:string}|null>(null);

  useEffect(() => {
    setLoadingCoaches(true);
    fetch("/api/admin/coaches?pageSize=100")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setCoaches((d.data || [])
            .filter((u: any) => u.activeAssignment)
            .map((u: any) => ({
              userId: u.id,
              userName: u.userName,
              siteName: u.activeAssignment?.siteName || "-",
              trainees: [],
            })));
        }
      })
      .finally(() => setLoadingCoaches(false));
  }, []);

  // 직무지도원 선택 시 훈련생 목록 + 담당자 이메일 조회
  useEffect(() => {
    if (!selectedCoach) return;
    // 훈련생 목록
    fetch(`/api/admin/docs/trainees?coachUserId=${selectedCoach}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.trainees) {
          setCoaches(prev => prev.map(c =>
            c.userId === selectedCoach ? { ...c, trainees: d.trainees } : c
          ));
        }
      });
    // 현장 담당자 이메일
    fetch(`/api/admin/docs/manager-email?coachUserId=${selectedCoach}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.email) {
          setManagerEmail(d.email);
          setToEmail(d.email);
        }
      });
  }, [selectedCoach]);

  const coach = coaches.find(c => c.userId === selectedCoach);
  const needsTrainee = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.needsTrainee ?? false;

  function previewUrl() {
    const p = new URLSearchParams({
      coachUserId: selectedCoach,
      docType, periodStart, periodEnd,
      ...(traineeId ? { traineeId } : {}),
    });
    return `/api/admin/docs/preview?${p.toString()}`;
  }

  function handleDownload() {
    window.open(previewUrl(), "_blank");
  }

  async function handleSend() {
    if (!toEmail) { alert("수신 이메일을 입력해주세요."); return; }
    setSending(true); setSendResult(null);
    try {
      const res = await fetch("/api/admin/docs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachUserId: selectedCoach, docType, periodStart, periodEnd,
          traineeId: traineeId || undefined,
          toEmail,
        }),
      });
      const d = await res.json();
      setSendResult({ success: d.success, msg: d.message || (d.success ? "발송 완료" : "발송 실패") });
    } catch { setSendResult({ success:false, msg:"서버 연결 실패" }); }
    finally { setSending(false); }
  }

  function handleView() {
    if (!selectedCoach) { alert("직무지도원을 선택해주세요."); return; }
    if (needsTrainee && !traineeId) { alert("훈련생을 선택해주세요."); return; }
    setIframeKey(k => k+1);
    setMode("view");
  }

  function handleDownload() {
    window.open(previewUrl(), "_blank");
  }

  async function handleSend() {
    if (!toEmail) { alert("수신 이메일을 입력해주세요."); return; }
    setSending(true); setSendResult(null);
    try {
      const res = await fetch("/api/admin/docs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachUserId: selectedCoach, docType, periodStart, periodEnd,
          traineeId: traineeId || undefined,
          toEmail,
        }),
      });
      const d = await res.json();
      setSendResult({ success: d.success, msg: d.message || (d.success ? "발송 완료" : "발송 실패") });
    } catch { setSendResult({ success:false, msg:"서버 연결 실패" }); }
    finally { setSending(false); }
  }

  const docLabel = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.label || "문서";

  if (mode === "view") {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 60px)" }}>
        {/* 뷰어 헤더 */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 20px", background:"#fff", borderBottom:"1px solid #f0f0f0" }}>
          <button onClick={() => setMode("select")} style={btn.secondary}>← 목록으로</button>
          <div style={{ textAlign:"center" }}>
            <p style={{ margin:0, fontWeight:700, fontSize:15, color:"#111827" }}>{docLabel}</p>
            <p style={{ margin:0, fontSize:12, color:"#9ca3af" }}>{coach?.userName} · {periodStart} ~ {periodEnd}</p>
          </div>
          <button onClick={handleDownload} style={btn.primary}>📥 PDF 다운로드</button>
        </div>
        {/* PDF 뷰어 */}
        <iframe
          key={iframeKey}
          src={previewUrl()}
          style={{ flex:1, border:"none", background:"#e5e7eb" }}
          title="문서 미리보기"
        />
        {/* 하단 액션 */}
        <div style={{ padding:"12px 20px", background:"#fff", borderTop:"1px solid #f0f0f0" }}>
          {/* 이메일 발송 */}
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <input type="email" placeholder={managerEmail ? `담당자: ${managerEmail}` : "수신 이메일 주소"} value={toEmail}
              onChange={e=>{ setToEmail(e.target.value); setSendResult(null); }}
              style={{ flex:1, height:40, border:"1px solid #e5e7eb", borderRadius:8, padding:"0 12px", fontSize:13, outline:"none" }} />
            <button onClick={handleSend} disabled={sending}
              style={{ padding:"0 16px", background:"#16a34a", color:"#fff", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", opacity:sending?0.7:1, flexShrink:0 }}>
              {sending ? "발송 중..." : "📧 발송"}
            </button>
          </div>
          {sendResult && (
            <p style={{ fontSize:13, color:sendResult.success?"#16a34a":"#dc2626", margin:"0 0 8px", fontWeight:600 }}>
              {sendResult.success?"✅":"❌"} {sendResult.msg}
            </p>
          )}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => { setMode("select"); setSendResult(null); }}
              style={{ flex:1, padding:"11px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>
              ← 목록으로
            </button>
            <button onClick={handleDownload}
              style={{ flex:2, padding:"11px", background:"#111827", color:"#fff", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>
              📥 PDF 다운로드
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px" }}>
      <h1 style={{ fontSize:18, fontWeight:700, color:"#111827", margin:"0 0 20px" }}>문서 조회</h1>

      {/* 직무지도원 선택 */}
      <div style={card}>
        <p style={sectionTitle}>직무지도원 선택</p>
        {loadingCoaches ? (
          <p style={{ color:"#9ca3af", fontSize:14 }}>불러오는 중...</p>
        ) : coaches.length === 0 ? (
          <p style={{ color:"#9ca3af", fontSize:14 }}>배정된 직무지도원이 없습니다.</p>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {coaches.map(c => (
              <button key={c.userId} onClick={() => { setSelectedCoach(c.userId); setTraineeId(""); }}
                style={{ ...coachBtn, ...(selectedCoach === c.userId ? coachBtnActive : {}) }}>
                <div>
                  <p style={{ margin:0, fontWeight:700, fontSize:14, color: selectedCoach === c.userId ? "#fff" : "#111827" }}>
                    {c.userName}
                  </p>
                  <p style={{ margin:0, fontSize:12, color: selectedCoach === c.userId ? "rgba(255,255,255,0.7)" : "#9ca3af" }}>
                    📍 {c.siteName}
                  </p>
                </div>
                {selectedCoach === c.userId && <span style={{ color:"#fff", fontSize:18 }}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 문서 종류 */}
      <div style={card}>
        <p style={sectionTitle}>문서 종류</p>
        {DOC_GROUPS.map(({ group, docs }) => (
          <div key={group} style={{ marginBottom:12 }}>
            <p style={{ fontSize:11, fontWeight:700, color:"#9ca3af", letterSpacing:"0.5px", margin:"0 0 6px" }}>{group}</p>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {docs.map(d => (
                <button key={d.id} onClick={() => { setDocType(d.id); setTraineeId(""); }}
                  style={{ ...docBtn, ...(docType === d.id ? docBtnActive : {}) }}>
                  <span>{d.icon}</span>
                  <span style={{ fontSize:13, fontWeight:600, color: docType === d.id ? "#fff" : "#374151" }}>{d.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 훈련생 선택 */}
      {needsTrainee && selectedCoach && (
        <div style={card}>
          <p style={sectionTitle}>훈련생 선택</p>
          {(coach?.trainees || []).length === 0 ? (
            <p style={{ color:"#9ca3af", fontSize:14 }}>담당 훈련생이 없습니다.</p>
          ) : (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {(coach?.trainees || []).map(t => (
                <button key={t.id} onClick={() => setTraineeId(t.id)}
                  style={{ ...docBtn, ...(traineeId === t.id ? docBtnActive : {}) }}>
                  <span style={{ fontSize:13, fontWeight:600, color: traineeId === t.id ? "#fff" : "#374151" }}>{t.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 기간 */}
      <div style={card}>
        <p style={sectionTitle}>조회 기간</p>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={dateInput} />
          <span style={{ color:"#9ca3af" }}>~</span>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={dateInput} />
        </div>
      </div>

      {/* 조회 버튼 */}
      <button onClick={handleView} style={{ width:"100%", padding:"14px", background:"#111827", color:"#fff", border:"none", borderRadius:10, fontSize:15, fontWeight:700, cursor:"pointer" }}>
        📄 {docLabel} 조회
      </button>
    </div>
  );
}

const card: React.CSSProperties         = { background:"#fff", border:"1px solid #f0f0f0", borderRadius:12, padding:"18px 20px", marginBottom:12 };
const sectionTitle: React.CSSProperties = { fontSize:14, fontWeight:700, color:"#374151", margin:"0 0 12px" };
const dateInput: React.CSSProperties    = { flex:1, height:40, border:"1px solid #e5e7eb", borderRadius:8, padding:"0 10px", fontSize:14, outline:"none" };
const coachBtn: React.CSSProperties     = { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", border:"1.5px solid #e5e7eb", borderRadius:10, background:"#fafafa", cursor:"pointer", textAlign:"left" as const };
const coachBtnActive: React.CSSProperties = { border:"1.5px solid #111827", background:"#111827" };
const docBtn: React.CSSProperties       = { display:"flex", alignItems:"center", gap:6, padding:"9px 14px", border:"1.5px solid #e5e7eb", borderRadius:8, background:"#fafafa", cursor:"pointer" };
const docBtnActive: React.CSSProperties = { border:"1.5px solid #111827", background:"#111827" };
const btn = {
  primary:   { padding:"8px 18px", background:"#111827", color:"#fff", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" } as React.CSSProperties,
  secondary: { padding:"8px 14px", background:"#fff", color:"#374151", border:"1px solid #e5e7eb", borderRadius:8, fontSize:13, cursor:"pointer" } as React.CSSProperties,
};
