"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  BarChart2,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Download,
  FileText,
  Home,
  Mail,
  MapPin,
  PenLine,
  Send,
  Smartphone,
  TrendingUp,
  User,
} from "lucide-react";

interface SiteInfo {
  companyName: string;
  managerEmail: string;
  managerName: string;
  workerName: string;
  trainees: { id: string; name: string; gender: string }[];
  trainingType: "PRE" | "FIELD" | "ADAPTATION";
}

// 전체 문서 목록 (상태 초기화용)
const ALL_DOC_TYPES = [
  { id: "ATTENDANCE_SHEET",      label: "출근부",          Icon: ClipboardList, desc: "월별 출퇴근 기록",                       needsTrainee: false },
  { id: "TRAINING_DAILY_LOG",    label: "훈련일지",         Icon: BookOpen,      desc: "지원고용 훈련일지 (일별 작성)",           needsTrainee: true  },
  { id: "TRAINEE_FINAL_EVAL",    label: "훈련생 종합평가",  Icon: BarChart2,     desc: "지원고용 훈련생 종합 평가기록부 (종료 시)", needsTrainee: true  },
  { id: "ADAPTATION_DAILY_LOG",  label: "적응지도 일지",    Icon: FileText,      desc: "취업 후 적응지도 일지 (일별 작성)",       needsTrainee: true  },
  { id: "ADAPTATION_FINAL_EVAL", label: "적응지도 종합평가",Icon: TrendingUp,    desc: "취업 후 적응지도 종합 평가기록부 (종료 시)", needsTrainee: true  },
];

// 서비스 단계별 문서 세트
const TRAINING_DOC_IDS   = ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG",   "TRAINEE_FINAL_EVAL"];
const ADAPTATION_DOC_IDS = ["ATTENDANCE_SHEET", "ADAPTATION_DAILY_LOG", "ADAPTATION_FINAL_EVAL"];

const NAV_ITEMS = [
  { icon: Home,             label: "홈",      href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",  href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",    href: "/worker/docs" },
  { icon: CircleDollarSign, label: "히스토리", href: "/worker/history" },
];

const NEEDS_MANAGER_SIGN = new Set(["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG"]);

type DocState = {
  checked: boolean;
  traineeId: string;
  loading: boolean;
  result: { success: boolean; msg: string; pdfBase64?: string; fileName?: string } | null;
};

function DocsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [signToken, setSignToken] = useState<string | null>(null);
  const [signStatus, setSignStatus] = useState<"none" | "done">("none");
  const [bulkLoading, setBulkLoading] = useState(false);

  const [docStates, setDocStates] = useState<Record<string, DocState>>(
    () => Object.fromEntries(ALL_DOC_TYPES.map(d => [d.id, { checked: false, traineeId: "", loading: false, result: null }]))
  );

  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const last = new Date(y, now.getMonth() + 1, 0).getDate();
    setPeriodStart(`${y}-${m}-01`);
    setPeriodEnd(`${y}-${m}-${String(last).padStart(2, "0")}`);

    const tok = searchParams.get("signToken");
    const done = searchParams.get("signDone");
    if (tok && done === "1") {
      setSignToken(tok);
      setSignStatus("done");
    }
  }, []);

  useEffect(() => {
    fetch("/api/worker/site/current").then(r => r.json()).then(d => {
      if (d.success && d.data) {
        setSiteInfo({
          companyName:  d.data.companyName,
          managerEmail: d.data.managerEmail || "",
          managerName:  d.data.managerName  || "담당자",
          workerName:    d.data.workerName    || "",
          trainees: (d.data.trainees || []).map((t: any) => ({
            id: String(t.id), name: t.name, gender: t.gender,
          })),
          trainingType: d.data.trainingType || "FIELD",
        });
      }
    });
  }, []);

  function toggleDoc(id: string) {
    setDocStates(prev => ({
      ...prev,
      [id]: { ...prev[id], checked: !prev[id].checked, result: null },
    }));
  }

  function setTrainee(docId: string, traineeId: string) {
    setDocStates(prev => ({
      ...prev,
      [docId]: { ...prev[docId], traineeId },
    }));
  }

  // 현재 서비스 단계에 맞는 문서 세트
  const isAdaptation = siteInfo?.trainingType === "ADAPTATION";
  const activeDocIds = isAdaptation ? ADAPTATION_DOC_IDS : TRAINING_DOC_IDS;
  const DOC_TYPES = ALL_DOC_TYPES.filter(d => activeDocIds.includes(d.id));
  const serviceLabel = isAdaptation ? "취업 후 적응지도" : "지원고용 훈련";

  function openInPersonSign() {
    const firstSignDoc = DOC_TYPES.find(d => NEEDS_MANAGER_SIGN.has(d.id) && docStates[d.id].checked);
    const docType = firstSignDoc?.id || "ATTENDANCE_SHEET";
    router.push(`/worker/docs/manager-sign?dt=${docType}&ps=${periodStart}&pe=${periodEnd}`);
  }

  async function sendDoc(docId: string): Promise<void> {
    const docInfo = ALL_DOC_TYPES.find(d => d.id === docId)!;
    const state = docStates[docId];
    if (docInfo.needsTrainee && !state.traineeId) {
      alert(`${docInfo.label}: 훈련생을 선택해주세요.`);
      return;
    }

    setDocStates(prev => ({ ...prev, [docId]: { ...prev[docId], loading: true, result: null } }));
    try {
      const res = await fetch("/api/worker/docs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: docId,
          periodStart,
          periodEnd,
          traineeId: state.traineeId || undefined,
          companyManagerSignToken: signToken || undefined,
          sendEmail: !!siteInfo?.managerEmail,
          toEmail: siteInfo?.managerEmail || undefined,
        }),
      });
      const data = await res.json();
      setDocStates(prev => ({
        ...prev,
        [docId]: {
          ...prev[docId],
          loading: false,
          result: data.success
            ? { success: true, msg: data.message, pdfBase64: data.pdfBase64, fileName: data.fileName }
            : { success: false, msg: data.message || "오류가 발생했습니다." },
        },
      }));
    } catch {
      setDocStates(prev => ({
        ...prev,
        [docId]: { ...prev[docId], loading: false, result: { success: false, msg: "서버와 연결할 수 없습니다." } },
      }));
    }
  }

  async function handleBulkSend() {
    const checkedDocs = ALL_DOC_TYPES.filter(d => activeDocIds.includes(d.id) && docStates[d.id].checked);
    if (checkedDocs.length === 0) { alert("발송할 문서를 선택해주세요."); return; }
    for (const doc of checkedDocs) {
      if (doc.needsTrainee && !docStates[doc.id].traineeId) {
        alert(`${doc.label}: 훈련생을 선택해주세요.`);
        return;
      }
    }
    setBulkLoading(true);
    for (const doc of checkedDocs) {
      await sendDoc(doc.id);
    }
    setBulkLoading(false);
  }

  function handleDownload(docId: string) {
    const r = docStates[docId].result;
    if (!r?.pdfBase64 || !r?.fileName) return;
    const blob = new Blob([Uint8Array.from(atob(r.pdfBase64), c => c.charCodeAt(0))], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = r.fileName; a.click();
    URL.revokeObjectURL(url);
  }

  const checkedCount = DOC_TYPES.filter(d => docStates[d.id].checked).length;
  const needsManagerSignChecked = DOC_TYPES.some(d => NEEDS_MANAGER_SIGN.has(d.id) && docStates[d.id].checked);
  const singleDoc = checkedCount === 1 ? ALL_DOC_TYPES.find(d => docStates[d.id].checked) : null;
  const mainBtnLabel = singleDoc
    ? `${singleDoc.label} 발송`
    : `선택 문서 일괄 발송 (${checkedCount}개)`;

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-md pb-24">

        {/* 헤더 */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-base font-black text-slate-900">문서 발송</h1>
          <button
            onClick={() => router.push("/worker/docs/view")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition active:scale-95"
          >
            조회
          </button>
        </header>

        {/* 현장 + 수신자 */}
        {siteInfo && (
          <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4">
            <div className="flex items-center justify-between py-1">
              <span className="flex-shrink-0 text-xs font-semibold text-slate-400">현장</span>
              <span className="flex items-center gap-1 text-right text-sm font-semibold text-slate-800">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
                {siteInfo.companyName}
              </span>
            </div>
            <div className="my-2 h-px bg-slate-50" />
            <div className="flex items-center justify-between py-1">
              <span className="flex-shrink-0 text-xs font-semibold text-slate-400">수신자</span>
              <span className="flex items-center gap-1 text-right text-sm font-semibold text-slate-800">
                <Mail className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
                {siteInfo.managerName} ({siteInfo.managerEmail || "이메일 미등록"})
              </span>
            </div>
          </div>
        )}

        {/* 기간 설정 */}
        <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">기간 설정</p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
            />
            <span className="text-sm font-semibold text-slate-400">~</span>
            <input
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
            />
          </div>
        </div>

        {/* 사업체담당자 서명 (출근부·훈련일지 선택 시 표시) */}
        {needsManagerSignChecked && (
          <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-black text-slate-700">사업체담당자 서명</p>
              {signStatus === "done" ? (
                <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-black text-emerald-600">
                  <Check className="h-3 w-3" aria-hidden="true" /> 서명 완료
                </span>
              ) : (
                <span className="text-xs font-semibold text-slate-400">출근부·훈련일지 적용</span>
              )}
            </div>
            {signStatus === "none" ? (
              <button
                onClick={openInPersonSign}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97]"
              >
                <Smartphone className="h-4 w-4" aria-hidden="true" />
                담당자에게 폰 건네기 (직접 서명)
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs font-black text-emerald-700">서명이 문서에 포함됩니다.</span>
                </div>
                <button
                  onClick={() => { setSignToken(null); setSignStatus("none"); }}
                  className="w-full text-xs font-semibold text-slate-400 underline"
                >
                  다시 서명 받기
                </button>
              </div>
            )}
            <p className="mt-3 text-xs font-semibold leading-relaxed text-slate-400">
              서명 없이 발송하면 서명란이 빈칸으로 출력됩니다.
            </p>
          </div>
        )}

        {/* 서비스 세트 안내 */}
        {siteInfo && (
          <div className={`mx-4 mt-3 rounded-xl border px-4 py-3 ${isAdaptation ? "border-violet-100 bg-violet-50" : "border-sky-100 bg-sky-50"}`}>
            <p className={`text-xs font-black ${isAdaptation ? "text-violet-700" : "text-sky-700"}`}>
              현재 서비스: <span className="font-black">{serviceLabel}</span>
            </p>
            <p className={`mt-0.5 text-[11px] font-semibold ${isAdaptation ? "text-violet-500" : "text-sky-500"}`}>
              {isAdaptation
                ? "출근부 · 적응지도 일지 (일별) · 적응지도 종합평가 (종료 시) 3종"
                : "출근부 · 훈련일지 (일별) · 훈련생 종합평가 (훈련 종료 시) 3종"}
            </p>
          </div>
        )}

        {/* 문서 선택 (체크박스 방식) */}
        <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-black text-slate-700">문서 선택</p>
            <span className="text-xs font-semibold text-slate-400">
              {checkedCount > 0 ? `${checkedCount}개 선택됨` : "발송할 문서를 선택하세요"}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {DOC_TYPES.map(({ id, label, Icon, desc, needsTrainee }) => {
              const state = docStates[id];
              const isChecked = state.checked;
              return (
                <div key={id} className={`overflow-hidden rounded-xl border transition ${isChecked ? "border-slate-300" : "border-slate-200"}`}>
                  {/* 문서 헤더 */}
                  <button
                    onClick={() => toggleDoc(id)}
                    className={`flex w-full items-center gap-3 p-3.5 text-left transition active:scale-[0.98] ${isChecked ? "bg-slate-950" : "bg-slate-50 hover:bg-slate-100"}`}
                  >
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${isChecked ? "bg-white/15" : "bg-white"}`}>
                      <Icon className={`h-5 w-5 ${isChecked ? "text-white" : "text-slate-500"}`} aria-hidden="true" />
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-black leading-none ${isChecked ? "text-white" : "text-slate-900"}`}>{label}</p>
                      <p className={`mt-1 text-xs font-semibold ${isChecked ? "text-white/60" : "text-slate-400"}`}>{desc}</p>
                    </div>
                    <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition ${isChecked ? "border-white bg-white" : "border-slate-300"}`}>
                      {isChecked && <Check className="h-3 w-3 text-slate-950" aria-hidden="true" />}
                    </div>
                  </button>

                  {/* 체크 시 세부 설정 영역 */}
                  {isChecked && (
                    <div className="bg-white px-3.5 pb-3.5 pt-3">
                      {/* 훈련생 선택 */}
                      {needsTrainee && (
                        <div className="mb-3">
                          <p className="mb-2 text-xs font-black text-slate-600">
                            훈련생 선택 <span className="font-semibold text-rose-500">*필수</span>
                          </p>
                          {siteInfo?.trainees && siteInfo.trainees.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {siteInfo.trainees.map(t => (
                                <button
                                  key={t.id}
                                  onClick={() => setTrainee(id, state.traineeId === t.id ? "" : t.id)}
                                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition active:scale-95 ${
                                    state.traineeId === t.id
                                      ? "border-slate-950 bg-slate-950 text-white"
                                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400"
                                  }`}
                                >
                                  <User className="h-3 w-3" aria-hidden="true" />
                                  {t.name}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs font-semibold text-slate-400">담당 훈련생이 없습니다.</p>
                          )}
                        </div>
                      )}

                      {/* 평가 점수 입력 */}
                      {(id === "TRAINEE_FINAL_EVAL" || id === "ADAPTATION_FINAL_EVAL") && state.traineeId && (
                        <button
                          onClick={() => {
                            const isTraining = id === "TRAINEE_FINAL_EVAL";
                            const t = siteInfo?.trainees?.find(t => t.id === state.traineeId);
                            const path = isTraining
                              ? `/worker/evaluation/training?traineeId=${state.traineeId}&traineeName=${encodeURIComponent(t?.name||"")}&periodStart=${periodStart}&periodEnd=${periodEnd}`
                              : `/worker/evaluation/adaptation?traineeId=${state.traineeId}&traineeName=${encodeURIComponent(t?.name||"")}&periodStart=${periodStart}&periodEnd=${periodEnd}`;
                            router.push(path);
                          }}
                          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-xs font-black text-emerald-700 transition active:scale-[0.97]"
                        >
                          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                          {id === "TRAINEE_FINAL_EVAL" ? "훈련생 종합평가 입력" : "적응지도 종합평가 입력"}
                        </button>
                      )}

                      {/* 발송 결과 */}
                      {state.result && (
                        <div className={`mb-3 rounded-xl border p-3 ${state.result.success ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                          <p className={`text-xs font-black leading-relaxed ${state.result.success ? "text-emerald-700" : "text-rose-700"}`}>
                            {state.result.msg}
                          </p>
                          {state.result.success && state.result.pdfBase64 && (
                            <div className="mt-2 space-y-2">
                              <button
                                onClick={() => handleDownload(id)}
                                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-950 py-2 text-xs font-black text-white transition active:scale-[0.97]"
                              >
                                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                                PDF 다운로드 (사본)
                              </button>
                              <object
                                data={`data:application/pdf;base64,${state.result.pdfBase64}`}
                                type="application/pdf"
                                className="h-96 w-full rounded-lg border border-slate-200"
                              >
                                <p className="p-3 text-xs text-slate-400">
                                  브라우저에서 PDF 미리보기를 지원하지 않습니다. 위 다운로드 버튼을 이용해 주세요.
                                </p>
                              </object>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 개별 발송 버튼 */}
                      <button
                        onClick={() => sendDoc(id)}
                        disabled={state.loading || bulkLoading}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-xs font-black text-slate-700 transition active:scale-[0.97] disabled:opacity-50"
                      >
                        {state.loading ? (
                          <><Clock className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> 생성 중...</>
                        ) : (
                          <><Send className="h-3.5 w-3.5" aria-hidden="true" /> {label} 개별 발송</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 메인 발송 버튼 */}
        {checkedCount > 0 && (
          <button
            onClick={handleBulkSend}
            disabled={bulkLoading}
            className="mx-4 mt-4 flex min-h-14 w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-2xl bg-slate-950 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-70"
          >
            {bulkLoading ? (
              <><Clock className="h-5 w-5 animate-spin" aria-hidden="true" /> 발송 중...</>
            ) : (
              <><Mail className="h-5 w-5" aria-hidden="true" /> {mainBtnLabel}</>
            )}
          </button>
        )}

        {/* 안내 */}
        <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4 text-center">
          <p className="text-xs font-semibold leading-relaxed text-slate-400">
            PDF가 자동 생성되어 에이전시 담당자에게 발송됩니다.<br />
            직무지도원 서명은 등록된 서명이 자동 삽입됩니다.
          </p>
        </div>

      </div>

      {/* 하단 네비게이션 */}
      <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 border-t border-slate-100 bg-white pb-safe-bottom">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const isActive = pathname === href;
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

export default function DocsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
      </div>
    }>
      <DocsContent />
    </Suspense>
  );
}
