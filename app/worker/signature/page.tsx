"use client";
// app/worker/signature/page.tsx
// 전자서명 등록 페이지 — 캔버스 터치/마우스 드로잉

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

  // 기존 서명 조회
  useEffect(() => {
    fetch("/api/worker/signature")
      .then(r => r.json())
      .then(d => {
        if (d.success && d.signatureUrl) setSavedUrl(d.signatureUrl);
      })
      .finally(() => setLoading(false));
  }, []);

  // 캔버스 초기화
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 해상도 선명하게 (devicePixelRatio 적용)
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    if (mode === "draw") {
      setTimeout(initCanvas, 50); // DOM 렌더 후 초기화
    }
  }, [mode, initCanvas]);

  // 좌표 추출 (터치/마우스 공통)
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

  // 지우기
  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setIsEmpty(true);
  }

  // 저장
  async function handleSave() {
    if (isEmpty) { alert("서명을 먼저 입력해주세요."); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSaving(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("변환 실패")), "image/png", 0.95);
      });

      const formData = new FormData();
      formData.append("signature", blob, "signature.png");

      const res = await fetch("/api/worker/signature", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.message || "저장에 실패했습니다.");
        return;
      }

      setSavedUrl(data.signatureUrl);
      setMode("view");
      alert("서명이 저장되었습니다.");
    } catch {
      alert("서명 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // 삭제
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
      <div style={s.center}>
        <div style={s.spinner} />
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* 헤더 */}
        <div style={s.header}>
          <button onClick={() => router.back()} style={s.backBtn}>←</button>
          <h1 style={s.title}>전자서명</h1>
          <div style={{ width: 36 }} />
        </div>

        {/* 안내 */}
        <div style={s.infoBox}>
          <p style={s.infoTitle}>✍️ 전자서명 등록</p>
          <p style={s.infoDesc}>
            등록된 서명은 출근부, 훈련일지 등 공문서 PDF에 자동으로 합성됩니다.<br />
            실제 서명과 동일하게 작성해주세요.
          </p>
        </div>

        {/* 저장된 서명 보기 */}
        {mode === "view" && savedUrl && (
          <div style={s.savedBox}>
            <p style={s.savedLabel}>현재 등록된 서명</p>
            <div style={s.signaturePreview}>
              <img
                src={savedUrl}
                alt="저장된 서명"
                style={s.signatureImg}
              />
            </div>
            <div style={s.savedBtns}>
              <button
                style={s.reDrawBtn}
                onClick={() => { setMode("draw"); setIsEmpty(true); }}
              >
                다시 서명하기
              </button>
              <button
                style={s.deleteBtn}
                onClick={handleDelete}
                disabled={saving}
              >
                삭제
              </button>
            </div>
          </div>
        )}

        {/* 서명 없을 때 안내 */}
        {mode === "view" && !savedUrl && (
          <div style={s.emptyBox}>
            <p style={s.emptyIcon}>✍️</p>
            <p style={s.emptyText}>등록된 서명이 없습니다.</p>
            <button style={s.startBtn} onClick={() => setMode("draw")}>
              서명 등록하기
            </button>
          </div>
        )}

        {/* 서명 입력 캔버스 */}
        {mode === "draw" && (
          <div style={s.drawSection}>
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
              <p style={s.canvasHint}>이 영역에 서명해주세요</p>
            </div>

            <div style={s.drawBtns}>
              <button style={s.clearBtn} onClick={clearCanvas}>
                지우기
              </button>
              <button
                style={{ ...s.saveBtn, opacity: isEmpty || saving ? 0.6 : 1 }}
                onClick={handleSave}
                disabled={isEmpty || saving}
              >
                {saving ? "저장 중..." : "서명 저장"}
              </button>
            </div>

            {savedUrl && (
              <button style={s.cancelBtn} onClick={() => setMode("view")}>
                취소
              </button>
            )}
          </div>
        )}

        {/* PREMIUM 안내 */}
        <div style={s.premiumNote}>
          <p style={s.premiumText}>
            🔒 전자서명은 PREMIUM 기능입니다.<br />
            에이전시 구독 후 사용할 수 있습니다.
          </p>
        </div>

      </div>

      {/* 하단 네비게이션 */}
      <nav style={s.bottomNav}>
        <button style={s.navItem} onClick={() => router.push("/worker/home")}>
          <span style={s.navIcon}>🏠</span>
          <span style={s.navLabel}>홈</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/calendar")}>
          <span style={s.navIcon}>📅</span>
          <span style={s.navLabel}>캘린더</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/signature")}>
          <span style={{ ...s.navIcon, color: "#2563eb" }}>✍️</span>
          <span style={{ ...s.navLabel, color: "#2563eb" }}>전자서명</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/docs")}>
          <span style={s.navIcon}>📄</span>
          <span style={s.navLabel}>문서</span>
        </button>
      </nav>
    </div>
  );
}

