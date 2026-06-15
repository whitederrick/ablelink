"use client";

import { useEffect, useRef, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import { SignaturePad, type SignaturePadHandle } from "../../_components/SignaturePad";

export default function ManagerSignaturePage() {
  const [savedUrl,    setSavedUrl]    = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [mode,    setMode]    = useState<"view" | "draw">("view");
  const [empty,   setEmpty]   = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState("");
  const padRef = useRef<SignaturePadHandle>(null);

  // 스마트폰 서명
  const [phone, setPhone] = useState<{ url: string; qr: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/admin/signature").then(r => r.json()).then(d => {
      if (d.success) { setSavedUrl(d.signatureUrl); setDisplayName(d.displayName); }
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  async function save() {
    const blob = await padRef.current?.getBlob();
    if (!blob) { flash("서명을 입력해주세요."); return; }
    setSaving(true);
    try {
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

  // 스마트폰으로 서명 — 토큰 발급 + QR 표시 + 완료 폴링
  async function startPhoneSign() {
    try {
      const d = await fetch("/api/admin/signature/phone-token", { method: "POST" }).then(r => r.json());
      if (!d.success) { flash(d.message || "발급 실패"); return; }
      const QRCode = (await import("qrcode")).default;
      const qr = await QRCode.toDataURL(d.url, { width: 260, margin: 1 });
      const baseline = savedUrl;
      setPhone({ url: d.url, qr });

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const r = await fetch("/api/admin/signature").then(x => x.json()).catch(() => null);
        if (r?.success && r.signatureUrl && r.signatureUrl !== baseline) {
          if (pollRef.current) clearInterval(pollRef.current);
          setSavedUrl(r.signatureUrl);
          setPhone(null);
          setMode("view");
          flash("스마트폰 서명이 저장되었습니다.");
        }
      }, 3000);
    } catch { flash("오류가 발생했습니다."); }
  }

  function cancelPhoneSign() {
    if (pollRef.current) clearInterval(pollRef.current);
    setPhone(null);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="관리자 서명 관리"
        sub={<>{displayName && `${displayName}님 · `}등록 서명은 문서의 <strong>(위탁기관/공단) 담당자</strong> 서명란에 자동 삽입됩니다.</>}
      />

      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-900">등록된 서명</p>

        {mode === "view" && (savedUrl ? (
          <>
            <div className="flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-5">
              <img src={savedUrl} alt="서명" className="max-h-[100px] max-w-full object-contain" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => { setMode("draw"); setEmpty(true); }} className={T.btnPrimary}>다시 등록</button>
              <button onClick={startPhoneSign} className={T.btnSecondary}>📱 스마트폰으로 서명</button>
              <button onClick={del} className={T.btnDanger}>삭제</button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <p className="mb-1 text-3xl">✍️</p>
            <p className="mb-5 text-sm font-semibold text-slate-400">등록된 서명이 없습니다.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={() => { setMode("draw"); setEmpty(true); }} className={T.btnPrimary}>서명 등록하기</button>
              <button onClick={startPhoneSign} className={T.btnSecondary}>📱 스마트폰으로 서명</button>
            </div>
          </div>
        ))}

        {mode === "draw" && (
          <>
            <div className="relative mb-3 max-w-[460px] overflow-hidden rounded-xl border-2 border-slate-950 bg-white">
              <SignaturePad ref={padRef} onChange={setEmpty} />
              <p className="pointer-events-none absolute bottom-2 right-2 text-[11px] text-slate-300">✍️ 패드 전체에 꽉 차게 서명해 주세요</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => padRef.current?.clear()} className={T.btnSecondary}>지우기</button>
              <button onClick={save} disabled={saving || empty} className={T.btnPrimary}>
                {saving ? "저장 중..." : "저장"}
              </button>
              <button onClick={startPhoneSign} className={T.btnSecondary}>📱 스마트폰으로 서명</button>
              <button onClick={() => setMode("view")} className={T.btnSecondary}>취소</button>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-400">마우스로 그리기 어려우면 "스마트폰으로 서명"을 눌러 QR로 폰에서 입력하세요.</p>
          </>
        )}
      </div>

      <div className={T.card}>
        <p className="mb-3 text-sm font-black text-slate-900">서명 사용 안내</p>
        <ul className="space-y-1.5 pl-5 text-sm font-semibold text-slate-500" style={{ listStyleType: "disc" }}>
          <li><strong className="text-slate-700">(위탁기관/공단) 담당자</strong> → 현재 로그인한 위탁기관 관리자 서명 자동 삽입</li>
          <li className="font-semibold text-rose-500">⚠️ 서명 패드 전체에 꽉 차게 서명하셔야 문서에 적정 크기로 표시됩니다</li>
          <li><strong className="text-slate-700">직무지도원</strong> → 직무지도원이 앱에서 등록한 서명 자동 삽입</li>
          <li><strong className="text-slate-700">사업체 담당자</strong> → 문서 생성 화면에서 QR코드/링크로 현장 즉석 서명</li>
        </ul>
      </div>

      {/* 스마트폰 서명 QR 모달 */}
      {phone && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/50 px-5" onClick={e => { if (e.target === e.currentTarget) cancelPhoneSign(); }}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <p className="text-base font-black text-slate-900">스마트폰으로 서명</p>
            <p className="mt-1 text-sm font-semibold text-slate-400">휴대폰 카메라로 QR을 스캔한 뒤 폰 화면에서 서명하세요.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={phone.qr} alt="서명 QR" className="mx-auto my-5 h-60 w-60 rounded-xl border border-slate-100" />
            <div className="flex items-center justify-center gap-2 text-sm font-bold text-slate-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              서명을 기다리는 중...
            </div>
            <p className="mt-3 break-all rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-400">{phone.url}</p>
            <button onClick={cancelPhoneSign} className="mt-4 w-full rounded-2xl border border-slate-200 py-3 text-sm font-black text-slate-500">
              닫기
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[2000] -translate-x-1/2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
