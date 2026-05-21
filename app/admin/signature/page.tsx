"use client";
// app/admin/signature/page.tsx
// 에이전시 관리자 서명 등록

import { useEffect, useRef, useState } from "react";

async function resizeSignature(src: HTMLCanvasElement, w: number, h: number): Promise<Blob> {
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const ctx = off.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  const pad = 20, scale = Math.min((w-pad*2)/src.width, (h-pad*2)/src.height);
  ctx.drawImage(src, (w-src.width*scale)/2, (h-src.height*scale)/2, src.width*scale, src.height*scale);
  return new Promise<Blob>((res, rej) => off.toBlob(b => b ? res(b) : rej(new Error("변환 실패")), "image/png", 0.95));
}

export default function AdminSignaturePage() {
  const [savedUrl,    setSavedUrl]    = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [mode,    setMode]    = useState<"view"|"draw">("view");
  const [drawing, setDrawing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos   = useRef<{x:number;y:number}|null>(null);

  useEffect(() => {
    fetch("/api/admin/signature").then(r=>r.json()).then(d=>{
      if (d.success) { setSavedUrl(d.signatureUrl); setDisplayName(d.displayName); }
    });
  }, []);

  useEffect(() => {
    if (mode !== "draw") return;
    const c = canvasRef.current; if (!c) return;
    c.width  = 600;
    c.height = 200;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 600, 200);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  }, [mode]);

  function getPos(e: React.MouseEvent | React.TouchEvent, c: HTMLCanvasElement) {
    const r = c.getBoundingClientRect();
    if ("touches" in e) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    return { x: (e as React.MouseEvent).clientX - r.left, y: (e as React.MouseEvent).clientY - r.top };
  }
  function onStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault(); setDrawing(true); lastPos.current = getPos(e, canvasRef.current!);
  }
  function onMove(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault(); if (!drawing) return;
    const c = canvasRef.current!, ctx = c.getContext("2d")!, p = getPos(e, c);
    if (lastPos.current) { ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    lastPos.current = p;
  }
  function onEnd() { setDrawing(false); lastPos.current = null; }
  function clear() {
    const c = canvasRef.current!, ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 600, 200);
  }

  async function save() {
    const c = canvasRef.current!;
    setSaving(true);
    try {
      const blob = await new Promise<Blob>((res, rej) =>
        c.toBlob(b => b ? res(b) : rej(new Error("변환 실패")), "image/png", 0.95)
      );
      const fd = new FormData(); fd.append("signature", blob, "sig.png");
      const d = await fetch("/api/admin/signature", { method: "POST", body: fd }).then(r => r.json());
      if (d.success) { setSavedUrl(d.signatureUrl); setMode("view"); flash("서명이 저장되었습니다."); }
      else flash(d.message || "저장 실패");
    } catch { flash("오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  async function del() {
    if (!confirm("서명을 삭제하시겠습니까?")) return;
    await fetch("/api/admin/signature", { method: "DELETE" });
    setSavedUrl(null); flash("삭제되었습니다.");
  }

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>내 서명 관리</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9ca3af" }}>
          {displayName && `${displayName}님 · `}등록 서명은 문서의 <strong>(위탁기관/공단) 담당자</strong> 서명란에 자동 삽입됩니다.
        </p>
      </div>

      <div style={s.card}>
        <p style={s.sectionTitle}>등록된 서명</p>

        {mode === "view" && (savedUrl ? (
          <>
            <div style={s.previewBox}>
              <img src={savedUrl} alt="서명" style={{ maxHeight: 100, maxWidth: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => setMode("draw")} style={s.btnPrimary}>다시 등록</button>
              <button onClick={del} style={s.btnDanger}>삭제</button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <p style={{ fontSize: 40, margin: "0 0 10px" }}>✍️</p>
            <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: 18 }}>등록된 서명이 없습니다.</p>
            <button onClick={() => setMode("draw")} style={s.btnPrimary}>서명 등록하기</button>
          </div>
        ))}

        {mode === "draw" && (
          <>
            <div style={s.canvasWrap}>
              <canvas ref={canvasRef} style={s.canvasStyle}
                onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
                onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} />
              <p style={s.hint}>마우스 또는 터치로 서명하세요</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={clear} style={s.btnSecondary}>지우기</button>
              <button onClick={save} disabled={saving} style={{ ...s.btnPrimary, opacity: saving ? 0.7 : 1 }}>
                {saving ? "저장 중..." : "저장"}
              </button>
              <button onClick={() => setMode("view")} style={s.btnSecondary}>취소</button>
            </div>
          </>
        )}
      </div>

      <div style={{ ...s.card, marginTop: 12 }}>
        <p style={s.sectionTitle}>서명 사용 안내</p>
        <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 13, color: "#6b7280", lineHeight: 2.0 }}>
          <li><strong>(위탁기관/공단) 담당자</strong> → 현재 로그인한 에이전시 관리자 서명 자동 삽입</li>
          <li><strong>직무지도원</strong> → 직무지도원이 앱에서 등록한 서명 자동 삽입</li>
          <li><strong>사업체 담당자</strong> → 문서 생성 화면에서 QR코드/링크로 현장 즉석 서명</li>
        </ul>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111827", color: "#fff", padding: "11px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 2000 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card:         { background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: "18px 20px" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#111827", margin: "0 0 12px" },
  previewBox:   { backgroundColor: "#f9fafb", borderRadius: 12, padding: 20, border: "2px dashed #e5e7eb", minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center" },
  canvasWrap:   { position: "relative", backgroundColor: "#fff", borderRadius: 12, border: "1.5px solid #e5e7eb", overflow: "hidden", marginBottom: 12 },
  canvasStyle:  { display: "block", width: "100%", height: 180, touchAction: "none", cursor: "crosshair" },
  hint:         { position: "absolute", bottom: 8, right: 12, fontSize: 11, color: "#d1d5db", margin: 0, pointerEvents: "none" },
  btnPrimary:   { padding: "9px 18px", background: "#111827", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnSecondary: { padding: "9px 14px", background: "#fff", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, cursor: "pointer" },
  btnDanger:    { padding: "9px 14px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13, cursor: "pointer" },
};
