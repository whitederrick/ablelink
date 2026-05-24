"use client";

import { useEffect, useState } from "react";
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
  Download,
  ExternalLink,
  FileText,
  Home,
  Mail,
  MapPin,
  PenLine,
  Send,
  TrendingUp,
  User,
} from "lucide-react";

interface SiteInfo {
  companyName: string;
  managerEmail: string;
  managerName: string;
  coachName: string;
  trainees: { id: string; name: string; gender: string }[];
}

const DOC_TYPES = [
  { id: "ATTENDANCE_SHEET",      label: "출근부",          Icon: ClipboardList, desc: "월별 출퇴근 기록",        needsTrainee: false },
  { id: "TRAINING_DAILY_LOG",    label: "훈련일지",         Icon: BookOpen,      desc: "지원고용 훈련일지",        needsTrainee: true  },
  { id: "TRAINEE_FINAL_EVAL",    label: "훈련생 종합평가",  Icon: BarChart2,     desc: "훈련생 종합 평가기록부",    needsTrainee: true  },
  { id: "ADAPTATION_DAILY_LOG",  label: "적응지도 일지",    Icon: FileText,      desc: "취업 후 적응지도 일지",     needsTrainee: true  },
  { id: "ADAPTATION_FINAL_EVAL", label: "적응지도 종합평가",Icon: TrendingUp,    desc: "적응지도 종합 평가기록부",  needsTrainee: true  },
];

const NAV_ITEMS = [
  { icon: Home,             label: "홈",      href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",  href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",    href: "/worker/docs" },
  { icon: CircleDollarSign, label: "히스토리", href: "/worker/history" },
];

