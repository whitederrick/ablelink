"use client";

// 워커앱 PDF 화면 뷰어 — pdf.js로 페이지를 canvas에 렌더(모바일/iOS에서도 인라인 표시).
// iframe/object는 iOS Safari에서 빈 화면이거나 다운로드로 빠지므로 직접 렌더한다.
// 확대(+/−)는 핀치줌(래스터→흐려짐)과 달리 벡터에서 매번 다시 그려 선명하게 유지한다.
// pdfjs는 클라이언트 전용(canvas/DOMMatrix 필요)이라 동적 import.

import { useCallback, useEffect, useRef, useState } from "react";
import { FileWarning, Loader2, Minus, Plus } from "lucide-react";

let workerConfigured = false;

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

export default function PdfViewer({ url }: { url: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<any>(null);
  const renderTokenRef = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("문서를 불러올 수 없습니다.");
  const [zoom, setZoom] = useState(1);

  // 로드된 문서를 현재 zoom으로 전 페이지 렌더(벡터 → 선명)
  const renderAll = useCallback(async (zoomLevel: number) => {
    const pdf = pdfRef.current;
    const wrap = pagesRef.current;
    const scroll = scrollRef.current;
    if (!pdf || !wrap || !scroll) return;
    const token = ++renderTokenRef.current;

    const baseWidth = Math.max(240, (scroll.clientWidth || 360) - 24); // 좌우 여백
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = baseWidth * zoomLevel;

    wrap.innerHTML = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      if (token !== renderTokenRef.current) return; // 더 최신 렌더가 시작됨 → 중단
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = cssWidth / vp1.width;
      const viewport = page.getViewport({ scale: scale * dpr });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(cssWidth)}px`;
      canvas.style.height = "auto";
      canvas.style.display = "block";
      canvas.style.margin = "0 auto 12px";
      canvas.style.borderRadius = "8px";
      canvas.style.boxShadow = "0 1px 4px rgba(15,23,42,0.12)";
      canvas.style.background = "#fff";

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (token !== renderTokenRef.current) return;
      wrap.appendChild(canvas);
    }
  }, []);

  // 문서 로드(1회) — 인증 쿠키 포함해 직접 받아 arrayBuffer로 전달
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      setZoom(1);
      if (pagesRef.current) pagesRef.current.innerHTML = "";
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          let msg = "문서를 불러올 수 없습니다.";
          try { const j = await res.json(); if (j?.message) msg = j.message; } catch { /* PDF가 아닐 때만 */ }
          if (!cancelled) { setErrorMsg(msg); setStatus("error"); }
          return;
        }
        const data = await res.arrayBuffer();
        if (cancelled) return;

        const pdfjsLib: any = await import("pdfjs-dist");
        if (!workerConfigured) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).toString();
          workerConfigured = true;
        }

        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        await renderAll(1);
        if (!cancelled) setStatus("ready");
      } catch (e) {
        console.error("[PdfViewer]", e);
        if (!cancelled) { setErrorMsg("문서를 표시할 수 없습니다. 아래 저장 버튼을 이용해주세요."); setStatus("error"); }
      }
    }
    load();
    return () => { cancelled = true; renderTokenRef.current++; pdfRef.current = null; };
  }, [url, renderAll]);

  // zoom 변경 시 재렌더(벡터에서 선명하게)
  useEffect(() => {
    if (status === "ready") renderAll(zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  function changeZoom(delta: number) {
    setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) / ZOOM_STEP) * ZOOM_STEP)));
  }

  return (
    <div className="relative h-full w-full">
      <div ref={scrollRef} className="h-full w-full overflow-auto bg-slate-200 px-3 py-3">
        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-200">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            <p className="text-sm font-bold text-slate-500">문서를 불러오는 중...</p>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-200 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
              <FileWarning className="h-7 w-7 text-amber-500" />
            </div>
            <p className="text-sm font-bold text-slate-600">{errorMsg}</p>
          </div>
        )}
        <div ref={pagesRef} className="mx-auto" />
      </div>

      {/* 확대/축소 — 벡터에서 다시 그려 선명 */}
      {status === "ready" && (
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 rounded-full bg-slate-950/90 px-1.5 py-1 shadow-lg backdrop-blur">
          <button
            onClick={() => changeZoom(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition active:scale-90 disabled:opacity-40"
            aria-label="축소"
          >
            <Minus className="h-5 w-5" />
          </button>
          <span className="min-w-[3rem] text-center text-xs font-black tabular-nums text-white">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => changeZoom(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition active:scale-90 disabled:opacity-40"
            aria-label="확대"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
