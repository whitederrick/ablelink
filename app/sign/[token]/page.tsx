"use client";
// app/sign/[token]/page.tsx
// 사업체담당자 즉석 서명 페이지 (공개 — 스마트폰 접속)

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SignaturePad, type SignaturePadHandle } from "../../_components/SignaturePad";

type Info = {
  docType: string; roleLabel: string; signerName: string | null;
  companyName: string; periodStart: string; periodEnd: string;
};

const DOC_LABELS: Record<string, string> = {
  "attendance-sheet":      "직무지도원 출근부",
  "training-daily-log":    "지원고용 훈련일지",
  "trainee-final-eval":    "훈련생 종합 평가기록부",
  "adaptation-daily-log":  "취업 후 적응지도 일지",
  "adaptation-final-eval": "적응지도 종합 평가기록부",
};

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo]   = useState<Info | null>(null);
  const [phase, setPhase] = useState<"loading"|"ready"|"done"|"error"|"expired"|"signed">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const padRef = useRef<SignaturePadHandle>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    fetch(`/api/sign/${token}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) {
          if (d.expired) { setPhase("expired"); return; }
          if (d.signed)  { setPhase("signed");  return; }
          setPhase("error"); setErrorMsg(d.message || "오류");
        } else {
          setInfo(d); setPhase("ready");
        }
      })
      .catch(() => { setPhase("error"); setErrorMsg("서버 연결 실패"); });
  }, [token]);

  async function submit() {
    const blob = await padRef.current?.getBlob();
    if (!blob) { alert("서명을 입력해주세요."); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("signature", blob, "signature.png");
      const res = await fetch(`/api/sign/${token}`, { method: "POST", body: fd });
      const d = await res.json();
      if (d.success) setPhase("done");
      else alert(d.message || "저장 실패");
    } catch { alert("서명 이미지 생성 실패"); }
    finally { setSaving(false); }
  }

  if (phase === "loading") return (
    <div style={s.center}>
      <div style={s.spinner} />
      <p style={{ color:"#9ca3af", marginTop:12 }}>확인 중...</p>
    </div>
  );

  if (phase === "expired") return (
    <div style={s.center}>
      <span style={{ fontSize:48 }}>⏰</span>
      <p style={s.bigMsg}>서명 링크가 만료되었습니다.</p>
      <p style={s.subMsg}>직무지도원에게 새 링크를 요청해주세요.</p>
    </div>
  );

  if (phase === "signed") return (
    <div style={s.center}>
      <span style={{ fontSize:48 }}>✅</span>
      <p style={s.bigMsg}>이미 서명이 완료된 링크입니다.</p>
    </div>
  );

  if (phase === "error") return (
    <div style={s.center}>
      <span style={{ fontSize:48 }}>❌</span>
      <p style={s.bigMsg}>유효하지 않은 링크입니다.</p>
      <p style={s.subMsg}>{errorMsg}</p>
    </div>
  );

  if (phase === "done") return (
    <div style={s.center}>
      <span style={{ fontSize:64 }}>✍️</span>
      <p style={{ ...s.bigMsg, color:"#16a34a" }}>서명이 완료되었습니다!</p>
      <p style={s.subMsg}>이 창을 닫으셔도 됩니다.</p>
    </div>
  );

  return (
    <div style={s.page}>
      {/* 헤더 */}
      <div style={s.header}>
        <div style={s.logoText}>
          <span style={{ color:"#111827" }}>Able</span>
          <span style={{ color:"#ef4444" }}>Link</span>
        </div>
        <p style={s.headerSub}>전자서명 요청</p>
      </div>

      <div style={s.container}>
        {/* 문서 정보 */}
        <div style={s.infoCard}>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>문서</span>
            <span style={s.infoValue}>{DOC_LABELS[info!.docType] ?? info!.docType}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>사업체</span>
            <span style={s.infoValue}>{info!.companyName}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>기간</span>
            <span style={s.infoValue}>{info!.periodStart} ~ {info!.periodEnd}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>서명자</span>
            <span style={{ ...s.infoValue, fontWeight:700, color:"#111827" }}>
              {info!.roleLabel}{info!.signerName ? ` (${info!.signerName})` : ""}
            </span>
          </div>
        </div>

        {/* 서명 안내 */}
        <div style={s.signLabel}>
          <span>아래 영역에 서명해주세요</span>
          <button onClick={() => padRef.current?.clear()} style={s.clearBtn}>지우기</button>
        </div>

        {/* 서명 패드 (공용 — 고해상도·스무딩·trim) */}
        <div style={s.canvasWrap}>
          <SignaturePad ref={padRef} height={220} onChange={setEmpty} />
          <p style={s.canvasHint}>✍️ 패드 전체에 꽉 차게 서명해 주세요</p>
        </div>

        {/* 제출 */}
        <button
          onClick={submit}
          disabled={saving || empty}
          style={{ ...s.submitBtn, opacity: saving || empty ? 0.5 : 1 }}
        >
          {saving ? "저장 중..." : "서명 완료"}
        </button>

        <p style={s.notice}>
          본 서명은 {DOC_LABELS[info!.docType] ?? info!.docType}에 전자서명으로 삽입됩니다.
        </p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:       { minHeight:"100dvh", backgroundColor:"#f9fafb" },
  container:  { maxWidth:480, margin:"0 auto", padding:"16px 16px 40px" },
  center:     { minHeight:"100dvh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, padding:20, textAlign:"center" },
  spinner:    { width:36, height:36, border:"3px solid #e5e7eb", borderTop:"3px solid #111827", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  bigMsg:     { fontSize:18, fontWeight:700, color:"#111827", margin:0 },
  subMsg:     { fontSize:14, color:"#9ca3af", margin:0 },

  header:     { backgroundColor:"#fff", borderBottom:"1px solid #f3f4f6", padding:"16px", textAlign:"center" },
  logoText:   { fontSize:22, fontWeight:800, letterSpacing:"-0.5px" },
  headerSub:  { fontSize:13, color:"#9ca3af", margin:"4px 0 0", fontWeight:500 },

  infoCard:   { backgroundColor:"#fff", borderRadius:14, padding:"16px", marginBottom:16, border:"1px solid #f3f4f6" },
  infoRow:    { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid #f9fafb" },
  infoLabel:  { fontSize:13, color:"#9ca3af", fontWeight:600 },
  infoValue:  { fontSize:13, color:"#374151", fontWeight:500, textAlign:"right", flex:1, marginLeft:12 },

  signLabel:  { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 },
  clearBtn:   { background:"none", border:"1px solid #e5e7eb", borderRadius:6, padding:"5px 12px", fontSize:13, color:"#374151", cursor:"pointer" },

  canvasWrap: { position:"relative", backgroundColor:"#fff", borderRadius:14, border:"2px solid #374151", overflow:"hidden", marginBottom:14 },
  canvas:     { display:"block", width:"100%", height:"160px", touchAction:"none", cursor:"crosshair", backgroundColor:"#fff" },
  canvasHint: { position:"absolute", bottom:8, right:12, fontSize:11, color:"#d1d5db", margin:0, pointerEvents:"none" },

  submitBtn:  { width:"100%", padding:"16px", backgroundColor:"#111827", color:"#fff", border:"none", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer", marginBottom:12 },
  notice:     { fontSize:12, color:"#9ca3af", textAlign:"center", lineHeight:1.6 },
};
