"use client";

import { useEffect, useRef, useState } from "react";
import { T } from "../_styles";

async function resizeSignature(src: HTMLCanvasElement, w: number, h: number): Promise<Blob> {
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const ctx = off.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 230, 100);
  const pad = 20, scale = Math.min((w - pad * 2) / src.width, (h - pad * 2) / src.height);
  ctx.drawImage(src, (w - src.width * scale) / 2, (h - src.height * scale) / 2, src.width * scale, src.height * scale);
  return new Promise<Blob>((res, rej) => off.toBlob(b => b ? res(b) : rej(new Error("변환 실패")), "image/png", 0.95));
}

export default function AdminSignaturePage() {
  const [savedUrl,    setSavedUrl]    = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [mode,    setMode]    = useState<"view" | "draw">("view");
  const [drawing, setDrawing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos   = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetch("/api/admin/signature").then(r => r.json()).then(d => {
      if (d.success) { setSavedUrl(d.signatureUrl); setDisplayName(d.displayName); }
    });
  }, []);

  useEffect(() => {
    if (mode !== "draw") return;
    const c = canvasRef.current; if (!c) return;
    c.width  = 230;
    c.height = 100;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 230, 100);
    ctx.strokeStyle = "#000000"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
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
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 230, 100);
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
    <div className="space-y-4">
      <div>
        <h1 className={T.pageTitle}>내 서명 관리</h1>
        <p className={T.pageSub}>
          {displayName && `${displayName}님 · `}등록 서명은 문서의 <strong>(위탁기관/공단) 담당자</strong> 서명란에 자동 삽입됩니다.
        </p>
      </div>

      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-900">등록된 서명</p>

        {mode === "view" && (savedUrl ? (
          <>
            <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-5">
              <img src={savedUrl} alt="서명" className="max-h-[100px] max-w-full object-contain" />
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setMode("draw")} className={T.btnPrimary}>다시 등록</button>
              <button onClick={del} className={T.btnDanger}>삭제</button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <p className="mb-1 text-3xl">✍️</p>
            <p className="mb-5 text-sm font-semibold text-slate-400">등록된 서명이 없습니다.</p>
            <button onClick={() => setMode("draw")} className={T.btnPrimary}>서명 등록하기</button>
          </div>
        ))}

        {mode === "draw" && (
          <>
            <div className="relative mb-3 max-w-[230px] overflow-hidden rounded-xl border-2 border-slate-950 bg-slate-50">
              <canvas ref={canvasRef}
                className="block w-full cursor-crosshair"
                style={{ height: "120px", touchAction: "none" }}
                onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
                onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} />
              <p className="pointer-events-none absolute bottom-2 right-2 text-[11px] text-slate-300">✍️ 패드 전체에 꽉 차게 서명해 주세요</p>
            </div>
            <div className="flex gap-2">
              <button onClick={clear} className={T.btnSecondary}>지우기</button>
              <button onClick={save} disabled={saving} className={T.btnPrimary}>
                {saving ? "저장 중..." : "저장"}
              </button>
              <button onClick={() => setMode("view")} className={T.btnSecondary}>취소</button>
            </div>
          </>
        )}
      </div>

      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-900">서명 사용 안내</p>
        <ul className="space-y-1.5 pl-5 text-sm font-semibold text-slate-500" style={{ listStyleType: "disc" }}>
          <li><strong className="text-slate-700">(위탁기관/공단) 담당자</strong> → 현재 로그인한 에이전시 관리자 서명 자동 삽입</li>
          <li className="font-semibold text-rose-500">⚠️ 서명 패드 전체에 꽉 차게 서명하셔야 문서에 적정 크기로 표시됩니다</li>
          <li><strong className="text-slate-700">직무지도원</strong> → 직무지도원이 앱에서 등록한 서명 자동 삽입</li>
          <li><strong className="text-slate-700">사업체 담당자</strong> → 문서 생성 화면에서 QR코드/링크로 현장 즉석 서명</li>
        </ul>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[2000] -translate-x-1/2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
