"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart2,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Home,
  PenLine,
  Send,
  TrendingUp,
  User,
  X,
} from "lucide-react";

type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

const DOC_GROUPS = [
  { group: "출퇴근", docs: [
    { id: "attendance-sheet"      as DocType, label: "출근부",          Icon: ClipboardList, desc: "날짜별 출퇴근 기록",          needsTrainee: false },
  ]},
  { group: "훈련", docs: [
    { id: "training-daily-log"    as DocType, label: "훈련일지",         Icon: BookOpen,      desc: "일자별 지원고용 훈련 기록",    needsTrainee: true  },
    { id: "trainee-final-eval"    as DocType, label: "훈련생 종합평가",  Icon: BarChart2,     desc: "훈련생별 수행 종합 집계",      needsTrainee: true  },
  ]},
  { group: "적응지도", docs: [
    { id: "adaptation-daily-log"  as DocType, label: "적응지도 일지",    Icon: FileText,      desc: "일자별 취업 후 적응지도 기록", needsTrainee: true  },
    { id: "adaptation-final-eval" as DocType, label: "적응지도 종합평가",Icon: TrendingUp,    desc: "훈련생별 적응지도 종합 집계",  needsTrainee: true  },
  ]},
];

const DOC_LABELS: Record<DocType, string> = {
  "attendance-sheet":      "출근부",
  "training-daily-log":    "훈련일지",
  "trainee-final-eval":    "훈련생 종합평가",
  "adaptation-daily-log":  "적응지도 일지",
  "adaptation-final-eval": "적응지도 종합평가",
};

const NAV_ITEMS = [
  { icon: Home,             label: "홈",      href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",  href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",    href: "/worker/docs" },
  { icon: CircleDollarSign, label: "히스토리", href: "/worker/history" },
];

