"use client";
// app/survey/[token]/page.tsx
// 만족도 조사 응답 페이지 — 사업체 담당자(비로그인 토큰 접근)

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface SurveyData { status: string; workerName: string; agencyName?: string; siteName?: string | null; recipientName?: string | null; }

const QUESTIONS: { key: string; label: string }[] = [
  { key: "professionalism", label: "직무지도 전문성 (장애인 직무지도 역량)" },
  { key: "diligence", label: "성실성 및 근태 (출근·시간 준수)" },
  { key: "communication", label: "의사소통 (담당자·근로자와의 소통)" },
  { key: "support", label: "장애인 근로자 지원의 적절성" },
];

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)}
          style={{ fontSize: 30, lineHeight: 1, background: "none", border: "none", cursor: "pointer", color: n <= value ? "#f59e0b" : "#d1d5db", padding: 0 }}>★</button>
      ))}
    </div>
  );
}

export default function SurveyResponsePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SurveyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [overall, setOverall] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/survey/${token}`).then(r => r.json()).then(d => {
      if (!d.success) { setError(d.message); return; }
      setData(d.data);
      if (d.data.status === "RESPONDED") setDone(true);
    }).catch(() => setError("서버 오류가 발생했습니다.")).finally(() => setLoading(false));
  }, [token]);

  async function submit() {
    for (const q of QUESTIONS) if (!scores[q.key]) { alert("모든 항목을 평가해 주세요."); return; }
    if (!overall) { alert("종합 만족도를 평가해 주세요."); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/survey/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scores, overallScore: overall, comment }) });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      setDone(true);
    } catch (e: any) { alert(e.message || "제출 실패"); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div style={S.center}><div style={S.spinner} /></div>;
  if (error) return <div style={S.center}><p style={{ color: "#dc2626", textAlign: "center" }}>{error}</p></div>;
  if (!data) return null;

  if (done) return (
    <div style={S.center}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🙏</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>응답이 제출되었습니다</h2>
        <p style={{ fontSize: 14, color: "#6b7280" }}>소중한 평가 감사합니다.</p>
      </div>
    </div>
  );

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.header}>
          {data.agencyName && <div style={S.badge}>{data.agencyName}</div>}
          <h1 style={S.title}>직무지도원 만족도 평가</h1>
          <p style={S.sub}><strong>{data.workerName}</strong> 직무지도원{data.siteName ? ` · ${data.siteName}` : ""}</p>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 18 }}>각 항목을 1~5점으로 평가해 주세요. (5점 = 매우 만족)</p>
          {QUESTIONS.map(q => (
            <div key={q.key} style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{q.label}</p>
              <Stars value={scores[q.key] || 0} onChange={v => setScores(s => ({ ...s, [q.key]: v }))} />
            </div>
          ))}
          <div style={{ marginBottom: 18, paddingTop: 8, borderTop: "1px solid #f0f0f0" }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: "#111827", marginBottom: 6 }}>종합 만족도</p>
            <Stars value={overall} onChange={setOverall} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>의견 (선택)</p>
            <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="자유롭게 의견을 남겨주세요" rows={4}
              style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 14, boxSizing: "border-box", resize: "none" }} />
          </div>
        </div>
        <button onClick={submit} disabled={submitting}
          style={{ display: "block", width: "calc(100% - 48px)", margin: "0 24px 20px", padding: 14, background: "#2563eb", color: "#fff", fontSize: 15, fontWeight: 700, border: "none", borderRadius: 10, opacity: submitting ? 0.5 : 1, cursor: submitting ? "not-allowed" : "pointer" }}>
          {submitting ? "제출 중..." : "평가 제출"}
        </button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f9fafb", padding: "20px 16px", boxSizing: "border-box" },
  card: { maxWidth: 480, margin: "0 auto", background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", overflow: "hidden" },
  center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  spinner: { width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  header: { background: "linear-gradient(135deg, #1e40af, #3b82f6)", color: "#fff", padding: "28px 24px 20px", textAlign: "center" as const },
  badge: { display: "inline-block", background: "rgba(255,255,255,0.2)", borderRadius: 20, padding: "4px 12px", fontSize: 12, marginBottom: 10 },
  title: { fontSize: 20, fontWeight: 800, margin: "0 0 6px" },
  sub: { fontSize: 14, opacity: 0.9, margin: 0 },
};