// ─── 스타일 ─────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f8f9ff" },
  container: { maxWidth: 480, margin: "0 auto", padding: "0 0 90px" },
  center: { minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" },
  spinner: { width: 36, height: 36, border: "3px solid #e5e7eb", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", backgroundColor: "#fff", borderBottom: "1px solid #eee", position: "sticky", top: 0, zIndex: 10 },
  backBtn: { background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#333", width: 36 },
  title: { fontSize: 18, fontWeight: 700, color: "#333", margin: 0 },

  infoBox: { backgroundColor: "#f0f2ff", margin: "16px 16px 0", padding: "14px 16px", borderRadius: 12, border: "1px solid #c7ceff" },
  infoTitle: { fontSize: 15, fontWeight: 700, color: "#2563eb", margin: "0 0 6px" },
  infoDesc: { fontSize: 13, color: "#555", margin: 0, lineHeight: 1.6 },

  // 저장된 서명
  savedBox: { margin: "16px 16px 0", backgroundColor: "#fff", borderRadius: 16, padding: "20px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)" },
  savedLabel: { fontSize: 14, fontWeight: 600, color: "#555", margin: "0 0 12px" },
  signaturePreview: { backgroundColor: "#f8f9ff", borderRadius: 12, padding: 16, border: "2px dashed #c7ceff", minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center" },
  signatureImg: { maxWidth: "100%", maxHeight: 160, objectFit: "contain" },
  savedBtns: { display: "flex", gap: 10, marginTop: 16 },
  reDrawBtn: { flex: 1, padding: "12px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  deleteBtn: { padding: "12px 20px", backgroundColor: "#fff", color: "#e53935", border: "1.5px solid #e53935", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" },

  // 서명 없을 때
  emptyBox: { margin: "40px 16px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  emptyIcon: { fontSize: 48, margin: 0 },
  emptyText: { fontSize: 16, color: "#888", margin: 0 },
  startBtn: { padding: "14px 32px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer" },

  // 캔버스
  drawSection: { margin: "16px 16px 0", display: "flex", flexDirection: "column", gap: 12 },
  canvasWrap: { position: "relative", backgroundColor: "#fff", borderRadius: 16, border: "2px solid #e5e7eb", overflow: "hidden" },
  canvas: { display: "block", width: "100%", height: "200px", touchAction: "none", cursor: "crosshair" },
  canvasHint: { position: "absolute", bottom: 8, right: 12, fontSize: 11, color: "#ccc", margin: 0, pointerEvents: "none" },
  drawBtns: { display: "flex", gap: 10 },
  clearBtn: { flex: 1, padding: "13px", backgroundColor: "#f0f0f0", color: "#555", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer" },
  saveBtn: { flex: 2, padding: "13px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  cancelBtn: { width: "100%", padding: "12px", backgroundColor: "transparent", color: "#888", border: "1.5px solid #eee", borderRadius: 10, fontSize: 14, cursor: "pointer" },

  // PREMIUM 안내
  premiumNote: { margin: "20px 16px 0", padding: "12px 16px", backgroundColor: "#fff8e1", borderRadius: 12, border: "1px solid #ffe082" },
  premiumText: { fontSize: 13, color: "#795548", margin: 0, lineHeight: 1.6, textAlign: "center" },

  // 하단 네비게이션
  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, backgroundColor: "#fff", borderTop: "1px solid #eee", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" },
  navItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "10px 0", border: "none", backgroundColor: "transparent", cursor: "pointer" },
  navIcon: { fontSize: 22 },
  navLabel: { fontSize: 11, color: "#888", fontWeight: 500 },
};
