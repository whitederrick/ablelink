"use client";

import { useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { SignaturePad, type SignaturePadHandle } from "../../../_components/SignaturePad";

// ─── 실제 서명 UI ───────────────────────────────────────────
function ManagerSignContent() {
  const router = useRouter();
  const params = useSearchParams();
  const docType     = params.get("dt") ?? "";
  const periodStart = params.get("ps") ?? "";
  const periodEnd   = params.get("pe") ?? "";
  const contactName = params.get("cn") ?? "";

  const padRef = useRef<SignaturePadHandle>(null);
  const [empty,  setEmpty]  = useState(true);
  const [saving, setSaving] = useState(false);
  // 현장에 등록된 사업체 담당자명으로 자동 채움(수정 가능)
  const [signerName, setSignerName] = useState(contactName);

  async function handleSave() {
    const blob = await padRef.current?.getBlob();
    if (!blob) { alert("서명을 먼저 입력해주세요."); return; }
    setSaving(true);
    try {
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

      {/* 서명 패드 (공용 — 고해상도·스무딩·trim) */}
      <div className="mx-5 max-w-[460px] overflow-hidden rounded-2xl border-2 border-slate-950 bg-white">
        <SignaturePad ref={padRef} onChange={setEmpty} />
      </div>
      <p className="mb-2 mt-1 text-center text-xs text-slate-300">↑ 이 영역에 꽉 차게 서명해주세요</p>

      {/* 버튼 */}
      <div className="flex-shrink-0 flex gap-3 px-5 pb-8 pt-3">
        <button
          onClick={() => padRef.current?.clear()}
          className="flex-1 rounded-2xl border border-slate-200 bg-white py-4 text-sm font-black text-slate-600 active:scale-[0.98]"
        >
          지우기
        </button>
        <button
          onClick={handleSave}
          disabled={empty || saving}
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
