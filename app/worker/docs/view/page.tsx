"use client";
// app/worker/docs/view/page.tsx
// 문서 조회 + 사업체담당자 서명 요청 + jsreport 뷰어

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

const DOC_GROUPS = [
  { group: "출퇴근", docs: [
    { id: "attendance-sheet"      as DocType, label: "출근부",          icon: "📋", desc: "날짜별 출퇴근 기록",          needsTrainee: false },
  ]},
  { group: "훈련", docs: [
    { id: "training-daily-log"    as DocType, label: "훈련일지",         icon: "📝", desc: "일자별 지원고용 훈련 기록",    needsTrainee: true  },
    { id: "trainee-final-eval"    as DocType, label: "훈련생 종합평가",  icon: "📊", desc: "훈련생별 수행 종합 집계",      needsTrainee: true  },
  ]},
  { group: "적응지도", docs: [
    { id: "adaptation-daily-log"  as DocType, label: "적응지도 일지",    icon: "📄", desc: "일자별 취업 후 적응지도 기록", needsTrainee: true  },
    { id: "adaptation-final-eval" as DocType, label: "적응지도 종합평가",icon: "📈", desc: "훈련생별 적응지도 종합 집계",  needsTrainee: true  },
  ]},
];

const DOC_LABELS: Record<DocType, string> = {
  "attendance-sheet":      "출근부",
  "training-daily-log":    "훈련일지",
  "trainee-final-eval":    "훈련생 종합평가",
  "adaptation-daily-log":  "적응지도 일지",
  "adaptation-final-eval": "적응지도 종합평가",
};

function defaultPeriod() {
  const n = new Date(), y = n.getFullYear(), m = String(n.getMonth()+1).padStart(2,"0");
  const last = new Date(y, n.getMonth()+1, 0).getDate();
  return { start:`${y}-${m}-01`, end:`${y}-${m}-${String(last).padStart(2,"0")}` };
}

