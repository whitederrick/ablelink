"use client";

// app/pilot/docs/page.tsx
// 파일럿 전용 문서 화면 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §9
//
// ★**미리보기 · 다운로드만** 제공한다. 이메일·제출·공단 발송 UI 를 만들지 않는다(§2).
// ★기존 `/worker/docs` 는 수정하지도 차단하지도 않는다. 참여자에게는 이 URL 만 안내한다.
// ★워커 화면이므로 모바일 우선 · 고령 가독성을 지킨다(큰 글자 · 큰 터치 영역).

import { useEffect, useState } from "react";

type Trainee = { id: string; name: string };
type Assignment = {
  id: string; siteId: string; companyName: string; workType: string | null;
  startDate: string; endDate: string | null; trainees: Trainee[];
};

const DOCS = [
  { v: "ATTENDANCE_SHEET", label: "출근부", needsTrainee: false },
  { v: "TRAINING_DAILY_LOG", label: "훈련일지", needsTrainee: true },
  { v: "ADAPTATION_DAILY_LOG", label: "적응지도 일지", needsTrainee: true },
];

function ym(d: Date) { return d.toISOString().slice(0, 10); }

export default function PilotDocsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [isPilot, setIsPilot] = useState(false);
  const [name, setName] = useState("");
  const [asgs, setAsgs] = useState<Assignment[]>([]);

  const [asgId, setAsgId] = useState("");
  const [docType, setDocType] = useState(DOCS[0].v);
  const [traineeId, setTraineeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/pilot/docs/context", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok || !j?.success) throw new Error(j?.message || "불러오지 못했습니다.");
        setIsPilot(!!j.isPilot);
        setName(j.workerName ?? "");
        setAsgs(j.assignments ?? []);
        const first: Assignment | undefined = j.assignments?.[0];
        if (first) {
          setAsgId(first.id);
          setStart(first.startDate);
          setEnd(first.endDate ?? ym(new Date()));
          if (first.trainees[0]) setTraineeId(first.trainees[0].id);
        }
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "불러오지 못했습니다.");
      } finally { setLoading(false); }
    })();
  }, []);

  const asg = asgs.find((a) => a.id === asgId);
  const doc = DOCS.find((d) => d.v === docType)!;
  const ready = !!asgId && !!start && !!end && (!doc.needsTrainee || !!traineeId);

  function url(kind: "preview" | "generate") {
    const p = new URLSearchParams({ docType, periodStart: start, periodEnd: end, assignmentId: asgId });
    if (doc.needsTrainee && traineeId) p.set("traineeId", traineeId);
    return `/api/pilot/docs/${kind}?${p.toString()}`;
  }

  async function open(kind: "preview" | "generate") {
    if (!ready) return;
    setBusy(true);
    try {
      // 오류를 사용자에게 그대로 보여주기 위해 먼저 받아본다(PDF 는 새 탭/저장으로 넘긴다).
      const r = await fetch(url(kind), { cache: "no-store" });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        alert(j?.message || "문서를 만들지 못했습니다.");
        return;
      }
      const blob = await r.blob();
      const href = URL.createObjectURL(blob);
      if (kind === "preview") {
        window.open(href, "_blank", "noopener");
      } else {
        const a = document.createElement("a");
        a.href = href;
        a.download = decodeURIComponent((r.headers.get("Content-Disposition") || "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/)?.[1] || "document.pdf");
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } finally { setBusy(false); }
  }

  if (loading) return <main className="p-6 text-center text-base font-semibold text-slate-500">불러오는 중…</main>;
  if (err) return <main className="p-6 text-center text-base font-semibold text-rose-600">{err}</main>;
  if (!isPilot) return (
    <main className="mx-auto max-w-lg p-6">
      <p className="rounded-2xl border border-slate-200 bg-white p-5 text-base font-semibold leading-relaxed text-slate-600">
        이 화면은 파일럿 참여자 전용입니다.
      </p>
    </main>
  );

  const F = "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-900 outline-none focus:border-sky-500";
  const L = "mb-1.5 block text-sm font-black text-slate-700";

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <header className="pt-2">
        <h1 className="text-xl font-black text-slate-900">문서 만들기</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {name}님 · 미리보기와 다운로드만 제공합니다.
        </p>
      </header>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div>
          <label className={L}>사업체</label>
          <select value={asgId} className={F}
            onChange={(e) => {
              setAsgId(e.target.value);
              const a = asgs.find((x) => x.id === e.target.value);
              setTraineeId(a?.trainees[0]?.id ?? "");
              if (a) { setStart(a.startDate); setEnd(a.endDate ?? ym(new Date())); }
            }}>
            {asgs.map((a) => <option key={a.id} value={a.id}>{a.companyName}</option>)}
          </select>
        </div>

        <div>
          <label className={L}>문서 종류</label>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={F}>
            {DOCS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
          </select>
        </div>

        {doc.needsTrainee && (
          <div>
            <label className={L}>훈련생</label>
            <select value={traineeId} onChange={(e) => setTraineeId(e.target.value)} className={F}>
              <option value="">선택</option>
              {(asg?.trainees ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={L}>시작일</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={F} />
          </div>
          <div>
            <label className={L}>종료일</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={F} />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => void open("preview")} disabled={!ready || busy}
          className="min-h-14 rounded-xl border border-slate-300 bg-white text-base font-black text-slate-700 active:scale-95 disabled:opacity-50">
          미리보기
        </button>
        <button onClick={() => void open("generate")} disabled={!ready || busy}
          className="min-h-14 rounded-xl bg-slate-900 text-base font-black text-white active:scale-95 disabled:opacity-50">
          {busy ? "만드는 중…" : "다운로드"}
        </button>
      </div>

      <p className="px-1 text-sm font-semibold leading-relaxed text-slate-500">
        위탁기관 담당자 이름은 아직 정해지지 않아 <b className="text-slate-700">비워 둔 채</b> 나옵니다.
        인쇄해서 직접 적어 주세요.
      </p>
    </main>
  );
}
