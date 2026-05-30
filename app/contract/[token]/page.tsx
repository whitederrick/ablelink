"use client";
// app/contract/[token]/page.tsx
// 근로계약서 서명 페이지 — 카카오 링크로 접근, 비로그인 허용

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type ContractStatus = "PENDING" | "SIGNED" | "COMPLETED" | "CANCELLED";

interface ContractData {
  id: string;
  status: ContractStatus;
  workerName: string;
  workerPhone: string;
  agencyName: string;
  agencyAddress: string | null;
  agencyPhone: string | null;
  contractStart: string;
  contractEnd: string;
  siteName: string | null;
  workTypeLabel: string;
  commuteGuidanceIncluded: boolean;
  workerFilledSiteName: string | null;
  workerFilledWorkType: string | null;
  workerSignedAt: string | null;
  adminSignedAt: string | null;
  workerSignatureUrl: string | null;
}

// ── 서명 캔버스 ───────────────────────────────────────────────
function SignatureCanvas({ onSigned }: { onSigned: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasSig, setHasSig] = useState(false);

  function getPos(e: React.TouchEvent | React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function start(e: React.TouchEvent | React.MouseEvent) {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.TouchEvent | React.MouseEvent) {
    e.preventDefault();
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSig(true);
  }

  function end() { drawing.current = false; }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  }

  function confirm() {
    if (!hasSig) return;
    onSigned(canvasRef.current!.toDataURL("image/png"));
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={340}
        height={160}
        style={{ border: "1.5px solid #d1d5db", borderRadius: 8, background: "#fafafa", touchAction: "none", width: "100%", maxWidth: 340, display: "block" }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" onClick={clear} style={{ flex: 1, padding: "9px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer", color: "#6b7280" }}>
          다시 쓰기
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!hasSig}
          style={{ flex: 2, padding: "9px", border: "none", borderRadius: 8, background: hasSig ? "#2563eb" : "#e5e7eb", color: hasSig ? "#fff" : "#9ca3af", fontSize: 13, fontWeight: 700, cursor: hasSig ? "pointer" : "not-allowed" }}
        >
          서명 확인
        </button>
      </div>
    </div>
  );
}

