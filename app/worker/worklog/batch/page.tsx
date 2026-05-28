"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, ChevronDown, ChevronUp,
  Loader2, Mic, Square, Users,
} from "lucide-react";

// ─── 타입 ───────────────────────────────────────────────────
interface Trainee { id: string; name: string; gender?: string; }
interface Draft {
  date: string;
  traineeId: string;
  traineeName: string;
  content: string;
  selected: boolean;
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function todayStr() {
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.toISOString().slice(0, 10);
}

// ─── 메인 페이지 ─────────────────────────────────────────────
export default function BatchWorklogPage() {
  const router = useRouter();

  // 사이트 정보
  const [assignmentId, setAssignmentId] = useState<string>("");
  const [trainees, setTrainees]         = useState<Trainee[]>([]);
  const [siteLoading, setSiteLoading]   = useState(true);
  const [planOk, setPlanOk]             = useState(false);

  // STEP 1: 날짜 + 훈련생 선택
  const today = todayStr();
  const [dateFrom, setDateFrom]             = useState(today);
  const [dateTo,   setDateTo]               = useState(today);
  const [selectedTrainees, setSelectedTrainees] = useState<Set<string>>(new Set());

  // STEP 2: 녹음
  const [step, setStep]             = useState<1 | 2 | 3>(1);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [aiLoading, setAiLoading]     = useState(false);
  const mediaRef         = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);

