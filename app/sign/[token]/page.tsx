"use client";
// app/sign/[token]/page.tsx
// 사업체담당자 즉석 서명 페이지 (공개 — 스마트폰 접속)

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

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

// 서명 이미지를 고정 크기(w x h)로 리사이즈
async function resizeSignature(src: HTMLCanvasElement, w: number, h: number): Promise<Blob> {
  const offscreen = document.createElement("canvas");
  offscreen.width = w; offscreen.height = h;
  const ctx = offscreen.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  const pad = 20;
  const scale = Math.min((w - pad*2) / src.width, (h - pad*2) / src.height);
  const sw = src.width * scale, sh = src.height * scale;
  ctx.drawImage(src, (w-sw)/2, (h-sh)/2, sw, sh);
  return new Promise<Blob>((res, rej) => {
    offscreen.toBlob(b => b ? res(b) : rej(new Error("변환 실패")), "image/png", 0.95);
  });
}


export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo]   = useState<Info | null>(null);
  const [phase, setPhase] = useState<"loading"|"ready"|"done"|"error"|"expired"|"signed">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos   = useRef<{ x: number; y: number } | null>(null);

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

  // 캔버스 초기화
  useEffect(() => {
    if (phase !== "ready") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width  = 230;
    canvas.height = 100;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 230, 100);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
  }, [phase]);

  function getPos(e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function startDraw(e: React.TouchEvent | React.MouseEvent) {
    e.preventDefault();
    const canvas = canvasRef.current!;
    isDrawing.current = true;
    lastPos.current = getPos(e, canvas);
  }
  function draw(e: React.TouchEvent | React.MouseEvent) {
    e.preventDefault();
    if (!isDrawing.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    lastPos.current = pos;
  }
  function endDraw() { isDrawing.current = false; lastPos.current = null; }

  function clearCanvas() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 230, 100);
  }

  async function submit() {
    const canvas = canvasRef.current!;
    setSaving(true);
    try {
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(b => b ? res(b) : rej(new Error("변환 실패")), "image/png", 0.95)
      );
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
          <button onClick={clearCanvas} style={s.clearBtn}>지우기</button>
        </div>

        {/* 서명 캔버스 */}
        <div style={s.canvasWrap}>
          <canvas
            ref={canvasRef}
            style={s.canvas}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
          <p style={s.canvasHint}>✍️ 패드 전체에 꽉 차게 서명해 주세요</p>
        </div>

        {/* 제출 */}
        <button
          onClick={submit}
          disabled={saving}
          style={{ ...s.submitBtn, opacity: saving ? 0.7 : 1 }}
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

  canvasWrap: { position:"relative", backgroundColor:"#fff", borderRadius:14, border:"2px solid #e5e7eb", overflow:"hidden", marginBottom:14 },
  canvas:     { display:"block", width:"100%", maxWidth:"230px", height:"100px", touchAction:"none", cursor:"crosshair", border:"2px solid #374151", borderRadius:8, backgroundColor:"#fff" },
  canvasHint: { position:"absolute", bottom:8, right:12, fontSize:11, color:"#d1d5db", margin:0, pointerEvents:"none" },

  submitBtn:  { width:"100%", padding:"16px", backgroundColor:"#111827", color:"#fff", border:"none", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer", marginBottom:12 },
  notice:     { fontSize:12, color:"#9ca3af", textAlign:"center", lineHeight:1.6 },
};
