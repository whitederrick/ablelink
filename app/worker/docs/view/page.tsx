"use client";
// app/worker/docs/view/page.tsx
// 문서 조회 + 뷰어 화면

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";

type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

const DOC_GROUPS = [
  {
    group: "출퇴근",
    docs: [
      { id: "attendance-sheet" as DocType, label: "출근부", icon: "📋", desc: "날짜별 출퇴근 기록" },
    ],
  },
  {
    group: "훈련",
    docs: [
      { id: "training-daily-log" as DocType,  label: "훈련일지",       icon: "📝", desc: "일자별 지원고용 훈련 기록" },
      { id: "trainee-final-eval" as DocType,  label: "훈련생 종합평가", icon: "📊", desc: "훈련생별 수행 종합 집계" },
    ],
  },
  {
    group: "적응지도",
    docs: [
      { id: "adaptation-daily-log" as DocType,  label: "적응지도 일지",    icon: "📄", desc: "일자별 취업 후 적응지도 기록" },
      { id: "adaptation-final-eval" as DocType, label: "적응지도 종합평가", icon: "📈", desc: "훈련생별 적응지도 종합 집계" },
    ],
  },
];

const DOC_LABELS: Record<DocType, string> = {
  "attendance-sheet":      "출근부",
  "training-daily-log":    "훈련일지",
  "trainee-final-eval":    "훈련생 종합평가",
  "adaptation-daily-log":  "적응지도 일지",
  "adaptation-final-eval": "적응지도 종합평가",
};

function defaultPeriod() {
  const n = new Date();
  const y = n.getFullYear(), m = String(n.getMonth()+1).padStart(2,"0");
  const last = new Date(y, n.getMonth()+1, 0).getDate();
  return { start:`${y}-${m}-01`, end:`${y}-${m}-${String(last).padStart(2,"0")}` };
}