function DocsViewInner() {
  const router = useRouter();
  const def = defaultPeriod();
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const [docType,        setDocType]        = useState<DocType>("attendance-sheet");
  const [periodStart,    setPeriodStart]    = useState(def.start);
  const [periodEnd,      setPeriodEnd]      = useState(def.end);
  const [selectedTrainee,setSelectedTrainee]= useState("");
  const [trainees,       setTrainees]       = useState<{id:string;name:string;gender:string}[]>([]);
  const [mode,           setMode]           = useState<"select"|"view">("select");
  const [iframeKey,      setIframeKey]      = useState(0);

  // 사업체담당자 서명
  const [signToken,      setSignToken]      = useState("");
  const [signUrl,        setSignUrl]        = useState("");
  const [signStatus,     setSignStatus]     = useState<"none"|"pending"|"done">("none");
  const [signImageUrl,   setSignImageUrl]   = useState("");
  const [signRequesting, setSignRequesting] = useState(false);

  const needsTrainee = DOC_GROUPS.flatMap(g=>g.docs).find(d=>d.id===docType)?.needsTrainee ?? false;

  useEffect(() => {
    fetch("/api/worker/site/current").then(r=>r.json()).then(d => {
      if (d.success && d.data?.trainees)
        setTrainees(d.data.trainees.map((t:any)=>({ id:String(t.id), name:t.name, gender:t.gender||"M" })));
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function resetSign() {
    if (pollRef.current) clearInterval(pollRef.current);
    setSignToken(""); setSignUrl(""); setSignStatus("none"); setSignImageUrl("");
  }

  function selectDoc(id: DocType) {
    setDocType(id); setSelectedTrainee(""); resetSign();
  }

  function previewUrl() {
    const p = new URLSearchParams({
      docType, periodStart, periodEnd,
      ...(selectedTrainee ? { traineeId: selectedTrainee } : {}),
      ...(signToken       ? { signToken }                  : {}),
    });
    return `/api/worker/docs/preview?${p.toString()}`;
  }

  async function requestCompanySign() {
    setSignRequesting(true);
    try {
      const res = await fetch("/api/worker/docs/sign-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType, periodStart, periodEnd,
          signRole: "company_manager",
          signerName: "사업체 담당자",
        }),
      });
      const d = await res.json();
      if (!d.success) { alert(d.message || "링크 생성 실패"); return; }
      setSignToken(d.token); setSignUrl(d.signUrl); setSignStatus("pending");
      try { await navigator.clipboard.writeText(d.signUrl); } catch {}
      // 폴링 (10초 간격)
      pollRef.current = setInterval(async () => {
        const pd = await fetch(`/api/worker/docs/sign-token?token=${d.token}`).then(r=>r.json());
        if (pd.signed && pd.signatureUrl) {
          clearInterval(pollRef.current!);
          setSignStatus("done"); setSignImageUrl(pd.signatureUrl);
        }
      }, 10000);
    } finally { setSignRequesting(false); }
  }

  function handleView() {
    if (needsTrainee && !selectedTrainee) { alert("훈련생을 선택해주세요."); return; }
    setIframeKey(k => k+1);
    setMode("view");
  }

  // ── 문서 선택 화면 ──────────────────────────────────────
  if (mode === "select") {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <button onClick={() => router.back()} style={s.backBtn}>←</button>
          <h1 style={s.title}>문서 조회</h1>
          <button onClick={() => router.push("/worker/docs")} style={s.subBtn}>발송</button>
        </div>

        <div style={s.container}>

          {/* 문서 종류 */}
          {DOC_GROUPS.map(({ group, docs }) => (
            <div key={group} style={{ marginBottom:12 }}>
              <p style={s.groupLabel}>{group}</p>
              <div style={s.docList}>
                {docs.map(doc => (
                  <button key={doc.id} onClick={() => selectDoc(doc.id)}
                    style={{ ...s.docItem, ...(docType===doc.id ? s.docItemActive : {}) }}>
                    <span style={{ fontSize:22, flexShrink:0 }}>{doc.icon}</span>
                    <div style={{ flex:1, textAlign:"left" as const }}>
                      <p style={{ ...s.docLabel, color: docType===doc.id?"#fff":"#111827" }}>{doc.label}</p>
                      <p style={{ ...s.docDesc,  color: docType===doc.id?"rgba(255,255,255,0.7)":"#9ca3af" }}>{doc.desc}</p>
                    </div>
                    {docType===doc.id && <span style={{ color:"#fff", fontWeight:700 }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* 훈련생 선택 */}
          {needsTrainee && (
            <div style={s.section}>
              <p style={s.sectionTitle}>훈련생 선택</p>
              {trainees.length === 0
                ? <p style={s.emptyText}>담당 훈련생이 없습니다.</p>
                : trainees.map(t => (
                  <button key={t.id} onClick={() => setSelectedTrainee(t.id)}
                    style={{ ...s.traineeBtn, ...(selectedTrainee===t.id ? s.traineeBtnActive : {}) }}>
                    <span style={{ fontSize:18 }}>{t.gender==="M"?"👨":"👩"}</span>
                    <span style={{ fontSize:14, fontWeight:600, color:selectedTrainee===t.id?"#fff":"#111827" }}>{t.name}</span>
                    {selectedTrainee===t.id && <span style={{ marginLeft:"auto", color:"#fff" }}>✓</span>}
                  </button>
                ))
              }
            </div>
          )}

          {/* 기간 */}
          <div style={s.section}>
            <p style={s.sectionTitle}>조회 기간</p>
            <div style={s.dateRow}>
              <input type="date" value={periodStart} onChange={e=>{setPeriodStart(e.target.value);resetSign();}} style={s.dateInput} />
              <span style={{ color:"#9ca3af", fontWeight:600 }}>~</span>
              <input type="date" value={periodEnd} onChange={e=>{setPeriodEnd(e.target.value);resetSign();}} style={s.dateInput} />
            </div>
          </div>

          {/* 사업체담당자 서명 요청 */}
          <div style={s.section}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <p style={s.sectionTitle}>사업체담당자 서명</p>
              {signStatus==="done" && <span style={s.badgeDone}>✓ 서명완료</span>}
            </div>

            {signStatus==="none" && (
              <button onClick={requestCompanySign} disabled={signRequesting} style={s.signReqBtn}>
                {signRequesting ? "링크 생성 중..." : "📱 서명 요청 링크 생성"}
              </button>
            )}

            {signStatus==="pending" && (
              <div style={s.signPendingBox}>
                <p style={{ fontSize:13, fontWeight:700, color:"#374151", margin:"0 0 8px" }}>
                  아래 링크를 사업체 담당자에게 전달하세요
                </p>
                <div style={s.signUrlBox}>
                  <span style={{ fontSize:11, color:"#374151", wordBreak:"break-all" as const }}>{signUrl}</span>
                </div>
                <div style={{ display:"flex", gap:8, marginTop:8 }}>
                  <button onClick={async()=>{ await navigator.clipboard.writeText(signUrl); alert("복사됐습니다."); }} style={s.copyBtn}>링크 복사</button>
                  <button onClick={()=>window.open(signUrl,"_blank")} style={s.copyBtn}>새 탭 열기</button>
                  <button onClick={resetSign} style={{ ...s.copyBtn, color:"#dc2626" }}>취소</button>
                </div>
                <p style={{ fontSize:11, color:"#9ca3af", margin:"8px 0 0" }}>⏳ 서명 완료 자동 감지 중...</p>
              </div>
            )}

            {signStatus==="done" && (
              <div style={s.signDoneBox}>
                <img src={signImageUrl} alt="서명" style={{ height:36, objectFit:"contain" }} />
                <span style={{ fontSize:13, color:"#16a34a", fontWeight:600 }}>서명이 문서에 포함됩니다.</span>
              </div>
            )}

            <p style={s.signNote}>서명 없이 조회하면 "(서명 또는 인)" 표시로 출력됩니다.</p>
          </div>

          {/* 조회 버튼 */}
          <button onClick={handleView} style={s.viewBtn}>
            📄 {DOC_LABELS[docType]} 조회
          </button>

        </div>

        <nav style={s.bottomNav}>
          {[
            { icon:"🏠", label:"홈",    path:"/worker/home" },
            { icon:"📅", label:"캘린더",path:"/worker/calendar" },
            { icon:"✍️", label:"서명",  path:"/worker/signature" },
            { icon:"📄", label:"문서",  path:"/worker/docs", active:true },
          ].map(n => (
            <button key={n.path} style={s.navItem} onClick={()=>router.push(n.path)}>
              <span style={s.navIcon}>{n.icon}</span>
              <span style={{ ...s.navLabel, ...(n.active?{color:"#111827",fontWeight:700}:{}) }}>{n.label}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  }

  // ── 뷰어 화면 ───────────────────────────────────────────
  return (
    <div style={{ ...s.page, display:"flex", flexDirection:"column" }}>
      <div style={s.header}>
        <button onClick={()=>setMode("select")} style={s.backBtn}>←</button>
        <div style={{ display:"flex", flexDirection:"column" as const, alignItems:"center" }}>
          <span style={s.title}>{DOC_LABELS[docType]}</span>
          <span style={{ fontSize:11, color:"#9ca3af" }}>{periodStart} ~ {periodEnd}</span>
        </div>
        <button onClick={()=>window.open(previewUrl(),"_blank")} style={s.pdfBtn}>PDF</button>
      </div>

      <div style={{ flex:1, overflow:"hidden", background:"#e5e7eb" }}>
        <iframe key={iframeKey} src={previewUrl()}
          style={{ width:"100%", height:"100%", border:"none" }} title="문서 미리보기" />
      </div>

      <div style={s.viewerFooter}>
        <button onClick={()=>setMode("select")} style={s.footerBtnGray}>← 문서 선택</button>
        {signStatus!=="done" && signStatus!=="pending" && (
          <button onClick={()=>setMode("select")} style={{ ...s.footerBtnGray, flex:"none", padding:"13px 16px", fontSize:12 }}>
            ✍️ 서명 요청
          </button>
        )}
        <button onClick={()=>window.open(previewUrl(),"_blank")} style={s.footerBtnBlack}>📥 PDF 다운로드</button>
      </div>
    </div>
  );
}

export default function DocsViewPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight:"100dvh", display:"flex", alignItems:"center", justifyContent:"center", background:"#f9fafb" }}>
        <p style={{ color:"#9ca3af" }}>로딩 중...</p>
      </div>
    }>
      <DocsViewInner />
    </Suspense>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:         { minHeight:"100dvh", height:"100dvh", backgroundColor:"#f9fafb", display:"flex", flexDirection:"column" },
  container:    { flex:1, maxWidth:480, width:"100%", margin:"0 auto", padding:"16px 16px 100px", overflowY:"auto" },
  header:       { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", backgroundColor:"#fff", borderBottom:"1px solid #f3f4f6", flexShrink:0, zIndex:10 },
  backBtn:      { background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#374151", width:44, fontWeight:700 },
  title:        { fontSize:16, fontWeight:700, color:"#111827", margin:0 },
  subBtn:       { background:"none", border:"1px solid #e5e7eb", borderRadius:8, padding:"6px 12px", fontSize:13, fontWeight:600, color:"#374151", cursor:"pointer" },
  pdfBtn:       { background:"#111827", border:"none", borderRadius:8, padding:"6px 14px", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer" },
  groupLabel:   { fontSize:11, fontWeight:700, color:"#9ca3af", letterSpacing:"0.8px", textTransform:"uppercase" as const, marginBottom:8 },
  docList:      { display:"flex", flexDirection:"column" as const, gap:8 },
  docItem:      { display:"flex", alignItems:"center", gap:12, padding:"13px 14px", border:"1.5px solid #e5e7eb", borderRadius:12, background:"#fff", cursor:"pointer" },
  docItemActive:{ border:"1.5px solid #111827", background:"#111827" },
  docLabel:     { fontSize:14, fontWeight:700, margin:"0 0 2px" },
  docDesc:      { fontSize:12, margin:0 },
  section:      { background:"#fff", borderRadius:14, padding:"16px", marginBottom:12, border:"1px solid #f3f4f6" },
  sectionTitle: { fontSize:14, fontWeight:700, color:"#374151", margin:"0 0 10px" },
  emptyText:    { fontSize:13, color:"#9ca3af", margin:0 },
  traineeBtn:   { display:"flex", alignItems:"center", gap:10, padding:"12px 14px", border:"1.5px solid #e5e7eb", borderRadius:10, background:"#fafafa", cursor:"pointer", width:"100%", marginBottom:8 },
  traineeBtnActive:{ border:"1.5px solid #111827", background:"#111827" },
  dateRow:      { display:"flex", alignItems:"center", gap:8 },
  dateInput:    { flex:1, height:42, border:"1px solid #e5e7eb", borderRadius:8, padding:"0 10px", fontSize:14, color:"#111827", outline:"none", background:"#fafafa", minWidth:0 },
  signReqBtn:   { width:"100%", padding:"12px", background:"#374151", color:"#fff", border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" },
  signPendingBox:{ background:"#f9fafb", borderRadius:10, padding:14, border:"1px solid #e5e7eb" },
  signUrlBox:   { background:"#fff", borderRadius:8, padding:"10px 12px", border:"1px solid #e5e7eb" },
  signDoneBox:  { display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"#f0fdf4", borderRadius:10, border:"1px solid #86efac", marginBottom:8 },
  badgeDone:    { fontSize:12, background:"#f0fdf4", color:"#16a34a", border:"1px solid #86efac", borderRadius:20, padding:"3px 10px", fontWeight:700 },
  copyBtn:      { padding:"7px 12px", background:"#fff", color:"#374151", border:"1px solid #e5e7eb", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" },
  signNote:     { fontSize:12, color:"#9ca3af", margin:"8px 0 0" },
  viewBtn:      { width:"100%", padding:"16px", background:"#111827", color:"#fff", border:"none", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer" },
  viewerFooter: { display:"flex", gap:8, padding:"12px 16px", background:"#fff", borderTop:"1px solid #f3f4f6", flexShrink:0 },
  footerBtnGray:  { flex:1, padding:"13px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" },
  footerBtnBlack: { flex:2, padding:"13px", background:"#111827", color:"#fff", border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" },
  bottomNav:    { position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, backgroundColor:"#fff", borderTop:"1px solid #f3f4f6", display:"flex", zIndex:100, paddingBottom:"env(safe-area-inset-bottom)" },
  navItem:      { flex:1, display:"flex", flexDirection:"column" as const, alignItems:"center", justifyContent:"center", gap:3, padding:"10px 0", border:"none", backgroundColor:"transparent", cursor:"pointer" },
  navIcon:      { fontSize:22 },
  navLabel:     { fontSize:11, color:"#9ca3af", fontWeight:500 },
};
