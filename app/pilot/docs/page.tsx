"use client";

// app/pilot/docs/page.tsx
// 파일럿 전용 문서 화면 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §9
//
// ★**미리보기 · 다운로드 · 사업체 담당자 서명**만 제공한다. 이메일·제출·공단 발송 UI 를 만들지 않는다(§2).
// ★기존 `/worker/docs` 는 수정하지도 차단하지도 않는다. 참여자에게는 이 URL 만 안내한다.
// ★워커 화면이므로 모바일 우선 · 고령 가독성을 지킨다(큰 글자 · 큰 터치 영역).

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Trainee = { id: string; name: string };
type Assignment = {
  id: string; siteId: string; companyName: string; businessContactName: string; workType: string | null;
  serviceStep: string; startDate: string; endDate: string | null; trainees: Trainee[];
};

const DOCS = [
  { v: "ATTENDANCE_SHEET", label: "출근부", needsTrainee: false },
  { v: "TRAINING_DAILY_LOG", label: "훈련일지", needsTrainee: true },
  { v: "ADAPTATION_DAILY_LOG", label: "적응지도 일지", needsTrainee: true },
];

// ★서비스 단계별 문서 세트 — 운영 `/worker/docs` 와 같은 규칙(lib/pilot/docConstants 와 동일).
//  지원고용 배정에서 적응지도 일지를 뽑으면 일지가 한 건도 안 담긴 빈 문서가 나오므로 아예 감춘다.
const STEP_LABEL: Record<string, string> = {
  FIELD_TRAINING: "지원고용 훈련",
  ADAPTATION: "취업 후 적응지도",
};
const DOCS_BY_STEP: Record<string, string[]> = {
  FIELD_TRAINING: ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG"],
  ADAPTATION: ["ATTENDANCE_SHEET", "ADAPTATION_DAILY_LOG"],
};
// ★사업체 담당자 서명 슬롯이 있는 문서 — `lib/pilot/docConstants.PILOT_DOCS_WITH_COMPANY_SIGN` 과 같은 집합.
//  적응지도 일지는 서명 2행(직무지도원·위탁기관 담당자)뿐이라 서명을 받아도 들어갈 자리가 없다.
const DOCS_WITH_COMPANY_SIGN = ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG"];

function ym(d: Date) { return d.toISOString().slice(0, 10); }

