"use client";

// app/pilot/docs/sign/page.tsx
// 파일럿 — 사업체 담당자 대면 서명(직무지도원이 폰을 건넨다).
//
// ★★업로드는 운영 `POST /api/worker/docs/inperson-sign` 을 **그대로 재사용**한다.
//  파일럿 때문에 운영 코드를 고치지 않는다는 원칙(feedback_pilot_no_touch_production)에 따라
//  새 업로드 라우트를 만들지 않았다. 그 라우트는 워커 세션 + 본인 배정만 받으므로
//  파일럿 워커(전용 계정·전용 배정)가 그대로 통과한다.
//   · 플랜 게이트 `SITE_MANAGER_SIGN` = STANDARD 기능 · 파일럿 워커 planType=STANDARD → 통과
//   · Storage 경로 `inperson/{assignmentId}/…` → 초기화(5단계) prefix 나열이 이미 회수한다
//   · `SiteSignToken` 은 배정 Cascade 로 함께 지워진다
//
// ★운영 `/worker/docs/manager-sign` 을 재사용하지 않은 이유는 **딱 하나** — 그 화면이 저장 후
//  `/worker/docs` 로 되돌아간다. 파일럿 참여자를 운영 문서 화면(제출·발송이 있는 곳)으로 보낼 수 없고,
//  그 화면에 복귀 경로 파라미터를 넣는 것은 운영 코드 수정이다.
//
// ★워커 화면이므로 모바일 우선 · 고령 가독성(큰 글자 · 큰 터치 영역)을 지킨다.

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignaturePad, type SignaturePadHandle } from "@/app/_components/SignaturePad";

const DOC_LABELS: Record<string, string> = {
  ATTENDANCE_SHEET: "직무지도원 출근부",
  TRAINING_DAILY_LOG: "지원고용 훈련일지",
};

function PilotSignContent() {
  const router = useRouter();
  const params = useSearchParams();
  const docType = params.get("dt") ?? "";
  const start = params.get("ps") ?? "";
  const end = params.get("pe") ?? "";
  const aid = params.get("aid") ?? "";
  const tid = params.get("tid") ?? "";
  const contactName = params.get("cn") ?? "";

  const padRef = useRef<SignaturePadHandle>(null);
  const [empty, setEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  // 현장에 등록된 사업체 담당자명으로 자동 채움(수정 가능) — 운영 서명 화면과 같은 규칙.
  const [signerName, setSignerName] = useState(contactName);

  // 서명을 마치거나 취소하면 **고르던 상태 그대로** 문서 화면으로 돌아간다.
  function backUrl(signed: boolean) {
    const p = new URLSearchParams({ aid, dt: docType, ps: start, pe: end });
    if (tid) p.set("tid", tid);
    if (signed) p.set("signed", "1");
    return `/pilot/docs?${p.toString()}`;
  }

  async function handleSave() {
    const blob = await padRef.current?.getBlob();
    if (!blob) { alert("서명을 먼저 입력해 주세요."); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("signature", blob, "manager-sign.png");
      fd.append("docType", docType);
      fd.append("periodStart", start);
      fd.append("periodEnd", end);
      fd.append("signerName", signerName || contactName || "사업체 담당자");
      // ★배정을 반드시 넘긴다 — 서명이 이 현장·이 배정에 귀속돼야 문서가 그것을 찾는다.
      if (aid) fd.append("assignmentId", aid);

      const res = await fetch("/api/worker/docs/inperson-sign", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) { alert(data?.message || "서명을 저장하지 못했습니다."); return; }
      router.replace(backUrl(true));
    } catch {
      alert("서버 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <div className="flex-shrink-0 border-b border-slate-100 px-5 py-4 text-center">
        <p className="mb-0.5 text-sm font-semibold text-slate-400">사업체 담당자 서명</p>
        <p className="text-lg font-black text-slate-900">{DOC_LABELS[docType] ?? "문서"}</p>
        {start && end && <p className="mt-0.5 text-sm text-slate-400">{start} ~ {end}</p>}
      </div>

      <div className="flex-shrink-0 border-b border-amber-100 bg-amber-50 px-5 py-3 text-center">
        <p className="text-base font-bold text-amber-700">담당자님, 아래 칸에 직접 서명해 주세요.</p>
      </div>

      <div className="flex-shrink-0 px-5 py-3">
        <label className="mb-1.5 block text-sm font-black text-slate-700">담당자 성함</label>
        <input
          type="text"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="담당자 성함"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-semibold text-slate-900 outline-none focus:border-sky-500"
        />
      </div>

      {/* 서명 패드 — 운영과 같은 공용 컴포넌트(고해상도·스무딩·trim) */}
      <div className="mx-5 max-w-[460px] overflow-hidden rounded-2xl border-2 border-slate-900 bg-white">
        <SignaturePad ref={padRef} onChange={setEmpty} />
      </div>
      <p className="mb-2 mt-1 text-center text-sm text-slate-400">↑ 이 영역에 꽉 차게 서명해 주세요</p>

      <div className="flex flex-shrink-0 gap-3 px-5 pb-8 pt-3">
        <button
          onClick={() => padRef.current?.clear()}
          className="min-h-14 flex-1 rounded-2xl border border-slate-300 bg-white text-base font-black text-slate-600 active:scale-95"
        >
          지우기
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={empty || saving}
          className="min-h-14 flex-[2] rounded-2xl bg-slate-900 text-base font-black text-white active:scale-95 disabled:opacity-50"
        >
          {saving ? "저장 중…" : "서명 완료"}
        </button>
      </div>

      <button
        onClick={() => router.replace(backUrl(false))}
        className="pb-8 text-center text-sm font-semibold text-slate-400 underline"
      >
        서명하지 않고 돌아가기
      </button>
    </div>
  );
}

export default function PilotSignPage() {
  return (
    <Suspense fallback={<main className="p-6 text-center text-base font-semibold text-slate-500">불러오는 중…</main>}>
      <PilotSignContent />
    </Suspense>
  );
}