  // STEP 3: 검토·수정·제출
  const [drafts, setDrafts]       = useState<Draft[]>([]);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]           = useState(false);

  // 공통 시간 (간소화 — 기본값)
  const [time1on1, setTime1on1]   = useState(3);
  const [sentenceCount, setSentenceCount] = useState(2);

  // ── 사이트 정보 로드 ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/worker/site/current");
        const data = await res.json();
        if (!data.success || !data.data) { router.push("/worker/home"); return; }
        const d = data.data;
        setAssignmentId(d.assignmentId);
        setTrainees(d.trainees ?? []);
        // STARTER+ 확인
        const ok = ["STARTER", "STANDARD", "PRO"].includes(d.agencyPlanType ?? "") ||
          (d.agencyPlanType === "TRIAL" && d.trialEndsAt && new Date(d.trialEndsAt) > new Date());
        setPlanOk(ok);
      } catch {
        router.push("/worker/home");
      } finally {
        setSiteLoading(false);
      }
    })();
  }, []);

  // ── 훈련생 토글 ─────────────────────────────────────────────
  function toggleTrainee(id: string) {
    setSelectedTrainees(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── 녹음 시작/중지 ──────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await sendAudio(blob, mimeType);
      };
      recorder.start(500);
      mediaRef.current = recorder;
      setIsRecording(true);
      setRecordingSec(0);
      timerRef.current = setInterval(() => setRecordingSec(s => s + 1), 1000);
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        alert(
          "마이크 접근 권한이 거부되었습니다.\n\n" +
          "[허용 방법]\n" +
          "• Chrome / Edge:\n" +
          "  주소창 왼쪽 자물쇠(🔒) 클릭\n" +
          "  → 사이트 설정 → 마이크 → 허용\n\n" +
          "• Safari (iPhone/iPad):\n" +
          "  설정 앱 → Safari → 마이크 → 허용\n\n" +
          "• Safari (Mac):\n" +
          "  Safari 메뉴 → 설정 → 웹사이트 탭\n" +
          "  → 마이크 → able-link.co.kr → 허용"
        );
      } else if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
        alert("마이크 장치를 찾을 수 없습니다.\n마이크가 연결되어 있는지 확인해주세요.");
      } else {
        alert(
          "마이크를 사용할 수 없습니다.\n\n" +
          "• HTTPS 연결(able-link.co.kr)에서만 사용 가능합니다.\n" +
          "• 다른 앱이 마이크를 점유하고 있으면 앱을 닫고 다시 시도해주세요.\n" +
          "• 문제가 계속되면 브라우저를 재시작해주세요."
        );
      }
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecordingSec(0);
  }

  async function sendAudio(blob: Blob, mimeType: string) {
    setAiLoading(true);
    try {
      const formData = new FormData();
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      formData.append("audio", blob, `recording.${ext}`);
      formData.append("dateFrom", dateFrom);
      formData.append("dateTo",   dateTo);
      formData.append("sentenceCount", String(sentenceCount));
      formData.append("trainees", JSON.stringify(
        trainees.filter(t => selectedTrainees.has(t.id)).map(t => ({ id: t.id, name: t.name }))
      ));
      const res  = await fetch("/api/worker/ai/batch-voice-to-log", { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success) { alert(data.message || "AI 변환에 실패했습니다."); return; }
      setDrafts(data.drafts.map((d: Omit<Draft, "selected">) => ({ ...d, selected: true })));
      setStep(3);
    } catch {
      alert("AI 변환 중 오류가 발생했습니다.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── 일괄 저장 ────────────────────────────────────────────────
  async function submitAll() {
    const toSave = drafts.filter(d => d.selected);
    if (toSave.length === 0) { alert("저장할 일지를 선택해주세요."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/worker/logs/batch-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId,
          logs: toSave.map(d => ({
            date:         d.date,
            traineeId:    d.traineeId,
            trainingType: "FIELD",
            time1on1:     time1on1,
            timeGroup:    0,
            content:      d.content,
          })),
        }),
      });
      const data = await res.json();
      if (!data.success) { alert(data.message || "저장 실패"); return; }
      setDone(true);
    } catch {
      alert("저장 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 날짜 범위 내 날짜 수 ─────────────────────────────────────
  function dayCount() {
    const from = new Date(dateFrom + "T00:00:00");
    const to   = new Date(dateTo   + "T00:00:00");
    const diff = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    return Math.max(0, Math.min(31, diff));
  }

  // ── 완료 화면 ────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 p-6">
        <CheckCircle2 className="h-16 w-16 text-emerald-500" />
        <p className="text-xl font-black text-slate-900">일지 저장 완료!</p>
        <p className="text-sm text-slate-500">
          {drafts.filter(d => d.selected).length}개 일지가 저장되었습니다.
        </p>
        <button
          onClick={() => router.push("/worker/home")}
          className="rounded-2xl bg-slate-950 px-8 py-3 text-sm font-black text-white active:scale-95"
        >
          홈으로
        </button>
      </div>
    );
  }

  if (siteLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!planOk) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-black text-slate-900">STARTER 플랜 이상에서만 사용 가능합니다.</p>
        <p className="text-sm text-slate-500">에이전시 담당자에게 구독 업그레이드를 요청해주세요.</p>
        <button onClick={() => router.back()} className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white">
          돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur-sm">
        <button onClick={() => router.back()} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <p className="text-sm font-black text-slate-900">AI 일지 일괄 작성</p>
          <p className="text-xs text-slate-400">음성 1회로 여러 날짜 일지를 한번에</p>
        </div>
        {/* 스텝 인디케이터 */}
        <div className="ml-auto flex items-center gap-1.5">
          {([1, 2, 3] as const).map(s => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all ${
                s === step ? "w-6 bg-slate-950" : s < step ? "w-2 bg-emerald-400" : "w-2 bg-slate-200"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-lg px-4 pt-5 space-y-4">

        {/* ── STEP 1: 날짜 + 훈련생 ──────────────────────────── */}
        {step === 1 && (
          <>
            <div className="rounded-2xl bg-white p-5 shadow-sm space-y-4">
              <p className="text-base font-black text-slate-900">① 기간 선택</p>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-semibold text-slate-500">시작일</label>
                  <input
                    type="date"
                    value={dateFrom}
                    max={today}
                    onChange={e => {
                      setDateFrom(e.target.value);
                      if (e.target.value > dateTo) setDateTo(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-950"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-semibold text-slate-500">종료일</label>
                  <input
                    type="date"
                    value={dateTo}
                    min={dateFrom}
                    max={today}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-950"
                  />
                </div>
              </div>
              {dayCount() > 0 && (
                <p className="text-xs font-semibold text-slate-400">총 {dayCount()}일 선택됨</p>
              )}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-base font-black text-slate-900">② 훈련생 선택</p>
                <button
                  onClick={() => {
                    if (selectedTrainees.size === trainees.length) {
                      setSelectedTrainees(new Set());
                    } else {
                      setSelectedTrainees(new Set(trainees.map(t => t.id)));
                    }
                  }}
                  className="text-xs font-semibold text-slate-500 underline"
                >
                  {selectedTrainees.size === trainees.length ? "전체 해제" : "전체 선택"}
                </button>
              </div>
              {trainees.length === 0 ? (
                <p className="text-sm text-slate-400">배정된 훈련생이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {trainees.map(t => (
                    <button
                      key={t.id}
                      onClick={() => toggleTrainee(t.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition active:scale-[0.98] ${
                        selectedTrainees.has(t.id)
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-semibold">{t.name}</span>
                      {selectedTrainees.has(t.id) && (
                        <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
              <p className="text-base font-black text-slate-900">③ 1:1 지도 시간 (공통)</p>
              <div className="flex items-center gap-3">
                {[1, 2, 3, 4, 5, 6].map(h => (
                  <button
                    key={h}
                    onClick={() => setTime1on1(h)}
                    className={`flex-1 rounded-xl border py-2.5 text-sm font-bold transition active:scale-95 ${
                      time1on1 === h
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">모든 일지에 동일한 시간이 적용됩니다. 저장 후 개별 수정 가능.</p>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
              <p className="text-base font-black text-slate-900">④ AI 생성 문장 수</p>
              <div className="flex gap-2">
                {[2, 3, 4].map(n => (
                  <button
                    key={n}
                    onClick={() => setSentenceCount(n)}
                    className={`flex-1 rounded-xl border py-2.5 text-sm font-black transition active:scale-95 ${
                      sentenceCount === n
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    {n}문장
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                if (dayCount() === 0) { alert("날짜 범위를 확인해주세요."); return; }
                if (selectedTrainees.size === 0) { alert("훈련생을 1명 이상 선택해주세요."); return; }
                setStep(2);
              }}
              className="w-full rounded-2xl bg-slate-950 py-4 text-base font-black text-white active:scale-[0.98]"
            >
              다음 — 음성 녹음
            </button>
          </>
        )}

        {/* ── STEP 2: 녹음 ────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 shadow-sm text-center space-y-3">
              <p className="text-base font-black text-slate-900">음성으로 일지 내용을 말해주세요</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                {dateFrom === dateTo ? dateFrom : `${dateFrom} ~ ${dateTo}`} ·{" "}
                {trainees.filter(t => selectedTrainees.has(t.id)).map(t => t.name).join(", ")}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                날짜별·훈련생별로 어떤 지도를 했는지 자유롭게 말씀해주세요.<br />
                AI가 자동으로 각 조합별 일지로 분리합니다.
              </p>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm flex flex-col items-center gap-5">
              {aiLoading ? (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-slate-400" />
                  <p className="text-sm font-semibold text-slate-500">AI가 일지를 작성 중입니다...</p>
                  <p className="text-xs text-slate-400">
                    {dayCount()}일 × {selectedTrainees.size}명 = {dayCount() * selectedTrainees.size}개 일지 생성 중
                  </p>
                </>
              ) : (
                <>
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`relative flex h-24 w-24 items-center justify-center rounded-full shadow-lg transition active:scale-95 ${
                      isRecording ? "bg-red-500" : "bg-slate-950"
                    }`}
                  >
                    {isRecording ? (
                      <Square className="h-8 w-8 text-white" />
                    ) : (
                      <Mic className="h-8 w-8 text-white" />
                    )}
                    {isRecording && (
                      <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                      </span>
                    )}
                  </button>

                  {isRecording ? (
                    <p className="text-sm font-black text-red-500">
                      녹음 중... {Math.floor(recordingSec / 60)}:{pad2(recordingSec % 60)}
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-slate-500">버튼을 눌러 녹음 시작</p>
                  )}
                </>
              )}
            </div>

            <button
              onClick={() => setStep(1)}
              className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-600 active:scale-[0.98]"
            >
              이전으로
            </button>
          </div>
        )}

        {/* ── STEP 3: 검토·수정·제출 ───────────────────────────── */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-base font-black text-slate-900">
                일지 검토 ({drafts.filter(d => d.selected).length}/{drafts.length})
              </p>
              <button
                onClick={() => {
                  const allSelected = drafts.every(d => d.selected);
                  setDrafts(prev => prev.map(d => ({ ...d, selected: !allSelected })));
                }}
                className="text-xs font-semibold text-slate-500 underline"
              >
                {drafts.every(d => d.selected) ? "전체 해제" : "전체 선택"}
              </button>
            </div>

            {/* 날짜별 그룹 */}
            {[...new Set(drafts.map(d => d.date))].map(date => {
              const dateDrafts = drafts.filter(d => d.date === date);
              const isOpen = expanded.has(date);
              const allSel = dateDrafts.every(d => d.selected);
              return (
                <div key={date} className="rounded-2xl bg-white shadow-sm overflow-hidden">
                  <button
                    onClick={() => {
                      setExpanded(prev => {
                        const next = new Set(prev);
                        next.has(date) ? next.delete(date) : next.add(date);
                        return next;
                      });
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <input
                      type="checkbox"
                      checked={allSel}
                      onClick={e => e.stopPropagation()}
                      onChange={e => {
                        setDrafts(prev => prev.map(d =>
                          d.date === date ? { ...d, selected: e.target.checked } : d
                        ));
                      }}
                      className="h-4 w-4 rounded accent-slate-950"
                    />
                    <span className="flex-1 text-sm font-black text-slate-900">{date}</span>
                    <span className="text-xs text-slate-400">{dateDrafts.length}명</span>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {dateDrafts.map((d, i) => {
                        const globalIdx = drafts.findIndex(
                          dr => dr.date === d.date && dr.traineeId === d.traineeId
                        );
                        return (
                          <div key={d.traineeId} className="px-4 py-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={d.selected}
                                onChange={e => {
                                  setDrafts(prev => prev.map((dr, idx) =>
                                    idx === globalIdx ? { ...dr, selected: e.target.checked } : dr
                                  ));
                                }}
                                className="h-4 w-4 rounded accent-slate-950"
                              />
                              <span className="text-xs font-black text-slate-700">{d.traineeName}</span>
                            </div>
                            <textarea
                              value={d.content}
                              onChange={e => {
                                setDrafts(prev => prev.map((dr, idx) =>
                                  idx === globalIdx ? { ...dr, content: e.target.value } : dr
                                ));
                              }}
                              rows={3}
                              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-950"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={submitAll}
              disabled={submitting || drafts.filter(d => d.selected).length === 0}
              className="w-full rounded-2xl bg-slate-950 py-4 text-base font-black text-white active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  저장 중...
                </span>
              ) : (
                `${drafts.filter(d => d.selected).length}개 일지 저장`
              )}
            </button>

            <button
              onClick={() => { setDrafts([]); setStep(2); }}
              className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-600 active:scale-[0.98]"
            >
              다시 녹음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
