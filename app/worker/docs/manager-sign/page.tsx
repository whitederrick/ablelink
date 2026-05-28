"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Suspense } from "react";

// ─── 실제 서명 UI ───────────────────────────────────────────
function ManagerSignContent() {
  const router = useRouter();
  const params = useSearchParams();
  const docType     = params.get("dt") ?? "";
  const periodStart = params.get("ps") ?? "";
  const periodEnd   = params.get("pe") ?? "";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos   = useRef<{ x: number; y: number } | null>(null);
  const [drawing, setDrawing]   = useState(false);
  const [isEmpty,  setIsEmpty]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [signerName, setSignerName] = useState("");

  const initCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width  = rect.width  * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    setTimeout(initCanvas, 50);
    window.addEventListener("resize", initCanvas);
    return () => window.removeEventListener("resize", initCanvas);
  }, [initCanvas]);

  function getXY(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function onStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setDrawing(true);
    setIsEmpty(false);
    lastPos.current = getXY(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = getXY(e);
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
  }
  function onMove(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing || !lastPos.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = getXY(e);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    lastPos.current = p;
  }
  function onEnd(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setDrawing(false);
    lastPos.current = null;
  }
  function clearCanvas() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setIsEmpty(true);
  }

  async function handleSave() {
    if (isEmpty) { alert("서명을 먼저 입력해주세요."); return; }
    setSaving(true);
    try {
      const c = canvasRef.current!;
      const blob = await new Promise<Blob>((res, rej) =>
        c.toBlob(b => b ? res(b) : rej(new Error("변환 실패")), "image/png", 0.95)
      );
      const fd = new FormData();
      fd.append("signature", blob, "manager-sign.png");
      fd.append("docType", docType);
      fd.append("periodStart", periodStart);
      fd.append("periodEnd", periodEnd);
      fd.append("signerName", signerName || "사업체 담당자");

      const res = await fetch("/api/worker/docs/inperson-sign", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success) { alert(data.message || "저장 실패"); return; }

      // 문서 페이지로 토큰 전달
      router.replace(`/worker/docs?signToken=${data.token}&signDone=1`);
    } catch {
      alert("서버 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const DOC_LABELS: Record<string, string> = {
    ATTENDANCE_SHEET:      "직무지도원 출근부",
    TRAINING_DAILY_LOG:    "지원고용 훈련일지",
    TRAINEE_FINAL_EVAL:    "훈련생 종합평가",
    ADAPTATION_DAILY_LOG:  "적응지도 일지",
    ADAPTATION_FINAL_EVAL: "적응지도 종합평가",
  };

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      {/* 헤더 — 네비게이션 없음 */}
      <div className="flex-shrink-0 border-b border-slate-100 px-5 py-4 text-center">
        <p className="text-xs font-semibold text-slate-400 mb-0.5">사업체 담당자 서명</p>
        <p className="text-base font-black text-slate-900">{DOC_LABELS[docType] ?? "문서"}</p>
        {periodStart && periodEnd && (
          <p className="text-xs text-slate-400 mt-0.5">{periodStart} ~ {periodEnd}</p>
        )}
      </div>

      {/* 안내 */}
      <div className="flex-shrink-0 bg-amber-50 px-5 py-3 text-center border-b border-amber-100">
        <p className="text-sm font-semibold text-amber-700">
          담당자님, 아래 서명란에 직접 서명해주세요.
        </p>
      </div>

      {/* 담당자 이름 입력 */}
      <div className="flex-shrink-0 px-5 py-3">
        <input
          type="text"
          value={signerName}
          onChange={e => setSignerName(e.target.value)}
          placeholder="담당자 성함 (선택)"
          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-950"
        />
      </div>

      {/* 서명 캔버스 */}
      <div className="mx-5 overflow-hidden rounded-2xl border-2 border-slate-950 bg-white" style={{ height: "160px" }}>
        <canvas
          ref={canvasRef}
          className="block h-full w-full cursor-crosshair touch-none"
          onMouseDown={onStart}
          onMouseMove={onMove}
          onMouseUp={onEnd}
          onMouseLeave={onEnd}
          onTouchStart={onStart}
          onTouchMove={onMove}
          onTouchEnd={onEnd}
        />
      </div>
      <p className="mb-2 mt-1 text-center text-xs text-slate-300">↑ 이 영역에 서명해주세요</p>

      {/* 버튼 */}
      <div className="flex-shrink-0 flex gap-3 px-5 pb-8 pt-3">
        <button
          onClick={clearCanvas}
          className="flex-1 rounded-2xl border border-slate-200 bg-white py-4 text-sm font-black text-slate-600 active:scale-[0.98]"
        >
          지우기
        </button>
        <button
          onClick={handleSave}
          disabled={isEmpty || saving}
          className="flex-[2] rounded-2xl bg-slate-950 py-4 text-sm font-black text-white active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> 저장 중...
            </span>
          ) : "서명 완료"}
        </button>
      </div>
    </div>
  );
}

export default function ManagerSignPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    }>
      <ManagerSignContent />
    </Suspense>
  );
}