// ── 계약서 본문 ───────────────────────────────────────────────
function ContractBody({ data, filledSite, filledWork }: { data: ContractData; filledSite: string; filledWork: string }) {
  const siteName  = data.siteName  || filledSite  || "(미정)";
  const workLabel = data.workTypeLabel || filledWork || "(미정)";

  const guidanceDesc = data.workTypeLabel.includes("전일")
    ? "해당 없음 (전일 8시간 근무)"
    : data.commuteGuidanceIncluded
    ? "출퇴근 지도 포함 (+60분), 휴게시간 지도 포함 (+30분)"
    : "휴게시간 지도만 포함 (+30분)";

  return (
    <div style={{ fontSize: 13, lineHeight: 1.9, color: "#374151" }}>
      <p><strong>근로계약서</strong></p>
      <p>
        위탁기관(이하 "갑") <strong>{data.agencyName}</strong>과
        직무지도원(이하 "을") <strong>{data.workerName}</strong>은 아래와 같이 근로계약을 체결한다.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", margin: "12px 0", fontSize: 13 }}>
        <tbody>
          {[
            ["계약 기간", `${data.contractStart} ~ ${data.contractEnd}`],
            ["근무 사업체", siteName],
            ["근무 형태", workLabel],
            ["지도 추가 시간", guidanceDesc],
          ].map(([label, value]) => (
            <tr key={label}>
              <td style={{ padding: "6px 10px", background: "#f9fafb", border: "1px solid #e5e7eb", fontWeight: 600, width: "35%", color: "#6b7280" }}>{label}</td>
              <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ol style={{ paddingLeft: 18, margin: "12px 0" }}>
        <li>을은 위탁기관의 지침에 따라 성실히 직무지도 업무를 수행한다.</li>
        <li>근무 형태와 시간은 위탁기관이 확정하며, 을은 이를 임의로 변경할 수 없다.</li>
        <li>위탁기관 또는 훈련생이 배치된 사업체에서 을의 계속 근무를 거부하는 경우, 본 계약은 해지될 수 있다. 이 경우 갑은 사전 통지하여야 한다.</li>
        <li>장애인 또는 사업체의 사정으로 직무지도 불필요 판정 시, 잔여 기간에 대한 계약은 종료될 수 있으며, 이미 근무한 기간의 임금은 정산하여 지급한다.</li>
        <li>기타 사항은 근로기준법 및 위탁기관 내규에 따른다.</li>
      </ol>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────
export default function ContractSignPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ContractData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filledSite, setFilledSite]   = useState("");
  const [filledWork, setFilledWork]   = useState("");
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [done, setDone]                 = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/worker/contracts?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) { setError(d.message); return; }
        setData(d.data);
        if (d.data.workerFilledSiteName) setFilledSite(d.data.workerFilledSiteName);
        if (d.data.workerFilledWorkType) setFilledWork(d.data.workerFilledWorkType);
      })
      .catch(() => setError("서버 오류가 발생했습니다."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit() {
    if (!signatureUrl) { alert("서명을 입력해주세요."); return; }
    if (!data) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/worker/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, signatureUrl, workerFilledSiteName: filledSite || null, workerFilledWorkType: filledWork || null }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      setDone(true);
    } catch (e: any) {
      alert(e.message || "서명 처리에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={ps.center}><div style={ps.spinner} /></div>;
  if (error)   return <div style={ps.center}><p style={{ color: "#dc2626", textAlign: "center" }}>{error}</p></div>;
  if (!data)   return null;

  if (done || data.status === "SIGNED" || data.status === "COMPLETED") {
    return (
      <div style={ps.center}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>서명이 완료되었습니다</h2>
          <p style={{ fontSize: 14, color: "#6b7280" }}>계약서가 위탁기관에 전달되었습니다.</p>
          {data.workerSignatureUrl && (
            <img src={data.workerSignatureUrl} alt="서명" style={{ maxWidth: 200, marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 8 }} />
          )}
        </div>
      </div>
    );
  }

  const needSiteName  = !data.siteName;
  const needWorkType  = !data.workTypeLabel || data.workTypeLabel === "(미정)";

  return (
    <div style={ps.page}>
      <div style={ps.card}>
        {/* 헤더 */}
        <div style={ps.header}>
          <div style={ps.agencyBadge}>{data.agencyName}</div>
          <h1 style={ps.title}>근로계약서</h1>
          <p style={ps.sub}>{data.workerName}님의 서명을 요청드립니다</p>
        </div>

        {/* 계약서 본문 */}
        <div style={ps.body}>
          <ContractBody data={data} filledSite={filledSite} filledWork={filledWork} />
        </div>

        {/* 직무지도원 직접 입력 (관리자 미입력 시) */}
        {(needSiteName || needWorkType) && (
          <div style={ps.section}>
            <h3 style={ps.sectionTitle}>추가 정보 입력 (관리자 미입력 항목)</h3>
            {needSiteName && (
              <div style={{ marginBottom: 12 }}>
                <label style={ps.label}>근무 사업체명</label>
                <input
                  value={filledSite}
                  onChange={e => setFilledSite(e.target.value)}
                  placeholder="사업체명을 입력하세요"
                  style={ps.input}
                />
              </div>
            )}
            {needWorkType && (
              <div>
                <label style={ps.label}>근무 형태</label>
                <input
                  value={filledWork}
                  onChange={e => setFilledWork(e.target.value)}
                  placeholder="예: 오전 4시간 (09:00~12:00)"
                  style={ps.input}
                />
              </div>
            )}
          </div>
        )}

        {/* 서명 */}
        <div style={ps.section}>
          <h3 style={ps.sectionTitle}>직무지도원 서명</h3>
          {signatureUrl ? (
            <div style={{ textAlign: "center" }}>
              <img src={signatureUrl} alt="서명" style={{ maxWidth: "100%", border: "1px solid #e5e7eb", borderRadius: 8 }} />
              <button type="button" onClick={() => setSignatureUrl(null)} style={{ marginTop: 8, padding: "6px 16px", border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff", fontSize: 13, cursor: "pointer" }}>
                다시 서명
              </button>
            </div>
          ) : (
            <SignatureCanvas onSigned={setSignatureUrl} />
          )}
        </div>

        {/* 제출 */}
        <button
          onClick={handleSubmit}
          disabled={!signatureUrl || submitting}
          style={{
            ...ps.submitBtn,
            opacity: signatureUrl && !submitting ? 1 : 0.5,
            cursor: signatureUrl && !submitting ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "제출 중..." : "계약서 서명 완료"}
        </button>

        <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 12 }}>
          이 링크는 {new Date(data.workerSignedAt ?? "").toLocaleDateString() || "7일"} 후 만료됩니다.
        </p>
      </div>
    </div>
  );
}

const ps: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f9fafb", padding: "20px 16px", boxSizing: "border-box" },
  card: { maxWidth: 520, margin: "0 auto", background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", overflow: "hidden" },
  center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  spinner: { width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  header: { background: "linear-gradient(135deg, #1e40af, #3b82f6)", color: "#fff", padding: "28px 24px 20px", textAlign: "center" as const },
  agencyBadge: { display: "inline-block", background: "rgba(255,255,255,0.2)", borderRadius: 20, padding: "4px 12px", fontSize: 12, marginBottom: 10 },
  title: { fontSize: 22, fontWeight: 800, margin: "0 0 6px" },
  sub: { fontSize: 14, opacity: 0.85, margin: 0 },
  body: { padding: "20px 24px", borderBottom: "1px solid #f0f0f0" },
  section: { padding: "20px 24px", borderBottom: "1px solid #f0f0f0" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#111827", margin: "0 0 14px" },
  label: { fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 6 },
  input: { width: "100%", height: 42, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 12px", fontSize: 14, boxSizing: "border-box" as const },
  submitBtn: { display: "block", width: "calc(100% - 48px)", margin: "20px 24px 8px", padding: "14px", background: "#2563eb", color: "#fff", fontSize: 15, fontWeight: 700, border: "none", borderRadius: 10 },
};