function PilotDocsContent() {
  const router = useRouter();
  const params = useSearchParams();

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

  // 사업체 담당자 서명 — 배지는 **서버 판정**을 그대로 쓴다(화면이 기억한 상태가 아니라).
  const [signed, setSigned] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signLoading, setSignLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/pilot/docs/context", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok || !j?.success) throw new Error(j?.message || "불러오지 못했습니다.");
        setIsPilot(!!j.isPilot);
        setName(j.workerName ?? "");
        const list: Assignment[] = j.assignments ?? [];
        setAsgs(list);

        // ★서명 화면에서 돌아왔을 때 **고르던 상태를 복원**한다. URL 이 없으면 첫 배정으로 시작.
        const qAid = params.get("aid");
        const picked = list.find((a) => a.id === qAid) ?? list[0];
        if (picked) {
          setAsgId(picked.id);
          const qDt = params.get("dt");
          const allowedDocs = DOCS_BY_STEP[picked.serviceStep] ?? DOCS_BY_STEP.FIELD_TRAINING;
          if (qDt && allowedDocs.includes(qDt)) setDocType(qDt);
          setStart(params.get("ps") || picked.startDate);
          setEnd(params.get("pe") || picked.endDate || ym(new Date()));
          const qTid = params.get("tid");
          setTraineeId(qTid && picked.trainees.some((t) => t.id === qTid) ? qTid : (picked.trainees[0]?.id ?? ""));
        }
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "불러오지 못했습니다.");
      } finally { setLoading(false); }
    })();
    // 최초 1회만 — 이후 선택 변경은 아래 상태가 관리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const asg = asgs.find((a) => a.id === asgId);
  // ★배정의 서비스 단계에 맞는 문서만 노출. 배정 미선택이면 전부 보여준다(첫 화면 공백 방지).
  const allowed = asg ? (DOCS_BY_STEP[asg.serviceStep] ?? DOCS_BY_STEP.FIELD_TRAINING) : DOCS.map((d) => d.v);
  const visibleDocs = DOCS.filter((d) => allowed.includes(d.v));
  const doc = visibleDocs.find((d) => d.v === docType) ?? visibleDocs[0];
  const ready = !!asgId && !!start && !!end && !!doc && (!doc.needsTrainee || !!traineeId);
  const docValue = doc?.v ?? "";
  const needsCompanySign = DOCS_WITH_COMPANY_SIGN.includes(docValue);

  // 배정을 바꿔 현재 선택 문서가 그 단계에 없으면 첫 문서로 되돌린다(선택이 서버에서 거부되지 않도록).
  useEffect(() => {
    if (visibleDocs.length > 0 && !visibleDocs.some((d) => d.v === docType)) setDocType(visibleDocs[0].v);
  }, [asgId, visibleDocs, docType]);

  // ★★서명 여부는 (배정 + 기간)에 붙는다 — 기간을 바꾸면 방금 받은 서명은 그 문서에 안 들어간다.
  //  화면이 "서명 완료"를 기억하면 그 순간부터 거짓말이 되므로 **선택이 바뀔 때마다 서버에 다시 묻는다.**
  //  판정 함수는 PDF 를 만드는 쪽과 **같은 것**(findPilotCompanySignature)이다.
  const refreshSign = useCallback(async () => {
    if (!asgId || !start || !end || !needsCompanySign) { setSigned(false); setSignerName(""); return; }
    setSignLoading(true);
    try {
      const p = new URLSearchParams({ assignmentId: asgId, periodStart: start, periodEnd: end, docType: docValue });
      const r = await fetch(`/api/pilot/docs/sign-status?${p.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setSigned(false); setSignerName(""); return; }
      setSigned(!!j.signed);
      setSignerName(j.signerName ?? "");
    } catch {
      setSigned(false); setSignerName("");
    } finally { setSignLoading(false); }
  }, [asgId, start, end, needsCompanySign, docValue]);

  useEffect(() => {
    // 날짜 입력은 타이핑 중에도 바뀌므로 잠깐 묶어서 보낸다(마지막 값만 조회).
    const t = setTimeout(() => { void refreshSign(); }, 300);
    return () => clearTimeout(t);
  }, [refreshSign]);

  function goSign() {
    if (!ready || !doc) return;
    const p = new URLSearchParams({ aid: asgId, dt: doc.v, ps: start, pe: end });
    if (doc.needsTrainee && traineeId) p.set("tid", traineeId);
    // 담당자 성함 기본값 — 이미 서명한 이름이 있으면 그것, 없으면 현장에 등록된 사업체 담당자명.
    const cn = signerName || asg?.businessContactName || "";
    if (cn) p.set("cn", cn);
    router.push(`/pilot/docs/sign?${p.toString()}`);
  }

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
            {asgs.map((a) => <option key={a.id} value={a.id}>{a.companyName} · {STEP_LABEL[a.serviceStep] ?? a.serviceStep}</option>)}
          </select>
        </div>

        <div>
          <label className={L}>문서 종류</label>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={F}>
            {visibleDocs.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
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

      {/* 사업체 담당자 서명 — 서명 슬롯이 있는 문서에서만 보여준다 */}
      {needsCompanySign && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-base font-black text-slate-800">사업체 담당자 서명</p>
            {signLoading ? (
              <span className="text-sm font-semibold text-slate-400">확인 중…</span>
            ) : signed ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-black text-emerald-700">
                서명 완료
              </span>
            ) : (
              <span className="text-sm font-semibold text-slate-400">미서명</span>
            )}
          </div>

          {signed ? (
            <>
              <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold leading-relaxed text-emerald-700">
                {signerName ? `${signerName} 님의 서명` : "서명"}이 이 기간 문서에 들어갑니다.
              </p>
              <button onClick={goSign} disabled={!ready}
                className="min-h-14 w-full rounded-xl border border-slate-300 bg-white text-base font-black text-slate-700 active:scale-95 disabled:opacity-50">
                다시 서명 받기
              </button>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm font-semibold leading-relaxed text-slate-500">
                담당자에게 휴대폰을 건네 직접 서명을 받습니다. 한 번 받으면 같은 기간의 출근부·훈련일지에 함께 들어갑니다.
              </p>
              <button onClick={goSign} disabled={!ready}
                className="min-h-14 w-full rounded-xl bg-sky-600 text-base font-black text-white active:scale-95 disabled:opacity-50">
                담당자에게 폰 건네기 (직접 서명)
              </button>
            </>
          )}
        </section>
      )}

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

export default function PilotDocsPage() {
  return (
    <Suspense fallback={<main className="p-6 text-center text-base font-semibold text-slate-500">불러오는 중…</main>}>
      <PilotDocsContent />
    </Suspense>
  );
}
