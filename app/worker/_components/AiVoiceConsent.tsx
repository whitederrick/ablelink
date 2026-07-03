"use client";

// AI 음성 국외이전 동의 — 사용 시점 게이트.
//  · useAiVoiceConsent(): 마운트 시 동의 상태 로드 + ensureConsent()로 녹음 전 동의 보장.
//  · <AiVoiceConsentModal>: 국외이전 상세 고지 + 체크박스 + 동의 기록(POST).
// 음성(원문/AI 모두)이 Groq(미국·STT)·Google Gemini(미국·문장변환)로 전송되므로 최초 1회 별도 동의 필요.

import { useCallback, useEffect, useRef, useState } from "react";
import { Info, Loader2, ShieldCheck } from "lucide-react";
import { LegalDocLink } from "@/components/LegalDocModal";

export function useAiVoiceConsent() {
  const [consented, setConsented] = useState<boolean | null>(null); // null = 로딩 중
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/worker/ai/consent")
      .then((r) => r.json())
      .then((d) => { if (alive) setConsented(!!d?.consented); })
      .catch(() => { if (alive) setConsented(false); });
    return () => { alive = false; };
  }, []);

  // 녹음 등 음성 사용 직전 호출. 이미 동의면 true 즉시, 아니면 모달을 띄우고 결과를 기다림.
  const ensureConsent = useCallback((): Promise<boolean> => {
    if (consented) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpen(true);
    });
  }, [consented]);

  const handleConsented = useCallback(() => {
    setConsented(true);
    setOpen(false);
    resolverRef.current?.(true);
    resolverRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  return {
    consented,
    ensureConsent,
    modalProps: { open, onConsented: handleConsented, onClose: handleClose },
  };
}

export function AiVoiceConsentModal({
  open, onConsented, onClose,
}: { open: boolean; onConsented: () => void; onClose: () => void }) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (open) { setChecked(false); setError(""); } }, [open]);

  if (!open) return null;

  async function agree() {
    if (!checked || saving) return;
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/worker/ai/consent", { method: "POST" });
      const d = await res.json();
      if (!res.ok || !d?.success) { setError(d?.message || "동의 기록에 실패했습니다. 다시 시도해주세요."); setSaving(false); return; }
      onConsented();
    } catch {
      setError("네트워크 오류로 동의 기록에 실패했습니다.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 shrink-0 text-slate-900" />
          <h2 className="text-lg font-black text-slate-900">개인정보 국외 이전 동의</h2>
        </div>

        <p className="mb-3 text-sm font-semibold leading-6 text-slate-600">
          음성 입력 기능을 사용하려면 해당 내용이 아래 해외 사업자로 전송 및 처리되는 것에 동의가 필요합니다.
          음성 내용에는 <strong className="text-slate-900">훈련생 정보</strong>가 포함될 수 있습니다.
        </p>

        <CrossBorderDetail />

        <p className="mb-3 flex items-start gap-1 text-[11px] leading-snug text-slate-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            동의하지 않아도 <strong className="text-slate-500">직접 입력(키보드)</strong>으로 일지를 작성할 수 있습니다.<br />
            자세한 내용은 <LegalDocLink doc="privacy" />의 국외 이전 조항을 확인하세요.
          </span>
        </p>

        <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-slate-200 p-3">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-slate-900" />
          <span className="text-sm font-bold text-slate-800">위 개인정보의 국외 이전에 동의합니다.</span>
        </label>

        {error && <p className="mb-3 text-xs font-bold text-rose-600">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="flex-1 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-500 active:scale-95 disabled:opacity-50">
            취소
          </button>
          <button type="button" onClick={agree} disabled={!checked || saving}
            className="flex-[1.6] rounded-2xl bg-slate-900 py-3 text-sm font-black text-white active:scale-95 disabled:opacity-40">
            {saving ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" />처리 중...</span> : "동의하고 사용"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 국외이전 상세(이전받는 자·목적·보유기간) — 동의 모달에 인라인 요약으로 노출.
function CrossBorderDetail() {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
      <div>
        <p className="font-black text-slate-900">Groq, Inc. <span className="font-semibold text-slate-500">· 미국</span></p>
        <p>음성 녹음 파일을 음성 인식(음성→텍스트)에 이용</p>
      </div>
      <div className="border-t border-slate-200 pt-2">
        <p className="font-black text-slate-900">Google LLC (Gemini) <span className="font-semibold text-slate-500">· 미국</span></p>
        <p>변환된 텍스트·일지 맥락(훈련생 성명·현장 정보 등)을 문장 생성에 이용</p>
      </div>
      <p className="border-t border-slate-200 pt-2 text-slate-500">
        보유기간: 변환 처리 즉시 파기(회사 미보관) · 전송방법: 암호화 통신(HTTPS) 실시간 API
      </p>
    </div>
  );
}