function defaultPeriod() {
  const n = new Date(), y = n.getFullYear(), m = String(n.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, n.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

function DocsViewInner() {
  const router = useRouter();
  const def = defaultPeriod();
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const [docType,         setDocType]         = useState<DocType>("attendance-sheet");
  const [periodStart,     setPeriodStart]     = useState(def.start);
  const [periodEnd,       setPeriodEnd]       = useState(def.end);
  const [selectedTrainee, setSelectedTrainee] = useState("");
  const [trainees,        setTrainees]        = useState<{id: string; name: string; gender: string}[]>([]);
  const [mode,            setMode]            = useState<"select" | "view">("select");
  const [iframeKey,       setIframeKey]       = useState(0);
  const [copied,          setCopied]          = useState(false);

  const [signToken,      setSignToken]      = useState("");
  const [signUrl,        setSignUrl]        = useState("");
  const [signStatus,     setSignStatus]     = useState<"none" | "pending" | "done">("none");
  const [signImageUrl,   setSignImageUrl]   = useState("");
  const [signRequesting, setSignRequesting] = useState(false);

  const needsTrainee = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.needsTrainee ?? false;

  useEffect(() => {
    fetch("/api/worker/site/current").then(r => r.json()).then(d => {
      if (d.success && d.data?.trainees)
        setTrainees(d.data.trainees.map((t: any) => ({ id: String(t.id), name: t.name, gender: t.gender || "M" })));
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function resetSign() {
    if (pollRef.current) clearInterval(pollRef.current);
    setSignToken(""); setSignUrl(""); setSignStatus("none"); setSignImageUrl("");
  }

  function selectDoc(id: DocType) {
    setDocType(id); setSelectedTrainee(""); resetSign();
  }

  function previewUrl() {
    const p = new URLSearchParams({
      docType, periodStart, periodEnd,
      ...(selectedTrainee ? { traineeId: selectedTrainee } : {}),
      ...(signToken       ? { signToken }                  : {}),
    });
    return `/api/worker/docs/preview?${p.toString()}`;
  }

  async function requestCompanySign() {
    setSignRequesting(true);
    try {
      const res = await fetch("/api/worker/docs/sign-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, periodStart, periodEnd, signRole: "company_manager", signerName: "사업체 담당자" }),
      });
      const d = await res.json();
      if (!d.success) { alert(d.message || "링크 생성 실패"); return; }
      setSignToken(d.token); setSignUrl(d.signUrl); setSignStatus("pending");
      try { await navigator.clipboard.writeText(d.signUrl); } catch {}
      pollRef.current = setInterval(async () => {
        const pd = await fetch(`/api/worker/docs/sign-token?token=${d.token}`).then(r => r.json());
        if (pd.signed && pd.signatureUrl) {
          clearInterval(pollRef.current!);
          setSignStatus("done"); setSignImageUrl(pd.signatureUrl);
        }
      }, 10000);
    } finally { setSignRequesting(false); }
  }

  async function copySignUrl() {
    try { await navigator.clipboard.writeText(signUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  function handleView() {
    if (needsTrainee && !selectedTrainee) { alert("훈련생을 선택해주세요."); return; }
    setIframeKey(k => k + 1);
    setMode("view");
  }

  // ── 뷰어 화면 ───────────────────────────────────────────
  if (mode === "view") {
    return (
      <div className="flex h-dvh flex-col bg-slate-50">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <button
            onClick={() => setMode("select")}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-black text-slate-900">{DOC_LABELS[docType]}</span>
            <span className="text-xs font-semibold text-slate-400">{periodStart} ~ {periodEnd}</span>
          </div>
          <button
            onClick={() => window.open(previewUrl(), "_blank")}
            className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-black text-white transition active:scale-95"
          >
            PDF
          </button>
        </header>

        <div className="flex-1 overflow-hidden bg-slate-200">
          <iframe key={iframeKey} src={previewUrl()} className="h-full w-full border-none" title="문서 미리보기" />
        </div>

        <div className="flex flex-shrink-0 gap-2 border-t border-slate-100 bg-white p-3">
          <button
            onClick={() => setMode("select")}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-3 text-sm font-black text-slate-700 transition active:scale-95"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            문서 선택
          </button>
          <button
            onClick={() => window.open(previewUrl(), "_blank")}
            className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-slate-950 py-3 text-sm font-black text-white transition active:scale-95"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            PDF 다운로드
          </button>
        </div>
      </div>
    );
  }

  // ── 문서 선택 화면 ──────────────────────────────────────
  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-md pb-24">

        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-base font-black text-slate-900">문서 조회</h1>
          <button
            onClick={() => router.push("/worker/docs")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition active:scale-95"
          >
            발송
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">

          {/* 문서 종류 */}
          {DOC_GROUPS.map(({ group, docs }) => (
            <div key={group}>
              <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">{group}</p>
              <div className="flex flex-col gap-2">
                {docs.map(({ id, label, Icon, desc }) => {
                  const isActive = docType === id;
                  return (
                    <button
                      key={id}
                      onClick={() => selectDoc(id)}
                      className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition active:scale-[0.98] ${
                        isActive ? "border-slate-950 bg-slate-950" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${isActive ? "bg-white/15" : "bg-slate-100"}`}>
                        <Icon className={`h-4.5 w-4.5 h-5 w-5 ${isActive ? "text-white" : "text-slate-500"}`} aria-hidden="true" />
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-black leading-none ${isActive ? "text-white" : "text-slate-900"}`}>{label}</p>
                        <p className={`mt-1 text-xs font-semibold ${isActive ? "text-white/60" : "text-slate-400"}`}>{desc}</p>
                      </div>
                      {isActive && <Check className="h-4 w-4 flex-shrink-0 text-white" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* 훈련생 선택 */}
          {needsTrainee && (
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <p className="mb-3 text-sm font-black text-slate-700">훈련생 선택</p>
              {trainees.length === 0 ? (
                <p className="text-sm font-semibold text-slate-400">담당 훈련생이 없습니다.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {trainees.map(t => {
                    const isActive = selectedTrainee === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTrainee(t.id)}
                        className={`flex items-center gap-3 rounded-xl border p-3 transition active:scale-[0.98] ${
                          isActive ? "border-slate-950 bg-slate-950" : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${isActive ? "bg-white/15" : "bg-slate-100"}`}>
                          <User className={`h-4 w-4 ${isActive ? "text-white" : "text-slate-500"}`} aria-hidden="true" />
                        </div>
                        <span className={`flex-1 text-left text-sm font-black ${isActive ? "text-white" : "text-slate-900"}`}>{t.name}</span>
                        {isActive && <Check className="h-4 w-4 flex-shrink-0 text-white" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 기간 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-3 text-sm font-black text-slate-700">조회 기간</p>
            <div className="flex items-center gap-2">
              <input
                type="date" value={periodStart}
                onChange={e => { setPeriodStart(e.target.value); resetSign(); }}
                className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
              />
              <span className="text-sm font-semibold text-slate-400">~</span>
              <input
                type="date" value={periodEnd}
                onChange={e => { setPeriodEnd(e.target.value); resetSign(); }}
                className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {/* 사업체담당자 서명 요청 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-black text-slate-700">사업체담당자 서명</p>
              {signStatus === "done" && (
                <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-black text-emerald-600">
                  <Check className="h-3 w-3" aria-hidden="true" /> 서명완료
                </span>
              )}
            </div>

            {signStatus === "none" && (
              <button
                onClick={requestCompanySign}
                disabled={signRequesting}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-60"
              >
                {signRequesting ? (
                  <><Clock className="h-4 w-4 animate-spin" aria-hidden="true" /> 링크 생성 중...</>
                ) : (
                  <><Send className="h-4 w-4" aria-hidden="true" /> 서명 요청 링크 생성</>
                )}
              </button>
            )}

            {signStatus === "pending" && signUrl && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-black text-slate-700">아래 링크를 사업체 담당자에게 전달하세요</p>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="break-all text-xs font-semibold text-slate-600">{signUrl}</p>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={copySignUrl}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-xs font-black text-slate-700 transition active:scale-95">
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />{copied ? "복사됨!" : "복사"}
                  </button>
                  <button onClick={() => window.open(signUrl, "_blank")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-xs font-black text-slate-700 transition active:scale-95">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />새 탭
                  </button>
                  <button onClick={resetSign}
                    className="flex items-center justify-center rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-500 transition active:scale-95">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" /> 서명 완료 자동 감지 중...
                </p>
              </div>
            )}

            {signStatus === "done" && signImageUrl && (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <img src={signImageUrl} alt="서명" className="h-9 object-contain" />
                <span className="text-xs font-black text-emerald-700">서명이 문서에 포함됩니다.</span>
              </div>
            )}

            <p className="mt-3 text-xs font-semibold leading-relaxed text-slate-400">
              서명 없이 조회하면 "(서명 또는 인)" 표시로 출력됩니다.
            </p>
          </div>

          {/* 조회 버튼 */}
          <button
            onClick={handleView}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97]"
          >
            <FileText className="h-5 w-5" aria-hidden="true" />
            {DOC_LABELS[docType]} 조회
          </button>
        </div>
      </div>

      {/* 하단 네비게이션 */}
      <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 border-t border-slate-100 bg-white pb-safe-bottom">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const isActive = typeof window !== "undefined" && window.location.pathname === href;
          return (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="flex flex-1 flex-col items-center justify-center gap-1 py-3"
            >
              <Icon className={`h-5 w-5 ${isActive ? "text-slate-950" : "text-slate-400"}`} aria-hidden="true" />
              <span className={`text-[10px] font-black ${isActive ? "text-slate-950" : "text-slate-400"}`}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default function DocsViewPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm font-semibold text-slate-400">
        로딩 중...
      </div>
    }>
      <DocsViewInner />
    </Suspense>
  );
}
