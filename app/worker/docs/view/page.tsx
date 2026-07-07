"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getActiveAssignmentCookie, setActiveAssignmentCookie } from "@/app/worker/_lib/activeAssignmentCookie";
import {
  BarChart2,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ClipboardList,
  Download,
  FileText,
  Home,
  PenLine,
  TrendingUp,
  User,
  Search,
} from "lucide-react";

type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

// 출퇴근 그룹 (공통)
const GROUP_ATTENDANCE = { group: "출퇴근", docs: [
  { id: "attendance-sheet" as DocType, label: "출근부", Icon: ClipboardList, desc: "날짜별 출퇴근 기록", needsTrainee: false },
]};

// 지원고용 훈련 세트
const DOC_GROUPS_TRAINING = [
  GROUP_ATTENDANCE,
  { group: "지원고용 훈련 세트", docs: [
    { id: "training-daily-log"  as DocType, label: "지원고용 훈련일지",        Icon: BookOpen,  desc: "일별 작성",            needsTrainee: true },
    { id: "trainee-final-eval"  as DocType, label: "지원고용 훈련생 종합평가", Icon: BarChart2, desc: "훈련 종료 시 작성", needsTrainee: true },
  ]},
];

// 취업후 적응지도 세트
const DOC_GROUPS_ADAPTATION = [
  GROUP_ATTENDANCE,
  { group: "취업 후 적응지도 세트", docs: [
    { id: "adaptation-daily-log"  as DocType, label: "취업 후 적응지도 일지",    Icon: FileText,   desc: "일별 작성",              needsTrainee: true },
    { id: "adaptation-final-eval" as DocType, label: "취업 후 적응지도 종합평가",Icon: TrendingUp, desc: "적응지도 종료 시 작성", needsTrainee: true },
  ]},
];

// pdf.js 뷰어는 무겁고 클라이언트 전용 → 문서 조회 시점에만 lazy 로드
const PdfViewer = dynamic(() => import("../../_components/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-200 text-sm font-bold text-slate-500">
      문서를 불러오는 중...
    </div>
  ),
});

const DOC_LABELS: Record<DocType, string> = {
  "attendance-sheet":      "출근부",
  "training-daily-log":    "지원고용 훈련일지",
  "trainee-final-eval":    "지원고용 훈련생 종합평가",
  "adaptation-daily-log":  "취업 후 적응지도 일지",
  "adaptation-final-eval": "취업 후 적응지도 종합평가",
};

