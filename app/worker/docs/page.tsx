"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { getActiveAssignmentCookie } from "@/app/worker/_lib/activeAssignmentCookie";
import {
  BarChart2,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ClipboardList,
  Clock,
  Download,
  FileText,
  Home,
  Mail,
  MapPin,
  PenLine,
  Phone,
  Smartphone,
  TrendingUp,
  User,
  Search,
} from "lucide-react";

interface SiteContact {
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
}

interface SiteInfo {
  companyName: string;
  isPilot: boolean; // ★[PILOT] 파일럿 전용 — 회차 종료 시 삭제(출처=/api/worker/site/current)
  managerEmail: string;
  managerName: string;
  businessContactName: string;
  workerName: string;
  siteContacts: SiteContact[];
  trainees: { id: string; name: string; gender: string }[];
  trainingType: "PRE" | "FIELD" | "ADAPTATION";
}

// 전체 문서 목록 (상태 초기화용)
const ALL_DOC_TYPES = [
  { id: "ATTENDANCE_SHEET",      label: "출근부",          Icon: ClipboardList, desc: "월별 출퇴근 기록",                       needsTrainee: false },
  { id: "TRAINING_DAILY_LOG",    label: "지원고용 훈련일지",        Icon: BookOpen,      desc: "일별 작성",           needsTrainee: true  },
  { id: "TRAINEE_FINAL_EVAL",    label: "지원고용 훈련생 종합평가", Icon: BarChart2,     desc: "훈련 종료 시 작성",   needsTrainee: true  },
  { id: "ADAPTATION_DAILY_LOG",  label: "취업 후 적응지도 일지",    Icon: FileText,      desc: "일별 작성",           needsTrainee: true  },
  { id: "ADAPTATION_FINAL_EVAL", label: "취업 후 적응지도 종합평가",Icon: TrendingUp,    desc: "적응지도 종료 시 작성", needsTrainee: true  },
];

// 서비스 단계별 문서 세트
const TRAINING_DOC_IDS   = ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG",   "TRAINEE_FINAL_EVAL"];
const ADAPTATION_DOC_IDS = ["ATTENDANCE_SHEET", "ADAPTATION_DAILY_LOG", "ADAPTATION_FINAL_EVAL"];

const NAV_ITEMS = [
  { icon: Home,             label: "홈",      href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",  href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",    href: "/worker/docs/view" },
  { icon: Search,           label: "매칭",    href: "/recruit" },
];

const NEEDS_MANAGER_SIGN = new Set(["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG"]);

