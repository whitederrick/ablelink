"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CircleDollarSign,
  ChevronLeft,
  FileText,
  Home,
  PenLine,
  Trash2,
} from "lucide-react";

const NAV_ITEMS = [
  { icon: Home,             label: "홈",      href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",  href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",    href: "/worker/docs" },
  { icon: CircleDollarSign, label: "히스토리", href: "/worker/history" },
];

export default function SignaturePage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"view" | "draw">("view");
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetch("/api/worker/signature")
      .then(r => r.json())
      .then(d => { if (d.success && d.signatureUrl) setSavedUrl(d.signatureUrl); })
      .finally(() => setLoading(false));
  }, []);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width  = 230;
    canvas.height = 100;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 230, 100);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    if (mode === "draw") setTimeout(initCanvas, 50);
  }, [mode, initCanvas]);

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setIsDrawing(true);
    setIsEmpty(false);
    const pos = getPos(e);
    lastPos.current = pos;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!isDrawing || !lastPos.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  }

  function endDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setIsDrawing(false);
    lastPos.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 230, 100);
    setIsEmpty(true);
  }

  async function handleSave() {
    if (isEmpty) { alert("서명을 먼저 입력해주세요."); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(b => b ? res(b) : rej(new Error("변환 실패")), "image/png", 0.95)
      );
      const formData = new FormData();
      formData.append("signature", blob, "signature.png");
      const res = await fetch("/api/worker/signature", { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success) { alert(data.message || "저장에 실패했습니다."); return; }
      setSavedUrl(data.signatureUrl);
      setMode("view");
      alert("서명이 저장되었습니다.");
    } catch {
      alert("서명 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("저장된 서명을 삭제하시겠습니까?")) return;
    setSaving(true);
    try {
      await fetch("/api/worker/signature", { method: "DELETE" });
      setSavedUrl(null);
      setMode("draw");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-md pb-24">

        {/* 헤더 */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-base font-black text-slate-900">전자서명</h1>
          <div className="w-9" />
        </header>

        <div className="space-y-3 px-4 py-4">

          {/* 안내 */}
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-black text-sky-700">
              <PenLine className="h-4 w-4" aria-hidden="true" />
              전자서명 등록
            </p>
            <p className="text-xs font-semibold leading-relaxed text-slate-600">
              등록된 서명은 출근부, 훈련일지 등 공문서 PDF에 자동으로 합성됩니다.<br />
              실제 서명과 동일하게 작성해주세요.
            </p>
          </div>

          {/* 저장된 서명 보기 */}
          {mode === "view" && savedUrl && (
            <div className="rounded-2xl border border-slate-100 bg-white p-5">
              <p className="mb-3 text-xs font-semibold text-slate-400">현재 등록된 서명</p>
              <div className="flex min-h-36 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4">
                <img src={savedUrl} alt="저장된 서명" className="max-h-44 max-w-full object-contain" />
              </div>
              <div className="mt-4 flex gap-2.5">
                <button
                  onClick={() => { setMode("draw"); setIsEmpty(true); }}
                  className="flex min-h-12 flex-1 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97]"
                >
                  다시 서명하기
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-rose-200 bg-white px-5 text-sm font-black text-rose-600 transition active:scale-[0.97] disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  삭제
                </button>
              </div>
            </div>
          )}

          {/* 서명 없을 때 안내 */}
          {mode === "view" && !savedUrl && (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100">
                <PenLine className="h-8 w-8 text-slate-400" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold text-slate-400">등록된 서명이 없습니다.</p>
              <button
                onClick={() => setMode("draw")}
                className="min-h-12 rounded-2xl bg-slate-950 px-8 text-base font-black text-white transition active:scale-[0.97]"
              >
                서명 등록하기
              </button>
            </div>
          )}

          {/* 서명 입력 캔버스 */}
          {mode === "draw" && (
            <div className="flex flex-col gap-3">
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
                <p className="mb-3 text-xs font-semibold text-slate-400">서명 영역</p>
                <canvas
                  ref={canvasRef}
                  className="block touch-none cursor-crosshair"
                  style={{ width: "100%", height: "100px", border: "2px solid #374151", borderRadius: "8px", backgroundColor: "#fff" }}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={endDraw}
                />
                <p className="mt-2 text-right text-[11px] text-slate-300">이 영역에 서명해주세요</p>
              </div>

              <div className="flex gap-2.5">
                <button
                  onClick={clearCanvas}
                  className="flex min-h-12 flex-1 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-700 transition active:scale-[0.97]"
                >
                  지우기
                </button>
                <button
                  onClick={handleSave}
                  disabled={isEmpty || saving}
                  className="flex min-h-12 flex-[2] items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-60"
                >
                  {saving ? "저장 중..." : "서명 저장"}
                </button>
              </div>

              {savedUrl && (
                <button
                  onClick={() => setMode("view")}
                  className="min-h-12 w-full rounded-2xl border border-slate-200 text-sm font-semibold text-slate-500 transition active:scale-[0.97]"
                >
                  취소
                </button>
              )}
            </div>
          )}

          {/* PREMIUM 안내 */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-xs font-semibold leading-relaxed text-amber-700">
              🔒 전자서명은 PREMIUM 기능입니다.<br />
              에이전시 구독 후 사용할 수 있습니다.
            </p>
          </div>

        </div>
      </div>

      {/* 하단 네비게이션 */}
      <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 border-t border-slate-100 bg-white pb-safe-bottom">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const isActive = typeof window !== "undefined" && window.location.pathname === href;
          return (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="flex flex-1 flex-col items-center justify-center gap-1 py-3"
            >
              <Icon className={`h-5 w-5 ${isActive ? "text-slate-950" : "text-slate-400"}`} aria-hidden="true" />
              <span className={`text-[10px] font-black ${isActive ? "text-slate-950" : "text-slate-400"}`}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