function DocsViewInner() {
  const router = useRouter();
  const def = defaultPeriod();

  const [docType,     setDocType]     = useState<DocType>("attendance-sheet");
  const [periodStart, setPeriodStart] = useState(def.start);
  const [periodEnd,   setPeriodEnd]   = useState(def.end);
  const [mode,        setMode]        = useState<"select"|"view">("select");
  const [iframeKey,   setIframeKey]   = useState(0);

  function previewUrl(fmt: "html"|"pdf" = "html") {
    return `/api/worker/docs/preview?docType=${docType}&periodStart=${periodStart}&periodEnd=${periodEnd}&format=${fmt}`;
  }

  function handleView() {
    setIframeKey(k => k+1);
    setMode("view");
  }

  function handleDownload() {
    window.open(previewUrl("pdf"), "_blank");
  }

  // ── 문서 선택 화면 ─────────────────────────────────────
  if (mode === "select") {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <button onClick={() => router.back()} style={s.backBtn}>←</button>
          <h1 style={s.title}>문서 조회</h1>
          <button onClick={() => router.push("/worker/docs")} style={s.subBtn}>발송</button>
        </div>

        <div style={s.container}>

          {/* 문서 종류 선택 */}
          {DOC_GROUPS.map(({ group, docs }) => (
            <div key={group} style={{ marginBottom: 16 }}>
              <p style={s.groupLabel}>{group}</p>
              <div style={s.docList}>
                {docs.map(doc => (
                  <button key={doc.id} onClick={() => setDocType(doc.id)}
                    style={{ ...s.docItem, ...(docType === doc.id ? s.docItemActive : {}) }}>
                    <span style={{ fontSize: 26 }}>{doc.icon}</span>
                    <div style={{ flex: 1, textAlign: "left" as const }}>
                      <p style={{ ...s.docLabel, color: docType === doc.id ? "#fff" : "#111827" }}>{doc.label}</p>
                      <p style={{ ...s.docDesc, color: docType === doc.id ? "rgba(255,255,255,0.7)" : "#9ca3af" }}>{doc.desc}</p>
                    </div>
                    {docType === doc.id && <span style={{ fontSize: 18, color: "#fff" }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* 기간 선택 */}
          <div style={s.section}>
            <p style={s.sectionTitle}>조회 기간</p>
            <div style={s.dateRow}>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={s.dateInput} />
              <span style={{ color:"#9ca3af", fontWeight:600 }}>~</span>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={s.dateInput} />
            </div>
          </div>

          {/* 조회 버튼 */}
          <button onClick={handleView} style={s.viewBtn}>
            📄 {DOC_LABELS[docType]} 조회
          </button>

        </div>

        <nav style={s.bottomNav}>
          <button style={s.navItem} onClick={() => router.push("/worker/home")}>
            <span style={s.navIcon}>🏠</span><span style={s.navLabel}>홈</span>
          </button>
          <button style={s.navItem} onClick={() => router.push("/worker/calendar")}>
            <span style={s.navIcon}>📅</span><span style={s.navLabel}>캘린더</span>
          </button>
          <button style={s.navItem} onClick={() => router.push("/worker/signature")}>
            <span style={s.navIcon}>✍️</span><span style={s.navLabel}>전자서명</span>
          </button>
          <button style={s.navItem} onClick={() => router.push("/worker/docs")}>
            <span style={{ ...s.navIcon, color:"#111827" }}>📄</span>
            <span style={{ ...s.navLabel, color:"#111827", fontWeight:700 }}>문서</span>
          </button>
        </nav>
      </div>
    );
  }

  // ── 문서 뷰어 화면 ─────────────────────────────────────
  return (
    <div style={{ ...s.page, display:"flex", flexDirection:"column" }}>
      {/* 뷰어 헤더 */}
      <div style={s.header}>
        <button onClick={() => setMode("select")} style={s.backBtn}>←</button>
        <div style={{ display:"flex", flexDirection:"column" as const, alignItems:"center" }}>
          <span style={s.title}>{DOC_LABELS[docType]}</span>
          <span style={{ fontSize:11, color:"#9ca3af" }}>{periodStart} ~ {periodEnd}</span>
        </div>
        <button onClick={handleDownload} style={s.pdfBtn}>PDF</button>
      </div>

      {/* iframe 뷰어 */}
      <div style={{ flex:1, overflow:"hidden", background:"#e5e7eb" }}>
        <iframe
          key={iframeKey}
          src={previewUrl("html")}
          style={{ width:"100%", height:"100%", border:"none" }}
          title="문서 미리보기"
        />
      </div>

      {/* 하단 액션 */}
      <div style={s.viewerFooter}>
        <button onClick={() => setMode("select")} style={s.footerBtnGray}>
          ← 문서 선택
        </button>
        <button onClick={handleDownload} style={s.footerBtnBlack}>
          📥 PDF 다운로드
        </button>
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
  page:        { minHeight:"100dvh", height:"100dvh", backgroundColor:"#f9fafb", display:"flex", flexDirection:"column" },
  container:   { flex:1, maxWidth:480, width:"100%", margin:"0 auto", padding:"16px 16px 100px", overflowY:"auto" },
  header:      { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", backgroundColor:"#fff", borderBottom:"1px solid #f3f4f6", flexShrink:0, zIndex:10 },
  backBtn:     { background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#374151", width:44, fontWeight:700 },
  title:       { fontSize:16, fontWeight:700, color:"#111827", margin:0 },
  subBtn:      { background:"none", border:"1px solid #e5e7eb", borderRadius:8, padding:"6px 12px", fontSize:13, fontWeight:600, color:"#374151", cursor:"pointer" },
  pdfBtn:      { background:"#111827", border:"none", borderRadius:8, padding:"6px 14px", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer" },

  groupLabel:  { fontSize:11, fontWeight:700, color:"#9ca3af", letterSpacing:"0.8px", textTransform:"uppercase" as const, marginBottom:8 },
  docList:     { display:"flex", flexDirection:"column" as const, gap:8 },
  docItem:     { display:"flex", alignItems:"center", gap:14, padding:"14px 16px", border:"1.5px solid #e5e7eb", borderRadius:14, background:"#fff", cursor:"pointer" },
  docItemActive:{ border:"1.5px solid #111827", background:"#111827" },
  docLabel:    { fontSize:15, fontWeight:700, margin:"0 0 3px" },
  docDesc:     { fontSize:12, margin:0 },

  section:     { background:"#fff", borderRadius:14, padding:"16px", marginBottom:12, border:"1px solid #f3f4f6" },
  sectionTitle:{ fontSize:14, fontWeight:700, color:"#374151", marginBottom:12 },
  dateRow:     { display:"flex", alignItems:"center", gap:8 },
  dateInput:   { flex:1, height:42, border:"1px solid #e5e7eb", borderRadius:8, padding:"0 10px", fontSize:14, color:"#111827", outline:"none", background:"#fafafa", minWidth:0 },

  viewBtn:     { width:"100%", padding:"16px", background:"#111827", color:"#fff", border:"none", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer" },

  viewerFooter:{ display:"flex", gap:10, padding:"12px 16px", background:"#fff", borderTop:"1px solid #f3f4f6", flexShrink:0 },
  footerBtnGray: { flex:1, padding:"13px", background:"#f3f4f6", color:"#374151", border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" },
  footerBtnBlack:{ flex:2, padding:"13px", background:"#111827", color:"#fff", border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" },

  bottomNav:   { position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, backgroundColor:"#fff", borderTop:"1px solid #f3f4f6", display:"flex", zIndex:100, paddingBottom:"env(safe-area-inset-bottom)" },
  navItem:     { flex:1, display:"flex", flexDirection:"column" as const, alignItems:"center", justifyContent:"center", gap:3, padding:"10px 0", border:"none", backgroundColor:"transparent", cursor:"pointer" },
  navIcon:     { fontSize:22 },
  navLabel:    { fontSize:11, color:"#9ca3af", fontWeight:500 },
};