type DocState = {
  checked: boolean;
  traineeIds: string[];
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
  const [submitLoading, setSubmitLoading] = useState(false);

  const [docStates, setDocStates] = useState<Record<string, DocState>>(
    () => Object.fromEntries(ALL_DOC_TYPES.map(d => [d.id, { checked: false, traineeIds: [], loading: false, result: null }]))
  );

  useEffect(() => {
    // 매니저 수정요청/승인 알림 딥링크: 해당 문서(종류·기간·훈련생)로 자동 이동·선택.
    const focusDoc = searchParams.get("focusDoc");
    const fps = searchParams.get("ps");
    const fpe = searchParams.get("pe");
    const ftid = searchParams.get("tid");
    if (focusDoc && fps && fpe) {
      setPeriodStart(fps);
      setPeriodEnd(fpe);
      setDocStates(prev => prev[focusDoc]
        ? { ...prev, [focusDoc]: { ...prev[focusDoc], checked: true, traineeIds: ftid ? [ftid] : prev[focusDoc].traineeIds } }
        : prev);
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const last = new Date(y, now.getMonth() + 1, 0).getDate();
      setPeriodStart(`${y}-${m}-01`);
      setPeriodEnd(`${y}-${m}-${String(last).padStart(2, "0")}`);
    }

    const tok = searchParams.get("signToken");
    const done = searchParams.get("signDone");
    if (tok && done === "1") {
      setSignToken(tok);
      setSignStatus("done");
    }
  }, []);

  // 멀티현장 선택 배정. C5: 수정요청 딥링크의 aid(원본 배정)가 있으면 그것을 우선(엉뚱한 현장 재제출 방지),
  //  없으면 스위처가 세팅한 쿠키. 문서 조회·생성이 이 현장 기준으로 동작하도록 서버에 전달.
  const linkAid = searchParams.get("aid");
  const activeAssignmentId = linkAid || (typeof window !== "undefined" ? getActiveAssignmentCookie() : null);

  useEffect(() => {
    // allowEnded=1: 문서 화면은 과거(ENDED) 배정 문서의 재제출·수정요청 딥링크를 다루므로 종료 배정도 허용.
    //  (일지류는 이 플래그 없이 호출해 오늘 활성 배정으로 강제 — ENDED 고착 데드엔드 방지)
    const q = activeAssignmentId ? `?assignmentId=${encodeURIComponent(activeAssignmentId)}&allowEnded=1` : "?allowEnded=1";
    fetch(`/api/worker/site/current${q}`, { cache: "no-store" }).then(r => r.json()).then(d => {
      if (d.success && d.data) {
        setSiteInfo({
          companyName:  d.data.companyName,
          isPilot:      d.data.isPilot === true, // ★[PILOT] 회차 종료 시 삭제
          managerEmail: d.data.managerEmail || "",
          managerName:  d.data.managerName  || "담당자",
          businessContactName: d.data.businessContactName || "",
          workerName:    d.data.workerName    || "",
          siteContacts: Array.isArray(d.data.siteContacts) ? d.data.siteContacts : [],
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

  function toggleTrainee(docId: string, traineeId: string) {
    setDocStates(prev => {
      const cur = prev[docId].traineeIds;
      const next = cur.includes(traineeId) ? cur.filter(x => x !== traineeId) : [...cur, traineeId];
      return { ...prev, [docId]: { ...prev[docId], traineeIds: next } };
    });
  }

  function toggleAllTrainees(docId: string, ids: string[]) {
    setDocStates(prev => {
      const cur = prev[docId].traineeIds;
      const allSelected = ids.length > 0 && ids.every(id => cur.includes(id));
      return { ...prev, [docId]: { ...prev[docId], traineeIds: allSelected ? [] : ids } };
    });
  }

  // 현재 서비스 단계에 맞는 문서 세트
  const isAdaptation = siteInfo?.trainingType === "ADAPTATION";
  const activeDocIds = isAdaptation ? ADAPTATION_DOC_IDS : TRAINING_DOC_IDS;
  const DOC_TYPES = ALL_DOC_TYPES.filter(d => activeDocIds.includes(d.id));
  const serviceLabel = isAdaptation ? "취업 후 적응지도" : "지원고용 훈련";

  function openInPersonSign() {
    const firstSignDoc = DOC_TYPES.find(d => NEEDS_MANAGER_SIGN.has(d.id) && docStates[d.id].checked);
    const docType = firstSignDoc?.id || "ATTENDANCE_SHEET";
    const cn = siteInfo?.businessContactName ? `&cn=${encodeURIComponent(siteInfo.businessContactName)}` : "";
    // 선택 현장(aid)을 서명 화면으로 전달 — 사업체 서명이 그 현장 배정에 정확히 귀속되도록(다중현장 오귀속 방지).
    const aidQ = activeAssignmentId ? `&aid=${encodeURIComponent(activeAssignmentId)}` : "";
    router.push(`/worker/docs/manager-sign?dt=${docType}&ps=${periodStart}&pe=${periodEnd}${cn}${aidQ}`);
  }

  async function sendDoc(docId: string): Promise<void> {
    const docInfo = ALL_DOC_TYPES.find(d => d.id === docId)!;
    const state = docStates[docId];
    if (docInfo.needsTrainee && state.traineeIds.length === 0) {
      alert(`${docInfo.label}: 훈련생을 선택해주세요.`);
      return;
    }

    setDocStates(prev => ({ ...prev, [docId]: { ...prev[docId], loading: true, result: null } }));
    try {
      // 미리보기는 선택한 훈련생 중 첫 명 기준으로 생성
      const res = await fetch("/api/worker/docs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: docId,
          periodStart,
          periodEnd,
          traineeId: state.traineeIds[0] || undefined,
          companyManagerSignToken: signToken || undefined,
          assignmentId: activeAssignmentId || undefined,
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

  // 위탁기관에 최종 제출(인앱) — 선택 문서를 기간 묶음으로 제출. 기존 이메일 발송과 별개.
  async function submitDocs() {
    const checkedDocs = ALL_DOC_TYPES.filter(d => activeDocIds.includes(d.id) && docStates[d.id].checked);
    if (checkedDocs.length === 0) { alert("제출할 문서를 선택해주세요."); return; }
    for (const doc of checkedDocs) {
      if (doc.needsTrainee && docStates[doc.id].traineeIds.length === 0) {
        alert(`${doc.label}: 훈련생을 선택해주세요.`);
        return;
      }
    }
    // 훈련생별로 문서를 펼쳐 제출(일지/평가는 훈련생당 1건)
    const documents = checkedDocs.flatMap(d =>
      d.needsTrainee
        ? docStates[d.id].traineeIds.map(tid => ({ docType: d.id, traineeId: tid }))
        : [{ docType: d.id, traineeId: undefined as string | undefined }]
    );
    if (!confirm(`선택한 문서 ${documents.length}건을 위탁기관에 최종 제출할까요?\n제출하면 담당 매니저가 확인·서명합니다. (수정 후 다시 제출하면 새 버전으로 관리됩니다)`)) return;
    setSubmitLoading(true);
    try {
      const res = await fetch("/api/worker/docs/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd, documents, companyManagerSignToken: signToken || undefined, assignmentId: activeAssignmentId || undefined }),
      });
      const data = await res.json();
      if (data.success) alert(`${data.submitted}건을 위탁기관에 제출했습니다. 담당 매니저에게 알림이 전송되었습니다.`);
      else alert(data.message || "제출에 실패했습니다.");
    } catch {
      alert("서버와 연결할 수 없습니다.");
    } finally {
      setSubmitLoading(false);
    }
  }

  // ★[PILOT] 파일럿 전용 함수 — 회차 종료 시 이 함수 통째로 삭제(호출부는 아래 제출 버튼 삼항 1곳뿐).
  // 파일럿: 위탁기관 제출 대신 선택 문서를 한 번에 생성한다(v1.8 §8 — 파일럿에는 받을 담당자가 없다).
  //  생성 경로는 단건과 동일한 sendDoc(=/api/worker/docs/generate)을 그대로 쓴다. 결과 PDF는 각 문서
  //  카드의 'PDF 다운로드 (사본)'로 내려받는다 — 파일럿 전용 생성·다운로드 구현을 새로 만들지 않는다.
  async function generateChecked() {
    const checkedDocs = ALL_DOC_TYPES.filter(d => activeDocIds.includes(d.id) && docStates[d.id].checked);
    if (checkedDocs.length === 0) { alert("생성할 문서를 선택해주세요."); return; }
    for (const doc of checkedDocs) {
      if (doc.needsTrainee && docStates[doc.id].traineeIds.length === 0) {
        alert(`${doc.label}: 훈련생을 선택해주세요.`);
        return;
      }
    }
    setSubmitLoading(true);
    try {
      for (const doc of checkedDocs) await sendDoc(doc.id);
    } finally {
      setSubmitLoading(false);
    }
  }
  // ★[PILOT] 끝

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
          <h1 className="text-base font-black text-slate-900">문서 제출</h1>
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
            {siteInfo.siteContacts.length > 0 ? (
              <div className="py-1">
                <span className="text-xs font-semibold text-slate-400">현장 담당자</span>
                <div className="mt-2 flex flex-col gap-2">
                  {siteInfo.siteContacts.map((c, i) => (
                    <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-black text-slate-800">{c.name}</span>
                        {(c.isPrimary || c.role) && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${c.isPrimary ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"}`}>
                            {c.isPrimary ? "대표" : c.role}
                          </span>
                        )}
                      </div>
                      {c.phone && (
                        <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500">
                          <Phone className="h-3 w-3 flex-shrink-0 text-slate-400" aria-hidden="true" />
                          {c.phone}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-slate-500">
                        <Mail className="h-3 w-3 flex-shrink-0 text-slate-400" aria-hidden="true" />
                        {c.email || "이메일 미등록"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between py-1">
                <span className="flex-shrink-0 text-xs font-semibold text-slate-400">수신자</span>
                <span className="flex items-center gap-1 text-right text-sm font-semibold text-slate-800">
                  <Mail className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
                  {siteInfo.managerName} ({siteInfo.managerEmail || "이메일 미등록"})
                </span>
              </div>
            )}
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
          <div className={`mx-4 mt-3 rounded-xl border px-4 py-3 ${isAdaptation ? "border-amber-200 bg-amber-50" : "border-sky-100 bg-sky-50"}`}>
            <p className={`text-xs font-black ${isAdaptation ? "text-amber-700" : "text-sky-700"}`}>
              현재 서비스: <span className="font-black">{serviceLabel}</span>
            </p>
            <p className={`mt-0.5 text-[11px] font-semibold ${isAdaptation ? "text-amber-600" : "text-sky-500"}`}>
              {isAdaptation
                ? "출근부 · 취업 후 적응지도 일지 (일별) · 취업 후 적응지도 종합평가 (종료 시) 3종"
                : "출근부 · 지원고용 훈련일지 (일별) · 지원고용 훈련생 종합평가 (종료 시) 3종"}
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
            {!siteInfo ? (
              <div className="flex flex-col gap-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-16 animate-pulse rounded-xl border border-slate-100 bg-slate-50" />
                ))}
              </div>
            ) : DOC_TYPES.map(({ id, label, Icon, desc, needsTrainee }) => {
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
                      {/* 훈련생 선택 (여러 명 선택 가능 → 훈련생별 문서 생성) */}
                      {needsTrainee && (
                        <div className="mb-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-xs font-black text-slate-600">
                              훈련생 선택 <span className="font-semibold text-rose-500">*필수</span>
                              <span className="ml-1 font-semibold text-slate-400">(여러 명 가능)</span>
                            </p>
                            {siteInfo?.trainees && siteInfo.trainees.length > 1 && (
                              <button
                                onClick={() => toggleAllTrainees(id, siteInfo!.trainees.map(t => t.id))}
                                className="text-[11px] font-black text-sky-600 active:scale-95"
                              >
                                {siteInfo.trainees.every(t => state.traineeIds.includes(t.id)) ? "전체 해제" : "전체 선택"}
                              </button>
                            )}
                          </div>
                          {siteInfo?.trainees && siteInfo.trainees.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {siteInfo.trainees.map(t => {
                                const sel = state.traineeIds.includes(t.id);
                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => toggleTrainee(id, t.id)}
                                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition active:scale-95 ${
                                      sel
                                        ? "border-slate-950 bg-slate-950 text-white"
                                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400"
                                    }`}
                                  >
                                    {sel ? <Check className="h-3 w-3" aria-hidden="true" /> : <User className="h-3 w-3" aria-hidden="true" />}
                                    {t.name}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs font-semibold text-slate-400">담당 훈련생이 없습니다.</p>
                          )}
                          {state.traineeIds.length > 1 && (
                            <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
                              선택한 {state.traineeIds.length}명에 대해 각각 문서가 생성됩니다.
                            </p>
                          )}
                        </div>
                      )}

                      {/* 평가 점수 입력 — 선택한 훈련생별로 각각 */}
                      {(id === "TRAINEE_FINAL_EVAL" || id === "ADAPTATION_FINAL_EVAL") && state.traineeIds.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {state.traineeIds.map(tid => {
                            const isTraining = id === "TRAINEE_FINAL_EVAL";
                            const t = siteInfo?.trainees?.find(t => t.id === tid);
                            return (
                              <button
                                key={tid}
                                onClick={() => {
                                  const path = isTraining
                                    ? `/worker/evaluation/training?traineeId=${tid}&traineeName=${encodeURIComponent(t?.name||"")}&periodStart=${periodStart}&periodEnd=${periodEnd}`
                                    : `/worker/evaluation/adaptation?traineeId=${tid}&traineeName=${encodeURIComponent(t?.name||"")}&periodStart=${periodStart}&periodEnd=${periodEnd}`;
                                  router.push(path);
                                }}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-xs font-black text-emerald-700 transition active:scale-[0.97]"
                              >
                                <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                                {t?.name} {isTraining ? "종합평가 입력" : "적응지도 평가 입력"}
                              </button>
                            );
                          })}
                        </div>
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
                        disabled={state.loading}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-xs font-black text-slate-700 transition active:scale-[0.97] disabled:opacity-50"
                      >
                        {state.loading ? (
                          <><Clock className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> 생성 중...</>
                        ) : (
                          <><FileText className="h-3.5 w-3.5" aria-hidden="true" /> 미리보기 (PDF 확인)</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 최종 제출(인앱) — 담당 매니저 확인·서명 워크플로.
            ★파일럿 회차 배정은 위탁기관 담당자가 없어 제출 대신 PDF 생성·다운로드로 마무리한다(v1.8 §8).
             서버(worker/docs/submit)가 이미 403으로 막으므로 여기서는 동선만 바꾼다.

            ★[PILOT] ★★이 파일은 파일럿 코드가 **기존 줄을 치환**한 유일한 화면이다(블록 삭제로는 원복 불가).
             회차 종료 시 아래 4곳의 `siteInfo?.isPilot` 삼항을 **비파일럿 쪽 값만 남기고** 되돌린다:
               ① onClick        → `submitDocs`
               ② 로딩 문구       → `제출 중...`
               ③ 버튼 라벨       → `<Check …/> 위탁기관에 최종 제출 ({checkedCount}개)`
               ④ 보조 문구       → `제출하면 담당 매니저가 앱에서 확인·서명합니다. 수정 후 재제출 시 새 버전으로 관리됩니다.`
               ⑤ 하단 안내(아래)  → `'위탁기관에 최종 제출'을 누르면 담당 매니저 앱으로 전달됩니다.`
             그리고 `generateChecked` 함수·`SiteInfo.isPilot` 필드·`isPilot` 대입 1줄을 삭제하면 끝난다.
             (Download 아이콘 import는 handleDownload가 이미 쓰므로 남긴다.) */}
        {checkedCount > 0 && (
          <>
            <button
              onClick={siteInfo?.isPilot ? generateChecked : submitDocs}
              disabled={submitLoading}
              className="mx-4 mt-4 flex min-h-14 w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-black text-white shadow-lg shadow-emerald-600/20 transition active:scale-[0.97] disabled:opacity-70"
            >
              {submitLoading ? (
                <><Clock className="h-5 w-5 animate-spin" aria-hidden="true" /> {siteInfo?.isPilot ? "생성 중..." : "제출 중..."}</>
              ) : siteInfo?.isPilot ? (
                <><Download className="h-5 w-5" aria-hidden="true" /> 파일럿 PDF 생성 ({checkedCount}개)</>
              ) : (
                <><Check className="h-5 w-5" aria-hidden="true" /> 위탁기관에 최종 제출 ({checkedCount}개)</>
              )}
            </button>
            <p className="mx-4 mt-1.5 text-center text-[11px] font-semibold text-slate-400">
              {siteInfo?.isPilot
                ? "생성한 뒤 각 문서의 'PDF 다운로드'로 내려받아 사용해주세요."
                : "제출하면 담당 매니저가 앱에서 확인·서명합니다. 수정 후 재제출 시 새 버전으로 관리됩니다."}
            </p>
          </>
        )}

        {/* 안내 — ★[PILOT] 위 ⑤. 원복 시 파일럿 분기를 지우고 아래 비파일럿 문구만 남긴다. */}
        <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4 text-center">
          <p className="text-xs font-semibold leading-relaxed text-slate-400">
            {siteInfo?.isPilot ? (
              <>파일럿 기간에는 위탁기관 제출 없이 PDF로 내려받아 사용합니다.<br /></>
            ) : (
              <>&apos;위탁기관에 최종 제출&apos;을 누르면 담당 매니저 앱으로 전달됩니다.<br /></>
            )}
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