const NAV_ITEMS = [
  { icon: Home,             label: "홈",      href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",  href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",    href: "/worker/docs/view" },
  { icon: Search,           label: "매칭",    href: "/recruit" },
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
  const [trainingType,    setTrainingType]    = useState<"PRE"|"FIELD"|"ADAPTATION">("FIELD");
  const [loaded,          setLoaded]          = useState(false); // 서비스 단계 로드 완료(전엔 기본값 노출 방지)
  const [mode,            setMode]            = useState<"select" | "view">("select");
  const [iframeKey,       setIframeKey]       = useState(0);
  // 활성 배정이 2개+인데 유효 선택이 없을 때(모호) — 서버가 현장 목록을 주면 선택 유도.
  const [siteChoices,     setSiteChoices]     = useState<{ assignmentId: string; siteName: string }[] | null>(null);

  // 서비스 단계에 맞는 DOC_GROUPS
  const isAdaptation = trainingType === "ADAPTATION";
  const DOC_GROUPS = isAdaptation ? DOC_GROUPS_ADAPTATION : DOC_GROUPS_TRAINING;
  const serviceLabel = isAdaptation ? "취업 후 적응지도" : "지원고용 훈련";

  const needsTrainee = DOC_GROUPS.flatMap(g => g.docs).find(d => d.id === docType)?.needsTrainee ?? false;

  // 멀티현장 선택 배정(스위처 쿠키) — 컨텍스트·미리보기를 이 현장 기준으로.
  const activeAssignmentId = typeof window !== "undefined" ? getActiveAssignmentCookie() : null;

  useEffect(() => {
    const ctxQ = activeAssignmentId ? `?assignmentId=${encodeURIComponent(activeAssignmentId)}` : "";
    fetch(`/api/worker/docs/context${ctxQ}`, { cache: "no-store" })
      .then(async r => { try { return await r.json(); } catch { return null; } })
      .then(d => {
        if (d?.needsSiteSelection && Array.isArray(d.sites)) {
          setSiteChoices(d.sites);  // 여러 현장 → 아래 선택 UI 노출
        } else if (d?.success && d.data) {
          setTrainingType(d.data.trainingType || "FIELD");
          if (d.data.trainees)
            setTrainees(d.data.trainees.map((t: any) => ({ id: String(t.id), name: t.name, gender: t.gender || "M" })));
        }
      }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  function selectDoc(id: DocType) {
    setDocType(id); setSelectedTrainee("");
  }

  function previewUrl() {
    const p = new URLSearchParams({
      docType, periodStart, periodEnd,
      ...(selectedTrainee ? { traineeId: selectedTrainee } : {}),
      ...(activeAssignmentId ? { assignmentId: activeAssignmentId } : {}),
    });
    return `/api/worker/docs/preview?${p.toString()}`;
  }

  function handleView() {
    if (needsTrainee && !selectedTrainee) { alert("훈련생을 선택해주세요."); return; }
    setIframeKey(k => k + 1);
    setMode("view");
  }

  const [downloading, setDownloading] = useState(false);
  // 서버가 내려준 구분된 한글 파일명으로 실제 저장 (window.open은 모바일에서 새탭/다운로드로 빠짐)
  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(previewUrl(), { cache: "no-store" });
      if (!res.ok) { alert("문서를 불러올 수 없습니다."); return; }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      let fname = `${DOC_LABELS[docType].replace(/ /g, "")}_${periodStart}_${periodEnd}.pdf`;
      const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (m) { try { fname = decodeURIComponent(m[1]); } catch { /* keep fallback */ } }
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = fname; a.click();
      URL.revokeObjectURL(u);
    } catch {
      alert("다운로드 중 오류가 발생했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  // ── 현장 선택 화면(활성 배정 2개+ · 유효 선택 없음) ─────────
  if (siteChoices) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-6">
        <FileText className="h-10 w-10 text-slate-400" aria-hidden="true" />
        <p className="text-center text-base font-black text-slate-900">문서를 조회할 현장을 선택해주세요</p>
        <p className="-mt-2 text-center text-sm font-semibold text-slate-400">여러 현장에 배정되어 있어 현장을 먼저 선택해야 합니다.</p>
        <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
          {siteChoices.map(s => (
            <button
              key={s.assignmentId}
              onClick={() => { setActiveAssignmentCookie(s.assignmentId); window.location.reload(); }}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left transition active:scale-[0.98]"
            >
              <span className="text-sm font-black text-slate-900">{s.siteName}</span>
              <ChevronLeft className="h-4 w-4 rotate-180 text-slate-400" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    );
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
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-black text-white transition active:scale-95 disabled:opacity-60"
          >
            {downloading ? "저장 중..." : "저장"}
          </button>
        </header>

        <div className="flex-1 overflow-hidden">
          <PdfViewer key={iframeKey} url={previewUrl()} />
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
            onClick={handleDownload}
            disabled={downloading}
            className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-slate-950 py-3 text-sm font-black text-white transition active:scale-95 disabled:opacity-60"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {downloading ? "저장 중..." : "PDF 저장"}
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

          {!loaded ? (
            <div className="space-y-3">
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : (
          <>
          {/* 서비스 세트 안내 */}
          <div className={`rounded-xl border px-4 py-3 ${isAdaptation ? "border-amber-200 bg-amber-50" : "border-sky-100 bg-sky-50"}`}>
            <p className={`text-xs font-black ${isAdaptation ? "text-amber-700" : "text-sky-700"}`}>
              현재 서비스: {serviceLabel}
            </p>
            <p className={`mt-0.5 text-[11px] font-semibold ${isAdaptation ? "text-amber-600" : "text-sky-500"}`}>
              {isAdaptation
                ? "출근부 / 취업 후 적응지도 일지 / 취업 후 적응지도 종합평가"
                : "출근부 / 지원고용 훈련일지 / 지원고용 훈련생 종합평가"}
            </p>
          </div>

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
          </>
          )}

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
