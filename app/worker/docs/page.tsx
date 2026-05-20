"use client";
// app/worker/docs/page.tsx
// 문서 발송 — 훈련생 선택 + 사업체담당자 즉석 서명 요청 + PDF 발송

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface SiteInfo {
  companyName: string;
  managerEmail: string;
  managerName: string;
  coachName: string;
  trainees: { id: string; name: string; gender: string }[];
}

const DOC_TYPES = [
  { id: "attendance-sheet",      label: "출근부",          icon: "📋", desc: "월별 출퇴근 기록",          needsTrainee: false },
  { id: "training-daily-log",    label: "훈련일지",         icon: "📝", desc: "지원고용 훈련일지",          needsTrainee: true  },
  { id: "trainee-final-eval",    label: "훈련생 종합평가",  icon: "📊", desc: "훈련생 종합 평가기록부",      needsTrainee: true  },
  { id: "adaptation-daily-log",  label: "적응지도 일지",    icon: "📄", desc: "취업 후 적응지도 일지",       needsTrainee: true  },
  { id: "adaptation-final-eval", label: "적응지도 종합평가",icon: "📈", desc: "적응지도 종합 평가기록부",    needsTrainee: true  },
];

export default function DocsPage() {
  const router = useRouter();
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [selectedDoc, setSelectedDoc] = useState("attendance-sheet");
  const [selectedTraineeId, setSelectedTraineeId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; msg: string; pdfBase64?: string; fileName?: string } | null>(null);

  // 사업체담당자 서명 요청
  const [signToken, setSignToken]           = useState<string | null>(null);
  const [signUrl, setSignUrl]               = useState<string | null>(null);
  const [signRequesting, setSignRequesting] = useState(false);
  const [signStatus, setSignStatus]         = useState<"none"|"pending"|"done">("none");
  const [signatureUrl, setSignatureUrl]     = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const last = new Date(y, now.getMonth() + 1, 0).getDate();
    setPeriodStart(`${y}-${m}-01`);
    setPeriodEnd(`${y}-${m}-${String(last).padStart(2, "0")}`);
  }, []);

  useEffect(() => {
    fetch("/api/worker/site/current").then(r => r.json()).then(d => {
      if (d.success && d.data) {
        setSiteInfo({
          companyName:  d.data.companyName,
          managerEmail: d.data.managerEmail || "",
          managerName:  d.data.managerName  || "담당자",
          coachName:    d.data.coachName    || "",
          trainees: (d.data.trainees || []).map((t: any) => ({
            id: String(t.id), name: t.name, gender: t.gender,
          })),
        });
      }
    });
  }, []);

  // 문서 바꾸면 서명 상태 초기화
  function selectDoc(id: string) {
    setSelectedDoc(id); setResult(null);
    setSignToken(null); setSignUrl(null); setSignStatus("none"); setSignatureUrl(null);
  }

  // 사업체담당자 서명 링크 발급
  async function requestCompanySign() {
    setSignRequesting(true);
    try {
      const res = await fetch("/api/worker/docs/sign-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: selectedDoc, periodStart, periodEnd,
          signRole: "company_manager", signerName: "사업체 담당자",
        }),
      });
      const d = await res.json();
      if (d.success) {
        setSignToken(d.token); setSignUrl(d.signUrl); setSignStatus("pending");
        // 클립보드 복사
        try { await navigator.clipboard.writeText(d.signUrl); } catch {}
        // 폴링 시작
        pollSignature(d.token);
      } else {
        alert(d.message || "링크 생성 실패");
      }
    } finally { setSignRequesting(false); }
  }

  // 서명 완료 폴링 (10초 간격 × 36회 = 6분)
  function pollSignature(token: string) {
    let count = 0;
    const iv = setInterval(async () => {
      count++;
      const d = await fetch(`/api/worker/docs/sign-token?token=${token}`).then(r => r.json());
      if (d.signed && d.signatureUrl) {
        clearInterval(iv);
        setSignStatus("done"); setSignatureUrl(d.signatureUrl);
      }
      if (count >= 36) clearInterval(iv);
    }, 10000);
  }

  // PDF 발송
  async function handleSend() {
    if (!siteInfo?.managerEmail) { alert("에이전시 담당자 이메일이 등록되지 않았습니다."); return; }
    const needsTrainee = DOC_TYPES.find(d => d.id === selectedDoc)?.needsTrainee;
    if (needsTrainee && !selectedTraineeId) { alert("훈련생을 선택해주세요."); return; }

    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/worker/docs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: selectedDoc, periodStart, periodEnd,
          traineeId: selectedTraineeId || undefined,
          companyManagerSignToken: signToken || undefined,
          sendEmail: true, toEmail: siteInfo.managerEmail,
        }),
      });
      const data = await res.json();
      if (!data.success) { setResult({ success: false, msg: data.message || "오류가 발생했습니다." }); return; }
      setResult({ success: true, msg: data.message, pdfBase64: data.pdfBase64, fileName: data.fileName });
    } catch { setResult({ success: false, msg: "서버와 연결할 수 없습니다." }); }
    finally { setLoading(false); }
  }

  function handleDownload() {
    if (!result?.pdfBase64 || !result?.fileName) return;
    const blob = new Blob([Uint8Array.from(atob(result.pdfBase64), c => c.charCodeAt(0))], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = result.fileName; a.click();
    URL.revokeObjectURL(url);
  }

  const needsTrainee = DOC_TYPES.find(d => d.id === selectedDoc)?.needsTrainee ?? false;
  const selectedLabel = DOC_TYPES.find(d => d.id === selectedDoc)?.label || "문서";

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* 헤더 */}
        <div style={s.header}>
          <button onClick={() => router.back()} style={s.backBtn}>←</button>
          <h1 style={s.title}>문서 발송</h1>
          <button onClick={() => router.push("/worker/docs/view")} style={s.subBtn}>조회</button>
        </div>

        {/* 현장 + 수신자 */}
        {siteInfo && (
          <div style={s.infoCard}>
            <div style={s.infoRow}>
              <span style={s.infoLabel}>현장</span>
              <span style={s.infoValue}>📍 {siteInfo.companyName}</span>
            </div>
            <div style={s.infoDivider} />
            <div style={s.infoRow}>
              <span style={s.infoLabel}>수신자</span>
              <span style={s.infoValue}>
                {siteInfo.managerName} ({siteInfo.managerEmail || "이메일 미등록"})
              </span>
            </div>
          </div>
        )}

        {/* 문서 종류 */}
        <div style={s.section}>
          <p style={s.sectionTitle}>문서 종류</p>
          <div style={s.docList}>
            {DOC_TYPES.map(doc => (
              <button key={doc.id}
                style={{ ...s.docItem, ...(selectedDoc === doc.id ? s.docItemActive : {}) }}
                onClick={() => selectDoc(doc.id)}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{doc.icon}</span>
                <div style={{ flex: 1, textAlign: "left" as const }}>
                  <p style={{ ...s.docLabel, color: selectedDoc === doc.id ? "#fff" : "#111827" }}>{doc.label}</p>
                  <p style={{ ...s.docDesc, color: selectedDoc === doc.id ? "rgba(255,255,255,0.7)" : "#9ca3af" }}>{doc.desc}</p>
                </div>
                {selectedDoc === doc.id && <span style={{ color: "#fff", fontWeight: 700 }}>✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* 훈련생 선택 (해당 문서만) */}
        {needsTrainee && (
          <div style={s.section}>
            <p style={s.sectionTitle}>훈련생 선택</p>
            {siteInfo?.trainees && siteInfo.trainees.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {siteInfo.trainees.map(t => (
                  <button key={t.id} onClick={() => setSelectedTraineeId(t.id)}
                    style={{ ...s.traineeBtn, ...(selectedTraineeId === t.id ? s.traineeBtnActive : {}) }}>
                    <span style={{ fontSize: 18 }}>{t.gender === "M" ? "👨" : "👩"}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: selectedTraineeId === t.id ? "#fff" : "#111827" }}>{t.name}</span>
                    {selectedTraineeId === t.id && <span style={{ marginLeft: "auto", color: "#fff" }}>✓</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>담당 훈련생이 없습니다.</p>
            )}
          </div>
        )}

        {/* 기간 */}
        <div style={s.section}>
          <p style={s.sectionTitle}>기간 설정</p>
          <div style={s.dateRow}>
            <input type="date" value={periodStart} onChange={e => { setPeriodStart(e.target.value); setResult(null); }} style={s.dateInput} />
            <span style={{ color: "#9ca3af" }}>~</span>
            <input type="date" value={periodEnd} onChange={e => { setPeriodEnd(e.target.value); setResult(null); }} style={s.dateInput} />
          </div>
        </div>

        {/* 사업체담당자 서명 요청 */}
        <div style={s.section}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={s.sectionTitle}>사업체담당자 서명</p>
            {signStatus === "done" && <span style={s.signedBadge}>✓ 서명 완료</span>}
          </div>

          {signStatus === "none" && (
            <button onClick={requestCompanySign} disabled={signRequesting} style={s.signReqBtn}>
              {signRequesting ? "링크 생성 중..." : "📱 서명 요청 링크 생성"}
            </button>
          )}

          {signStatus === "pending" && signUrl && (
            <div style={s.signPendingBox}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "0 0 8px" }}>
                아래 링크를 사업체 담당자에게 전달하세요
              </p>
              <div style={s.signUrlBox}>
                <span style={{ fontSize: 12, color: "#374151", wordBreak: "break-all" as const }}>{signUrl}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={async () => { await navigator.clipboard.writeText(signUrl!); alert("링크가 복사되었습니다."); }} style={s.copyBtn}>
                  복사
                </button>
                <button onClick={() => window.open(signUrl!, "_blank")} style={s.copyBtn}>
                  QR 미리보기
                </button>
              </div>
              <p style={{ fontSize: 12, color: "#9ca3af", margin: "10px 0 0" }}>
                ⏳ 서명 완료를 기다리는 중... (자동 감지)
              </p>
            </div>
          )}

          {signStatus === "done" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #86efac" }}>
              <img src={signatureUrl!} alt="서명" style={{ height: 40, objectFit: "contain" }} />
              <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>서명이 문서에 포함됩니다.</span>
            </div>
          )}

          <p style={{ fontSize: 12, color: "#9ca3af", margin: "8px 0 0", lineHeight: 1.6 }}>
            서명 없이 발송하면 서명란이 빈칸으로 출력됩니다.
          </p>
        </div>

        {/* 결과 */}
        {result && (
          <div style={{ ...s.resultBox, backgroundColor: result.success ? "#f0fdf4" : "#fef2f2", borderColor: result.success ? "#86efac" : "#fecaca" }}>
            <p style={{ ...s.resultMsg, color: result.success ? "#16a34a" : "#dc2626" }}>
              {result.success ? "✅ " : "❌ "}{result.msg}
            </p>
            {result.success && result.pdfBase64 && (
              <button style={s.downloadBtn} onClick={handleDownload}>📥 PDF 다운로드 (사본)</button>
            )}
          </div>
        )}

        {/* 발송 버튼 */}
        <button style={{ ...s.sendBtn, opacity: loading ? 0.7 : 1 }} onClick={handleSend} disabled={loading}>
          {loading ? "⏳ PDF 생성 및 발송 중..." : `📧 ${selectedLabel} 발송`}
        </button>

        <div style={s.noteBox}>
          <p style={s.noteText}>
            PDF가 자동 생성되어 에이전시 담당자에게 발송됩니다.<br/>
            직무지도원 서명은 등록된 서명이 자동 삽입됩니다.
          </p>
        </div>

      </div>

      {/* 네비게이션 */}
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
          <span style={{ ...s.navIcon, color: "#111827" }}>📄</span>
          <span style={{ ...s.navLabel, color: "#111827", fontWeight: 700 }}>문서</span>
        </button>
      </nav>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:       { minHeight: "100dvh", backgroundColor: "#f9fafb" },
  container:  { maxWidth: 480, margin: "0 auto", padding: "0 0 100px" },
  header:     { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", backgroundColor: "#fff", borderBottom: "1px solid #f3f4f6", position: "sticky", top: 0, zIndex: 10 },
  backBtn:    { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#374151", width: 36, fontWeight: 700 },
  title:      { fontSize: 17, fontWeight: 700, color: "#111827", margin: 0 },
  subBtn:     { background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" },

  infoCard:   { margin: "12px 16px 0", backgroundColor: "#fff", borderRadius: 14, padding: "14px 16px", border: "1px solid #f3f4f6" },
  infoRow:    { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" },
  infoLabel:  { fontSize: 13, color: "#9ca3af", fontWeight: 600, flexShrink: 0, marginRight: 12 },
  infoValue:  { fontSize: 13, fontWeight: 600, color: "#111827", textAlign: "right" as const },
  infoDivider:{ height: 1, backgroundColor: "#f9fafb", margin: "8px 0" },

  section:      { backgroundColor: "#fff", margin: "12px 16px 0", borderRadius: 14, padding: "16px", border: "1px solid #f3f4f6" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 12px" },

  docList:     { display: "flex", flexDirection: "column", gap: 8 },
  docItem:     { display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", border: "1.5px solid #e5e7eb", borderRadius: 12, backgroundColor: "#fafafa", cursor: "pointer" },
  docItemActive:{ border: "1.5px solid #111827", backgroundColor: "#111827" },
  docLabel:    { fontSize: 14, fontWeight: 700, margin: "0 0 2px" },
  docDesc:     { fontSize: 12, margin: 0 },

  traineeBtn:       { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, background: "#fafafa", cursor: "pointer" },
  traineeBtnActive: { border: "1.5px solid #111827", background: "#111827" },

  dateRow:   { display: "flex", alignItems: "center", gap: 8 },
  dateInput: { flex: 1, height: 42, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 14, color: "#111827", outline: "none", background: "#fafafa" },

  signReqBtn:    { width: "100%", padding: "12px", background: "#374151", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  signPendingBox:{ background: "#f9fafb", borderRadius: 10, padding: 14, border: "1px solid #e5e7eb" },
  signUrlBox:    { background: "#fff", borderRadius: 8, padding: "10px 12px", border: "1px solid #e5e7eb", wordBreak: "break-all" as const },
  signedBadge:   { fontSize: 12, background: "#f0fdf4", color: "#16a34a", border: "1px solid #86efac", borderRadius: 20, padding: "3px 10px", fontWeight: 700 },
  copyBtn:       { padding: "8px 14px", background: "#fff", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },

  resultBox:   { margin: "12px 16px 0", padding: "14px 16px", borderRadius: 12, border: "1px solid" },
  resultMsg:   { fontSize: 14, margin: "0 0 10px", fontWeight: 600, lineHeight: 1.5 },
  downloadBtn: { width: "100%", padding: "11px", backgroundColor: "#111827", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },

  sendBtn: { display: "block", width: "calc(100% - 32px)", margin: "16px 16px 0", padding: "16px", backgroundColor: "#111827", color: "#fff", fontSize: 16, fontWeight: 700, border: "none", borderRadius: 12, cursor: "pointer" },
  noteBox: { margin: "12px 16px 0", padding: "14px 16px", backgroundColor: "#f9fafb", borderRadius: 12, border: "1px solid #f3f4f6" },
  noteText:{ fontSize: 13, color: "#6b7280", margin: 0, lineHeight: 1.8, textAlign: "center" as const },

  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, backgroundColor: "#fff", borderTop: "1px solid #f3f4f6", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" },
  navItem:   { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "10px 0", border: "none", backgroundColor: "transparent", cursor: "pointer" },
  navIcon:   { fontSize: 22 },
  navLabel:  { fontSize: 11, color: "#9ca3af", fontWeight: 500 },
};
