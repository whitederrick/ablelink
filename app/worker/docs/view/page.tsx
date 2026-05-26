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
  ExternalLink,
  FileText,
  Home,
  PenLine,
  TrendingUp,
  User,
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
  const [docType,         setDocType]         = useState<DocType>("attendance-sheet");
  const [periodStart,     setPeriodStart]     = useState(def.start);
  const [periodEnd,       setPeriodEnd]       = useState(def.end);
  const [selectedTrainee, setSelectedTrainee] = useState("");
  const [trainees,        setTrainees]        = useState<{id: string; name: string; gender: string}[]>([]);
  const [mode,            setMode]            = useState<"select" | "view">("select");
  const [iframeKey,       setIframeKey]       = useState(0);

  const needsTrainee = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.needsTrainee ?? false;

  useEffect(() => {
    fetch("/api/worker/site/current").then(r => r.json()).then(d => {
      if (d.success && d.data?.trainees)
        setTrainees(d.data.trainees.map((t: any) => ({ id: String(t.id), name: t.name, gender: t.gender || "M" })));
    });
  }, []);

  function selectDoc(id: DocType) {
    setDocType(id); setSelectedTrainee("");
  }

  function previewUrl() {
    const p = new URLSearchParams({
      docType, periodStart, periodEnd,
      ...(selectedTrainee ? { traineeId: selectedTrainee } : {}),
    });
    return `/api/worker/docs/preview?${p.toString()}`;
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
                onChange={e => setPeriodStart(e.target.value)}
                className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
              />
              <span className="text-sm font-semibold text-slate-400">~</span>
              <input
                type="date" value={periodEnd}
                onChange={e => setPeriodEnd(e.target.value)}
                className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
              />
            </div>
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
