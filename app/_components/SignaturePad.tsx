"use client";

// 공용 서명 패드 — 고해상도 저장 + 부드러운 선(스무딩) + 큰 영역 + 투명 배경.
// 워커/매니저 웹/모바일 서명 페이지에서 공통 사용.
// - 내부 버퍼를 CSS 크기 × EXPORT_SCALE 로 잡아 마우스/터치 모두 좌표가 정확하고 저장 PNG가 선명.
// - clearRect만 사용(흰색 채우지 않음) → 문서 위 "(서명 또는 인)"을 가리지 않음.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  getBlob: () => Promise<Blob | null>;
  clear: () => void;
  isEmpty: () => boolean;
}

const EXPORT_SCALE = 3; // 저장 해상도 배율 (CSS px × 3 → 고해상도)

type Pt = { x: number; y: number };
function mid(a: Pt, b: Pt): Pt { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

export const SignaturePad = forwardRef<SignaturePadHandle, {
  height?: number;
  className?: string;
  onChange?: (empty: boolean) => void;
}>(function SignaturePad({ height = 200, className, onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<Pt | null>(null);
  const lastMid = useRef<Pt | null>(null);
  const emptyRef = useRef(true);
  const [, force] = useState(0);

  const setup = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    if (!rect.width) return;
    c.width = Math.round(rect.width * EXPORT_SCALE);
    c.height = Math.round(rect.height * EXPORT_SCALE);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, 0, 0); // CSS좌표로 그리되 버퍼는 고해상도
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    ctx.fillStyle = "#0f172a";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  // 마운트 시 1회 셋업 (리사이즈로 지워지지 않게 의도적으로 1회만)
  useEffect(() => {
    const t = setTimeout(setup, 30);
    return () => clearTimeout(t);
  }, [setup]);

  function pos(e: React.MouseEvent | React.TouchEvent): Pt {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const src = "touches" in e ? (e.touches[0] ?? e.changedTouches[0]) : (e as React.MouseEvent);
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  function markDrawn() {
    if (emptyRef.current) {
      emptyRef.current = false;
      onChange?.(false);
      force(n => n + 1);
    }
  }

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    drawing.current = true;
    const p = pos(e);
    last.current = p;
    lastMid.current = p;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2); ctx.fill(); }
    markDrawn();
  }

  function move(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing.current || !last.current || !lastMid.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    const m = mid(last.current, p);
    // 이전 중간점 → 현재 점(제어점) → 새 중간점 으로 2차 베지어 → 부드러운 곡선
    ctx.beginPath();
    ctx.moveTo(lastMid.current.x, lastMid.current.y);
    ctx.quadraticCurveTo(last.current.x, last.current.y, m.x, m.y);
    ctx.stroke();
    last.current = p;
    lastMid.current = m;
  }

  function end(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    drawing.current = false;
    last.current = null;
    lastMid.current = null;
  }

  useImperativeHandle(ref, () => ({
    getBlob: () =>
      new Promise<Blob | null>(resolve => {
        const c = canvasRef.current;
        if (!c || emptyRef.current) { resolve(null); return; }
        c.toBlob(b => resolve(b), "image/png");
      }),
    clear: () => {
      setup();
      emptyRef.current = true;
      onChange?.(true);
      force(n => n + 1);
    },
    isEmpty: () => emptyRef.current,
  }));

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block", width: "100%", height: `${height}px`, touchAction: "none", cursor: "crosshair", background: "#fff" }}
      onMouseDown={start}
      onMouseMove={move}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
    />
  );
});
