"use client";
// app/contract/[token]/page.tsx
// 근로계약서 서명 페이지 — 카카오 링크로 접근, 비로그인 허용. 고용노동부 표준양식 렌더.

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type ContractStatus = "PENDING" | "SIGNED" | "COMPLETED" | "CANCELLED";

interface ContractData {
  id: string;
  status: ContractStatus;
  workerName: string;
  workerPhone: string;
  agencyName: string;
  contractStart: string;
  contractEnd: string;
  workLocation: string | null;
  jobDescription: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  workDaysPerWeek: number | null;
  weeklyHoliday: string | null;
  wageType: string | null;
  wageAmount: number | null;
  bonusExists: boolean;
  bonusAmount: number | null;
  extraPayExists: boolean;
  extraPayDesc: string | null;
  overtimeRate: number | null;
  wagePayday: string | null;
  wagePayMethod: string | null;
  employerBizName: string | null;
  employerPhone: string | null;
  employerAddress: string | null;
  employerRepName: string | null;
  workerAddress: string | null;
  workerFilledAddress: string | null;
  specialClauses: { title: string; body: string }[];
  workerSignedAt: string | null;
  workerSignatureUrl: string | null;
}

// ── 서명 캔버스 ───────────────────────────────────────────────
function SignatureCanvas({ onSigned }: { onSigned: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasSig, setHasSig] = useState(false);

  function getPos(e: React.TouchEvent | React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    if ("touches" in e) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }
  function start(e: React.TouchEvent | React.MouseEvent) { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current!.getContext("2d")!; const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y); }
  function move(e: React.TouchEvent | React.MouseEvent) { e.preventDefault(); if (!drawing.current) return; const ctx = canvasRef.current!.getContext("2d")!; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#111827"; const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); setHasSig(true); }
  function end() { drawing.current = false; }
  function clear() { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setHasSig(false); }
  function confirm() { if (!hasSig) return; onSigned(canvasRef.current!.toDataURL("image/png")); }

  return (
    <div>
      <canvas ref={canvasRef} width={340} height={160}
        style={{ border: "1.5px solid #d1d5db", borderRadius: 8, background: "#fafafa", touchAction: "none", width: "100%", maxWidth: 340, display: "block" }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" onClick={clear} style={{ flex: 1, padding: "9px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer", color: "#6b7280" }}>다시 쓰기</button>
        <button type="button" onClick={confirm} disabled={!hasSig} style={{ flex: 2, padding: "9px", border: "none", borderRadius: 8, background: hasSig ? "#2563eb" : "#e5e7eb", color: hasSig ? "#fff" : "#9ca3af", fontSize: 13, fontWeight: 700, cursor: hasSig ? "pointer" : "not-allowed" }}>서명 확인</button>
      </div>
    </div>
  );
}

// ── 표준양식 본문 ─────────────────────────────────────────────
function won(n: number | null): string { return n == null ? "" : `${Number(n).toLocaleString("ko-KR")}원`; }
function hm(t: string | null): string { return t || "––:––"; }
const WAGE_LABEL: Record<string, string> = { HOURLY: "시급", DAILY: "일급", MONTHLY: "월급" };

function Row({ no, label, children }: { no?: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "7px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13, lineHeight: 1.6 }}>
      <span style={{ flexShrink: 0, fontWeight: 700, color: "#374151", minWidth: 100 }}>{no ? `${no}. ` : ""}{label}</span>
      <span style={{ color: "#111827" }}>{children}</span>
    </div>
  );
}

function StandardContractBody({ d, addr }: { d: ContractData; addr: string }) {
  const breakStr = (d.breakStartTime || d.breakEndTime) ? `${hm(d.breakStartTime)} ~ ${hm(d.breakEndTime)}` : "-";
  return (
    <div>
      <p style={{ fontSize: 13, lineHeight: 1.8, color: "#374151", marginBottom: 12 }}>
        <strong>{d.employerBizName || d.agencyName}</strong>(이하 &quot;사업주&quot;)과(와) <strong>{d.workerName}</strong>(이하 &quot;근로자&quot;)은 다음과 같이 근로계약을 체결한다.
      </p>
      <Row no="1" label="근로계약기간">{d.contractStart} ~ {d.contractEnd}</Row>
      <Row no="2" label="근무장소">{d.workLocation || "-"}</Row>
      <Row no="3" label="업무의 내용">{d.jobDescription || "-"}</Row>
      <Row no="4" label="소정근로시간">{hm(d.workStartTime)} ~ {hm(d.workEndTime)} (휴게: {breakStr})</Row>
      <Row no="5" label="근무일/휴일">매주 {d.workDaysPerWeek ?? "-"}일 근무, 주휴일 매주 {d.weeklyHoliday || "-"}요일</Row>
      <Row no="6" label="임금">
        <div>
          <div>· {d.wageType ? WAGE_LABEL[d.wageType] : "임금"} : {won(d.wageAmount) || "-"}</div>
          <div>· 상여금 : {d.bonusExists ? `있음 ${won(d.bonusAmount)}` : "없음"}</div>
          <div>· 기타급여 : {d.extraPayExists ? `있음 (${d.extraPayDesc || ""})` : "없음"}</div>
          <div>· 초과근로 가산임금률 : {d.overtimeRate != null ? `${d.overtimeRate}%` : "-"}</div>
          <div>· 임금지급일 : 매월 {d.wagePayday || "-"}일</div>
          <div>· 지급방법 : {d.wagePayMethod === "DIRECT" ? "근로자에게 직접지급" : d.wagePayMethod === "ACCOUNT" ? "예금통장 입금" : "-"}</div>
        </div>
      </Row>
      <Row no="7" label="연차유급휴가">통상근로자의 근로시간에 비례하여 부여</Row>
      <Row no="8" label="근로계약서 교부">근로기준법 제17조에 따라 근로자에게 교부함</Row>
      <Row no="9" label="기타">이 계약에 정함이 없는 사항은 근로기준법령에 의함</Row>
      {d.specialClauses.length > 0 && (
        <div style={{ padding: "7px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
          <p style={{ fontWeight: 700, color: "#374151", marginBottom: 4 }}>10. 특약사항</p>
          {d.specialClauses.map((c, i) => (
            <div key={i} style={{ marginBottom: 4, paddingLeft: 8 }}>
              <span style={{ fontWeight: 700 }}>{i + 1}) {c.title}</span>
              {c.body && <p style={{ color: "#6b7280", fontSize: 12, margin: "2px 0 0 12px", whiteSpace: "pre-wrap" }}>{c.body}</p>}
            </div>
          ))}
        </div>
      )}
      {/* 당사자 정보 */}
      <div style={{ marginTop: 14, fontSize: 12.5, color: "#374151", lineHeight: 1.9 }}>
        <p style={{ fontWeight: 700, marginBottom: 2 }}>(사업주)</p>
        <p style={{ paddingLeft: 10 }}>사업체명: {d.employerBizName || d.agencyName} {d.employerPhone ? `(전화: ${d.employerPhone})` : ""}</p>
        <p style={{ paddingLeft: 10 }}>주소: {d.employerAddress || "-"}</p>
        <p style={{ paddingLeft: 10 }}>대표자: {d.employerRepName || "-"}</p>
        <p style={{ fontWeight: 700, margin: "8px 0 2px" }}>(근로자)</p>
        <p style={{ paddingLeft: 10 }}>주소: {addr || d.workerAddress || "(서명 시 입력)"}</p>
        <p style={{ paddingLeft: 10 }}>연락처: {d.workerPhone}</p>
        <p style={{ paddingLeft: 10 }}>성명: {d.workerName}</p>
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────
export default function ContractSignPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ContractData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addr, setAddr] = useState("");
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/worker/contracts?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) { setError(d.message); return; }
        setData(d.data);
        if (d.data.workerFilledAddress) setAddr(d.data.workerFilledAddress);
        else if (d.data.workerAddress) setAddr(d.data.workerAddress);
      })
      .catch(() => setError("서버 오류가 발생했습니다."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit() {
    if (!signatureUrl) { alert("서명을 입력해주세요."); return; }
    if (!data) return;
    if (!addr.trim() && !data.workerAddress) { alert("근로자 주소를 입력해주세요."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/worker/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, signatureUrl, workerFilledAddress: addr || null }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      setDone(true);
    } catch (e: any) { alert(e.message || "서명 처리에 실패했습니다."); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div style={ps.center}><div style={ps.spinner} /></div>;
  if (error) return <div style={ps.center}><p style={{ color: "#dc2626", textAlign: "center" }}>{error}</p></div>;
  if (!data) return null;

  if (done || data.status === "SIGNED" || data.status === "COMPLETED") {
    return (
      <div style={ps.center}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>서명이 완료되었습니다</h2>
          <p style={{ fontSize: 14, color: "#6b7280" }}>계약서가 사업주에게 전달되었습니다.</p>
          {data.workerSignatureUrl && <img src={data.workerSignatureUrl} alt="서명" style={{ maxWidth: 200, marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8 }} />}
        </div>
      </div>
    );
  }

  const needAddr = !data.workerAddress;

  return (
    <div style={ps.page}>
      <div style={ps.card}>
        <div style={ps.header}>
          <div style={ps.agencyBadge}>{data.employerBizName || data.agencyName}</div>
          <h1 style={ps.title}>단시간근로자 표준근로계약서</h1>
          <p style={ps.sub}>{data.workerName}님의 서명을 요청드립니다</p>
        </div>

        <div style={ps.body}><StandardContractBody d={data} addr={addr} /></div>

        {needAddr && (
          <div style={ps.section}>
            <h3 style={ps.sectionTitle}>근로자 주소 입력</h3>
            <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="주소를 입력하세요" style={ps.input} />
          </div>
        )}

        <div style={ps.section}>
          <h3 style={ps.sectionTitle}>근로자 서명</h3>
          {signatureUrl ? (
            <div style={{ textAlign: "center" }}>
              <img src={signatureUrl} alt="서명" style={{ maxWidth: "100%", border: "1px solid #e5e7eb", borderRadius: 8 }} />
              <button type="button" onClick={() => setSignatureUrl(null)} style={{ marginTop: 8, padding: "6px 16px", border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff", fontSize: 13, cursor: "pointer" }}>다시 서명</button>
            </div>
          ) : <SignatureCanvas onSigned={setSignatureUrl} />}
        </div>

        <button onClick={handleSubmit} disabled={!signatureUrl || submitting}
          style={{ ...ps.submitBtn, opacity: signatureUrl && !submitting ? 1 : 0.5, cursor: signatureUrl && !submitting ? "pointer" : "not-allowed" }}>
          {submitting ? "제출 중..." : "계약서 서명 완료"}
        </button>
        <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 12 }}>서명 시 위 계약 내용에 동의하는 것으로 간주됩니다.</p>
      </div>
    </div>
  );
}

const ps: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f9fafb", padding: "20px 16px", boxSizing: "border-box" },
  card: { maxWidth: 560, margin: "0 auto", background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", overflow: "hidden" },
  center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  spinner: { width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  header: { background: "linear-gradient(135deg, #1e40af, #3b82f6)", color: "#fff", padding: "28px 24px 20px", textAlign: "center" as const },
  agencyBadge: { display: "inline-block", background: "rgba(255,255,255,0.2)", borderRadius: 20, padding: "4px 12px", fontSize: 12, marginBottom: 10 },
  title: { fontSize: 19, fontWeight: 800, margin: "0 0 6px" },
  sub: { fontSize: 14, opacity: 0.85, margin: 0 },
  body: { padding: "20px 24px", borderBottom: "1px solid #f0f0f0" },
  section: { padding: "20px 24px", borderBottom: "1px solid #f0f0f0" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#111827", margin: "0 0 14px" },
  input: { width: "100%", height: 42, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 12px", fontSize: 14, boxSizing: "border-box" as const },
  submitBtn: { display: "block", width: "calc(100% - 48px)", margin: "20px 24px 8px", padding: "14px", background: "#2563eb", color: "#fff", fontSize: 15, fontWeight: 700, border: "none", borderRadius: 10 },
};
