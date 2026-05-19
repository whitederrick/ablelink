"use client";
// app/worker/docs/page.tsx
// 문서 발송 — PDF 생성 + AWS SES 자동 발송 (버튼 하나로 완료)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface SiteInfo {
  companyName: string;
  managerEmail: string;
  managerName: string;
  coachName: string;
}

const DOC_TYPES = [
  { id: "attendance-sheet",      label: "출근부",        icon: "📋", desc: "월별 출퇴근 기록" },
  { id: "training-daily-log",    label: "훈련일지",      icon: "📝", desc: "지원고용 훈련일지" },
  { id: "trainee-final-eval",    label: "훈련생 평가",   icon: "📊", desc: "종합 평가기록부" },
  { id: "adaptation-daily-log",  label: "적응지도 일지", icon: "📄", desc: "취업 후 적응지도" },
  { id: "adaptation-final-eval", label: "적응지도 평가", icon: "📈", desc: "적응지도 종합 평가" },
];

export default function DocsPage() {
  const router = useRouter();
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [selectedDoc, setSelectedDoc] = useState("attendance-sheet");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    msg: string;
    pdfBase64?: string;
    fileName?: string;
  } | null>(null);

  // 이번 달 기간 기본값
  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    setPeriodStart(`${y}-${m}-01`);
    setPeriodEnd(`${y}-${m}-${String(lastDay).padStart(2, "0")}`);
  }, []);

  // Site 정보 로드
  useEffect(() => {
    fetch("/api/worker/site/current")
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setSiteInfo({
            companyName: d.data.companyName,
            managerEmail: d.data.managerEmail || "",
            managerName: d.data.managerName || "담당자",
            coachName: d.data.coachName || "",
          });
        }
      });
  }, []);

  // PDF 생성 + 이메일 자동 발송
  async function handleSend() {
    if (!siteInfo?.managerEmail) {
      alert("에이전시 담당자 이메일이 등록되지 않았습니다.\n관리자에게 문의해주세요.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/worker/docs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: selectedDoc,
          periodStart,
          periodEnd,
          sendEmail: true,
          toEmail: siteInfo.managerEmail,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setResult({ success: false, msg: data.message || "오류가 발생했습니다." });
        return;
      }

      setResult({
        success: true,
        msg: data.message,
        pdfBase64: data.pdfBase64,
        fileName: data.fileName,
      });
    } catch {
      setResult({ success: false, msg: "서버와 연결할 수 없습니다." });
    } finally {
      setLoading(false);
    }
  }

  // PDF 다운로드
  function handleDownload() {
    if (!result?.pdfBase64 || !result?.fileName) return;
    const blob = new Blob(
      [Uint8Array.from(atob(result.pdfBase64), c => c.charCodeAt(0))],
      { type: "application/pdf" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* 헤더 */}
        <div style={s.header}>
          <button onClick={() => router.back()} style={s.backBtn}>←</button>
          <h1 style={s.title}>문서 발송</h1>
          <div style={{ width: 36 }} />
        </div>

        {/* 현장 + 수신자 정보 */}
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
                {siteInfo.managerName
                  ? `${siteInfo.managerName} (${siteInfo.managerEmail || "이메일 미등록"})`
                  : siteInfo.managerEmail || "담당자 미등록"}
              </span>
            </div>
          </div>
        )}

        {/* 문서 종류 선택 */}
        <div style={s.section}>
          <p style={s.sectionTitle}>문서 종류</p>
          <div style={s.docList}>
            {DOC_TYPES.map(doc => (
              <button
                key={doc.id}
                style={{ ...s.docItem, ...(selectedDoc === doc.id ? s.docItemActive : {}) }}
                onClick={() => { setSelectedDoc(doc.id); setResult(null); }}
              >
                <span style={s.docIcon}>{doc.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={s.docLabel}>{doc.label}</p>
                  <p style={s.docDesc}>{doc.desc}</p>
                </div>
                {selectedDoc === doc.id && <span style={s.checkIcon}>✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* 기간 설정 */}
        <div style={s.section}>
          <p style={s.sectionTitle}>기간 설정</p>
          <div style={s.dateRow}>
            <input type="date" value={periodStart}
              onChange={e => { setPeriodStart(e.target.value); setResult(null); }}
              style={s.dateInput} />
            <span style={s.dateSep}>~</span>
            <input type="date" value={periodEnd}
              onChange={e => { setPeriodEnd(e.target.value); setResult(null); }}
              style={s.dateInput} />
          </div>
        </div>

        {/* 결과 */}
        {result && (
          <div style={{
            ...s.resultBox,
            backgroundColor: result.success ? "#e8f5e9" : "#ffebee",
            borderColor: result.success ? "#a5d6a7" : "#ef9a9a",
          }}>
            <p style={{
              ...s.resultMsg,
              color: result.success ? "#2e7d32" : "#c62828",
            }}>
              {result.success ? "✅ " : "❌ "}{result.msg}
            </p>
            {result.success && result.pdfBase64 && (
              <button style={s.downloadBtn} onClick={handleDownload}>
                📥 PDF 다운로드 (내 사본 보관용)
              </button>
            )}
          </div>
        )}

        {/* 발송 버튼 */}
        <button
          style={{ ...s.sendBtn, opacity: loading ? 0.7 : 1 }}
          onClick={handleSend}
          disabled={loading}
        >
          {loading
            ? "⏳ PDF 생성 및 발송 중..."
            : `📧 ${DOC_TYPES.find(d => d.id === selectedDoc)?.label || "문서"} 발송`}
        </button>

        {/* 안내 */}
        <div style={s.noteBox}>
          <p style={s.noteText}>
            📨 버튼을 누르면 PDF가 자동으로 생성되어<br />
            에이전시 담당자 이메일로 즉시 발송됩니다.<br />
            <br />
            💡 PDF 생성을 위해 jsreport 서버가<br />
            실행 중이어야 합니다.
          </p>
        </div>

      </div>

      {/* 하단 네비게이션 */}
      <nav style={s.bottomNav}>
        <button style={s.navItem} onClick={() => router.push("/worker/home")}>
          <span style={s.navIcon}>🏠</span>
          <span style={s.navLabel}>홈</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/calendar")}>
          <span style={s.navIcon}>📅</span>
          <span style={s.navLabel}>캘린더</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/signature")}>
          <span style={s.navIcon}>✍️</span>
          <span style={s.navLabel}>전자서명</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/docs")}>
          <span style={{ ...s.navIcon, color: "#2563eb" }}>📄</span>
          <span style={{ ...s.navLabel, color: "#2563eb" }}>문서</span>
        </button>
      </nav>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f8f9ff" },
  container: { maxWidth: 480, margin: "0 auto", padding: "0 0 100px" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", backgroundColor: "#fff", borderBottom: "1px solid #eee", position: "sticky", top: 0, zIndex: 10 },
  backBtn: { background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#333", width: 36 },
  title: { fontSize: 18, fontWeight: 700, color: "#333", margin: 0 },

  infoCard: { margin: "12px 16px 0", backgroundColor: "#fff", borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" },
  infoRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" },
  infoLabel: { fontSize: 13, color: "#888", flexShrink: 0, marginRight: 12 },
  infoValue: { fontSize: 14, fontWeight: 600, color: "#333", textAlign: "right" as const },
  infoDivider: { height: 1, backgroundColor: "#f5f5f5", margin: "8px 0" },

  section: { backgroundColor: "#fff", margin: "12px 16px 0", borderRadius: 14, padding: "16px", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#333", margin: "0 0 10px" },

  docList: { display: "flex", flexDirection: "column", gap: 8 },
  docItem: { display: "flex", alignItems: "center", gap: 12, padding: "12px", border: "1.5px solid #eee", borderRadius: 10, backgroundColor: "#fff", cursor: "pointer", textAlign: "left" as const },
  docItemActive: { border: "1.5px solid #2563eb", backgroundColor: "#f0f2ff" },
  docIcon: { fontSize: 24, flexShrink: 0 },
  docLabel: { fontSize: 15, fontWeight: 700, color: "#333", margin: "0 0 2px" },
  docDesc: { fontSize: 12, color: "#888", margin: 0 },
  checkIcon: { color: "#2563eb", fontWeight: 700, fontSize: 18, flexShrink: 0 },

  dateRow: { display: "flex", alignItems: "center", gap: 8 },
  dateInput: { flex: 1, height: 44, border: "1.5px solid #eee", borderRadius: 8, padding: "0 10px", fontSize: 14, color: "#333", outline: "none" },
  dateSep: { color: "#888", flexShrink: 0 },

  resultBox: { margin: "12px 16px 0", padding: "14px 16px", borderRadius: 12, border: "1px solid" },
  resultMsg: { fontSize: 14, margin: "0 0 10px", fontWeight: 600 },
  downloadBtn: { width: "100%", padding: "10px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },

  sendBtn: { width: "calc(100% - 32px)", margin: "16px 16px 0", padding: "17px", backgroundColor: "#2563eb", color: "#fff", fontSize: 17, fontWeight: 700, border: "none", borderRadius: 12, cursor: "pointer" },

  noteBox: { margin: "12px 16px 0", padding: "14px 16px", backgroundColor: "#f0f2ff", borderRadius: 12 },
  noteText: { fontSize: 13, color: "#2563eb", margin: 0, lineHeight: 1.7, textAlign: "center" as const },

  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, backgroundColor: "#fff", borderTop: "1px solid #eee", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" },
  navItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "10px 0", border: "none", backgroundColor: "transparent", cursor: "pointer" },
  navIcon: { fontSize: 22 },
  navLabel: { fontSize: 11, color: "#888", fontWeight: 500 },
};
