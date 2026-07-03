"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Users, ChevronRight } from "lucide-react";
import { setActiveAssignmentCookie } from "../_lib/activeAssignmentCookie";
import type { ActiveAssignmentItem } from "@/lib/worker/activeAssignments";

const WORKTYPE_LABEL: Record<string, string> = { AM: "오전", PM: "오후", FULL_DAY: "종일", CUSTOM: "맞춤" };
const WORKTYPE_CLS: Record<string, string> = {
  AM: "bg-amber-100 text-amber-700",
  PM: "bg-sky-100 text-sky-700",
  FULL_DAY: "bg-slate-100 text-slate-700",
  CUSTOM: "bg-slate-100 text-slate-700",
};

export default function SelectSiteClient({ items }: { items: ActiveAssignmentItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // 스마트 기본값: 현재 시각(브라우저=KST) 기준 12:30 이전=오전, 이후=오후 추천. 추천 배정을 앞으로 정렬.
  const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
  const recWt = nowMin < 12 * 60 + 30 ? "AM" : "PM";
  const sorted = [...items].sort((a, b) => (a.workType === recWt ? 0 : 1) - (b.workType === recWt ? 0 : 1));

  function pick(id: string) {
    if (busy) return;
    setBusy(id);
    setActiveAssignmentCookie(id);
    router.replace("/worker/home");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <section className="mx-auto max-w-sm">
        <div className="pt-4 pb-6">
          <h1 className="text-2xl font-black tracking-tight text-slate-950">오늘 근무 현장 선택</h1>
          <p className="mt-1.5 text-sm font-semibold text-slate-500">
            오늘 배정된 현황이 여러 곳입니다.
            <br />지금 근무할 현장을 선택하세요.
            <br />(오전, 오후는 상단에서 언제든지 전환할 수 있습니다.)
          </p>
        </div>

        <div className="space-y-3">
          {sorted.map((a) => {
            const isRec = a.workType === recWt;
            return (
            <button
              key={a.assignmentId}
              type="button"
              onClick={() => pick(a.assignmentId)}
              disabled={!!busy}
              className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-4 text-left shadow-sm transition active:scale-[0.98] disabled:opacity-60 ${isRec ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200"} bg-white`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-black ${WORKTYPE_CLS[a.workType] ?? WORKTYPE_CLS.CUSTOM}`}>
                    {WORKTYPE_LABEL[a.workType] ?? a.workType}
                  </span>
                  <span className="truncate text-base font-black text-slate-900">{a.siteName}</span>
                  {isRec && <span className="shrink-0 rounded-full bg-sky-500 px-2 py-0.5 text-[11px] font-black text-white">지금 추천</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-xs font-semibold text-slate-500">
                  {a.agencyName && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      {a.agencyName}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    훈련생 {a.traineeCount}
                  </span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
            </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