export default function DocsPage() {
  const router = useRouter();
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [selectedDoc, setSelectedDoc] = useState("ATTENDANCE_SHEET");
  const [selectedTraineeId, setSelectedTraineeId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; msg: string; pdfBase64?: string; fileName?: string } | null>(null);

  const [signToken, setSignToken]           = useState<string | null>(null);
  const [signUrl, setSignUrl]               = useState<string | null>(null);
  const [signRequesting, setSignRequesting] = useState(false);
  const [signStatus, setSignStatus]         = useState<"none"|"pending"|"done">("none");
  const [signatureUrl, setSignatureUrl]     = useState<string | null>(null);
  const [copied, setCopied]                 = useState(false);

  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const last = new Date(y, now.getMonth() + 1, 0).getDate();
    setPeriodStart(`${y}-${m}-01`);
    setPeriodEnd(`${y}-${m}-${String(last).padStart(2, "0")}`);
  }, []);

  useEffect(() => {
    fetch("/api/worker/site/current").then(r => r.json()).then(d => {
      if (d.success && d.data) {
        setSiteInfo({
          companyName:  d.data.companyName,
          managerEmail: d.data.managerEmail || "",
          managerName:  d.data.managerName  || "담당자",
          coachName:    d.data.coachName    || "",
          trainees: (d.data.trainees || []).map((t: any) => ({
            id: String(t.id), name: t.name, gender: t.gender,
          })),
        });
      }
    });
  }, []);

  function selectDoc(id: string) {
    setSelectedDoc(id); setResult(null);
    setSignToken(null); setSignUrl(null); setSignStatus("none"); setSignatureUrl(null);
  }

  async function requestCompanySign() {
    setSignRequesting(true);
    try {
      const res = await fetch("/api/worker/docs/sign-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: selectedDoc, periodStart, periodEnd,
          signRole: "company_manager", signerName: "사업체 담당자",
        }),
      });
      const d = await res.json();
      if (d.success) {
        setSignToken(d.token); setSignUrl(d.signUrl); setSignStatus("pending");
        try { await navigator.clipboard.writeText(d.signUrl); } catch {}
        pollSignature(d.token);
      } else {
        alert(d.message || "링크 생성 실패");
      }
    } finally { setSignRequesting(false); }
  }

  function pollSignature(token: string) {
    let count = 0;
    const iv = setInterval(async () => {
      count++;
      const d = await fetch(`/api/worker/docs/sign-token?token=${token}`).then(r => r.json());
      if (d.signed && d.signatureUrl) {
        clearInterval(iv);
        setSignStatus("done"); setSignatureUrl(d.signatureUrl);
      }
      if (count >= 36) clearInterval(iv);
    }, 10000);
  }

  async function handleSend() {
    if (!siteInfo?.managerEmail) { alert("에이전시 담당자 이메일이 등록되지 않았습니다."); return; }
    const needsTrainee = DOC_TYPES.find(d => d.id === selectedDoc)?.needsTrainee;
    if (needsTrainee && !selectedTraineeId) { alert("훈련생을 선택해주세요."); return; }

    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/worker/docs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: selectedDoc, periodStart, periodEnd,
          traineeId: selectedTraineeId || undefined,
          companyManagerSignToken: signToken || undefined,
          sendEmail: true, toEmail: siteInfo.managerEmail,
        }),
      });
      const data = await res.json();
      if (!data.success) { setResult({ success: false, msg: data.message || "오류가 발생했습니다." }); return; }
      setResult({ success: true, msg: data.message, pdfBase64: data.pdfBase64, fileName: data.fileName });
    } catch { setResult({ success: false, msg: "서버와 연결할 수 없습니다." }); }
    finally { setLoading(false); }
  }

  function handleDownload() {
    if (!result?.pdfBase64 || !result?.fileName) return;
    const blob = new Blob([Uint8Array.from(atob(result.pdfBase64), c => c.charCodeAt(0))], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = result.fileName; a.click();
    URL.revokeObjectURL(url);
  }

  async function copySignUrl() {
    if (!signUrl) return;
    try { await navigator.clipboard.writeText(signUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  const needsTrainee = DOC_TYPES.find(d => d.id === selectedDoc)?.needsTrainee ?? false;
  const selectedLabel = DOC_TYPES.find(d => d.id === selectedDoc)?.label || "문서";

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

        {/* 문서 종류 */}
        <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">문서 종류</p>
          <div className="flex flex-col gap-2">
            {DOC_TYPES.map(({ id, label, Icon, desc }) => {
              const isActive = selectedDoc === id;
              return (
                <button
                  key={id}
                  onClick={() => selectDoc(id)}
                  className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition active:scale-[0.98] ${
                    isActive
                      ? "border-slate-950 bg-slate-950"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${isActive ? "bg-white/15" : "bg-white"}`}>
                    <Icon className={`h-5 w-5 ${isActive ? "text-white" : "text-slate-500"}`} aria-hidden="true" />
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

        {/* 훈련생 선택 */}
        {needsTrainee && (
          <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-3 text-sm font-black text-slate-700">훈련생 선택</p>
            {siteInfo?.trainees && siteInfo.trainees.length > 0 ? (
              <div className="flex flex-col gap-2">
                {siteInfo.trainees.map(t => {
                  const isActive = selectedTraineeId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTraineeId(t.id)}
                      className={`flex items-center gap-3 rounded-xl border p-3.5 transition active:scale-[0.98] ${
                        isActive
                          ? "border-slate-950 bg-slate-950"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300"
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
            ) : (
              <p className="text-sm font-semibold text-slate-400">담당 훈련생이 없습니다.</p>
            )}
          </div>
        )}

        {/* 평가 점수 입력 */}
        {(selectedDoc === "TRAINEE_FINAL_EVAL" || selectedDoc === "ADAPTATION_FINAL_EVAL") && selectedTraineeId && (
          <div className="mx-4 mt-3">
            <button
              onClick={() => {
                const evalType = selectedDoc === "TRAINEE_FINAL_EVAL" ? "TRAINING" : "ADAPTATION";
                const t = siteInfo?.trainees?.find((t: any) => t.id === selectedTraineeId);
                router.push(`/worker/evaluation?traineeId=${selectedTraineeId}&traineeName=${encodeURIComponent(t?.name||"")}&evalType=${evalType}&periodStart=${periodStart}&periodEnd=${periodEnd}`);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 py-3.5 text-sm font-black text-emerald-700 transition active:scale-[0.97]"
            >
              <PenLine className="h-4 w-4" aria-hidden="true" />
              평가 점수 입력하기
            </button>
          </div>
        )}

        {/* 기간 설정 */}
        <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">기간 설정</p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={periodStart}
              onChange={e => { setPeriodStart(e.target.value); setResult(null); }}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
            />
            <span className="text-sm font-semibold text-slate-400">~</span>
            <input
              type="date"
              value={periodEnd}
              onChange={e => { setPeriodEnd(e.target.value); setResult(null); }}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
            />
          </div>
        </div>

        {/* 사업체담당자 서명 요청 */}
        <div className="mx-4 mt-3 rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-black text-slate-700">사업체담당자 서명</p>
            {signStatus === "done" && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-black text-emerald-600">
                <Check className="h-3 w-3" aria-hidden="true" /> 서명 완료
              </span>
            )}
          </div>

          {signStatus === "none" && (
            <button
              onClick={requestCompanySign}
              disabled={signRequesting}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-60"
            >
              {signRequesting ? (
                <><Clock className="h-4 w-4 animate-spin" aria-hidden="true" /> 링크 생성 중...</>
              ) : (
                <><Send className="h-4 w-4" aria-hidden="true" /> 서명 요청 링크 생성</>
              )}
            </button>
          )}

          {signStatus === "pending" && signUrl && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-xs font-black text-slate-700">
                아래 링크를 사업체 담당자에게 전달하세요
              </p>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="break-all text-xs font-semibold text-slate-600">{signUrl}</p>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={copySignUrl}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-black text-slate-700 transition active:scale-[0.97]"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {copied ? "복사됨!" : "복사"}
                </button>
                <button
                  onClick={() => window.open(signUrl!, "_blank")}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-black text-slate-700 transition active:scale-[0.97]"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  QR 미리보기
                </button>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                서명 완료를 기다리는 중... (자동 감지)
              </p>
            </div>
          )}

          {signStatus === "done" && signatureUrl && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <img src={signatureUrl} alt="서명" className="h-10 object-contain" />
              <span className="text-xs font-black text-emerald-700">서명이 문서에 포함됩니다.</span>
            </div>
          )}

          <p className="mt-3 text-xs font-semibold leading-relaxed text-slate-400">
            서명 없이 발송하면 서명란이 빈칸으로 출력됩니다.
          </p>
        </div>

        {/* 결과 */}
        {result && (
          <div className={`mx-4 mt-3 rounded-2xl border p-4 ${
            result.success
              ? "border-emerald-200 bg-emerald-50"
              : "border-rose-200 bg-rose-50"
          }`}>
            <p className={`text-sm font-black leading-relaxed ${result.success ? "text-emerald-700" : "text-rose-700"}`}>
              {result.msg}
            </p>
            {result.success && result.pdfBase64 && (
              <button
                onClick={handleDownload}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 text-sm font-black text-white transition active:scale-[0.97]"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                PDF 다운로드 (사본)
              </button>
            )}
          </div>
        )}

        {/* 발송 버튼 */}
        <button
          onClick={handleSend}
          disabled={loading}
          className="mx-4 mt-4 flex min-h-14 w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-2xl bg-slate-950 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-70"
        >
          {loading ? (
            <><Clock className="h-5 w-5 animate-spin" aria-hidden="true" /> PDF 생성 및 발송 중...</>
          ) : (
            <><Mail className="h-5 w-5" aria-hidden="true" /> {selectedLabel} 발송</>
          )}
        </button>

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
