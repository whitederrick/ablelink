"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays, CheckCircle2, ChevronLeft, Home,
  Info, Loader2, Mic, Square,
} from "lucide-react";

// ─── 타입 ──────────────────────────────────────────────────────────
type Attendance = "출석" | "결석" | "지각" | "조퇴";
type TrainingType = "PRE" | "FIELD" | "ADAPTATION";

interface SiteInfo {
  workType: string;
  traineeCount: number;
  commuteGuidanceIncluded: boolean;
  agencyPlanType?: string;
  trialEndsAt?: string | null;
  customWorkStart?: string | null;
  customWorkEnd?: string | null;
}

// ─── 유틸 ──────────────────────────────────────────────────────────
function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function diffHours(start: string, end: string): number {
  return Math.max(0, Math.round((parseHHMM(end) - parseHHMM(start)) / 6) / 10);
}
function calcBonus(commute: boolean, breakTime: boolean): number {
  if (!commute && !breakTime) return 0;
  return 1.5;
}
function isPremium(plan?: string, trialEndsAt?: string | null): boolean {
  if (!plan || plan === "FREE") return false;
  if (plan === "TRIAL") return trialEndsAt ? new Date(trialEndsAt) > new Date() : false;
  return ["STARTER", "STANDARD", "PRO"].includes(plan);
}

// 관리자 설정 workType → 기본 시간 반환
// 관리자 설정 기반 근무 시간 반환
// end(guidanceEnd): 공단 인정 시간 계산 기준 (FULL_DAY는 점심 1H 공제)
// workEnd: 화면 표시용 실제 종료 시간
function adminTimes(workType: string, customStart?: string | null, customEnd?: string | null) {
  // 관리자가 시간 직접 설정한 경우 우선 적용 (모든 workType)
  let start: string, workEnd: string;
  if (customStart && customEnd) {
    start = customStart; workEnd = customEnd;
  } else if (workType === "AM")  { start = "09:00"; workEnd = "13:00"; }
  else if (workType === "PM")    { start = "13:00"; workEnd = "17:00"; }
  else                           { start = "09:00"; workEnd = "18:00"; } // FULL_DAY / CUSTOM

  // FULL_DAY: 점심 1시간 공제 → guidanceEnd = workEnd - 1H
  const isFullDay = workType === "FULL_DAY";
  const lunchMin  = isFullDay ? 60 : 0;
  const gEndMin   = parseHHMM(workEnd) - lunchMin;
  const guidanceEnd = `${String(Math.floor(gEndMin / 60)).padStart(2, "0")}:${String(gEndMin % 60).padStart(2, "0")}`;

  return { start, end: guidanceEnd, workEnd };
}

// 관리자 설정 기반 지도여부 계산
function adminGuidance(workType: string, commuteIncluded: boolean) {
  if (workType === "FULL_DAY") return { commute: false, breakTime: false };
  return { commute: commuteIncluded, breakTime: true };
}

// ─── 시계 다이얼 피커 ───────────────────────────────────────────
function ClockPicker({ value, onChange, onClose, label }: {
  value: string; onChange: (v: string) => void; onClose: () => void; label?: string;
}) {
  const [hStr, mStr] = value.split(":");
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const [hour, setHour] = useState(parseInt(hStr ?? "9", 10));
  const [minute, setMinute] = useState(parseInt(mStr ?? "0", 10));
  const [manualH, setManualH] = useState(String(parseInt(hStr ?? "9", 10)).padStart(2, "0"));
  const [manualM, setManualM] = useState(String(parseInt(mStr ?? "0", 10)).padStart(2, "0"));

  const SIZE = 240; const CX = SIZE / 2; const CY = SIZE / 2;
  const R_OUTER = 95; const R_INNER = 60; const HAND_OUTER = 80; const HAND_INNER = 48;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function draw() {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;
    canvas.style.width = SIZE + "px"; canvas.style.height = SIZE + "px";
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "#f3f4f6"; ctx.beginPath(); ctx.arc(CX, CY, SIZE / 2 - 1, 0, Math.PI * 2); ctx.fill();

    if (mode === "hour") {
      const outer = Array.from({ length: 12 }, (_, i) => ({ val: i === 0 ? 12 : i, idx: i }));
      const inner = Array.from({ length: 12 }, (_, i) => ({ val: i === 0 ? 0 : i + 12, idx: i }));
      const isOuter = hour >= 1 && hour <= 12;
      const selIdx = isOuter ? (hour === 12 ? 0 : hour) : (hour === 0 ? 0 : hour - 12);
      const handR = isOuter ? HAND_OUTER : HAND_INNER;
      const ang = (selIdx / 12) * Math.PI * 2 - Math.PI / 2;
      const hx = CX + Math.cos(ang) * handR; const hy = CY + Math.sin(ang) * handR;
      ctx.strokeStyle = "#111827"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.arc(CX, CY, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx, hy, 20, 0, Math.PI * 2); ctx.fill();
      outer.forEach(({ val, idx }) => {
        const a = (idx / 12) * Math.PI * 2 - Math.PI / 2;
        const nx = CX + Math.cos(a) * R_OUTER; const ny = CY + Math.sin(a) * R_OUTER;
        const sel = isOuter && idx === selIdx;
        ctx.font = `${sel ? "700" : "400"} 15px -apple-system,sans-serif`;
        ctx.fillStyle = sel ? "#fff" : "#374151"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(val), nx, ny);
      });
      inner.forEach(({ val, idx }) => {
        const a = (idx / 12) * Math.PI * 2 - Math.PI / 2;
        const nx = CX + Math.cos(a) * R_INNER; const ny = CY + Math.sin(a) * R_INNER;
        const sel = !isOuter && idx === selIdx;
        if (sel) { ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.arc(nx, ny, 15, 0, Math.PI * 2); ctx.fill(); }
        ctx.font = `${sel ? "700" : "400"} 11px -apple-system,sans-serif`;
        ctx.fillStyle = sel ? "#fff" : "#9ca3af"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(val), nx, ny);
      });
    } else {
      const mins = Array.from({ length: 12 }, (_, i) => i * 5);
      const selIdx = Math.round(minute / 5) % 12;
      const ang = (selIdx / 12) * Math.PI * 2 - Math.PI / 2;
      const hx = CX + Math.cos(ang) * HAND_OUTER; const hy = CY + Math.sin(ang) * HAND_OUTER;
      ctx.strokeStyle = "#111827"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.arc(CX, CY, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx, hy, 20, 0, Math.PI * 2); ctx.fill();
      mins.forEach((val, i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const nx = CX + Math.cos(a) * R_OUTER; const ny = CY + Math.sin(a) * R_OUTER;
        const sel = i === selIdx;
        ctx.font = `${sel ? "700" : "400"} 14px -apple-system,sans-serif`;
        ctx.fillStyle = sel ? "#fff" : "#374151"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(val).padStart(2, "0"), nx, ny);
      });
      if (minute % 5 !== 0) {
        ctx.font = "600 14px -apple-system,sans-serif"; ctx.fillStyle = "#6b7280";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(minute).padStart(2, "0"), CX, CY);
      }
    }
  }

  useEffect(() => { draw(); }, [mode, hour, minute]);

  function interact(clientX: number, clientY: number) {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - rect.left - CX; const dy = clientY - rect.top - CY;
    if (Math.sqrt(dx * dx + dy * dy) < 15) return;
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const idx = Math.round(angle / (Math.PI * 2 / 12)) % 12;
    if (mode === "hour") {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const h = dist < 72 ? (idx === 0 ? 0 : idx + 12) : (idx === 0 ? 12 : idx);
      setHour(h); setManualH(String(h).padStart(2, "0"));
      setTimeout(() => setMode("minute"), 200);
    } else {
      const m = idx * 5; setMinute(m); setManualM(String(m).padStart(2, "0"));
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.50)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 320, boxShadow: "0 20px 60px rgba(0,0,0,0.20)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px 10px", borderBottom: "1px solid #f3f4f6" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{label ?? "시간 선택"}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#9ca3af" }}>✕</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "16px 0 8px" }}>
          {[
            { val: manualH, setVal: setManualH, apply: (v: string) => { const h = Math.min(23, Math.max(0, parseInt(v.replace(/\D/g, "") || "0", 10))); setHour(h); setManualH(String(h).padStart(2, "0")); }, active: mode === "hour", label: "시", onFocus: () => setMode("hour") },
            { val: manualM, setVal: setManualM, apply: (v: string) => { const m = Math.min(59, Math.max(0, parseInt(v.replace(/\D/g, "") || "0", 10))); setMinute(m); setManualM(String(m).padStart(2, "0")); }, active: mode === "minute", label: "분", onFocus: () => setMode("minute") },
          ].reduce((acc, item, i, arr) => {
            acc.push(
              <div key={item.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600 }}>{item.label}</span>
                <input style={{ width: 64, height: 48, textAlign: "center", border: "none", borderRadius: 10, fontSize: 28, fontWeight: 800, outline: "none", cursor: "pointer", background: item.active ? "#111827" : "#f3f4f6", color: item.active ? "#fff" : "#111827" }}
                  value={item.val} inputMode="numeric" maxLength={2}
                  onChange={e => item.setVal(e.target.value)}
                  onBlur={e => item.apply(e.target.value)}
                  onFocus={item.onFocus} />
              </div>
            );
            if (i === 0) acc.push(<span key="colon" style={{ fontSize: 26, fontWeight: 700, color: "#d1d5db", marginTop: 16 }}>:</span>);
            return acc;
          }, [] as React.ReactNode[])}
        </div>
        <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", margin: "0 0 4px", fontWeight: 500 }}>
          {mode === "hour" ? "시를 선택하면 분으로 이동합니다" : "분을 선택하세요"}
        </p>
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 16px" }}>
          <canvas ref={canvasRef} onClick={e => interact(e.clientX, e.clientY)}
            onTouchEnd={e => { e.preventDefault(); const t = e.changedTouches[0]; if (t) interact(t.clientX, t.clientY); }}
            style={{ cursor: "pointer", borderRadius: "50%", touchAction: "none", display: "block" }} />
        </div>
        <div style={{ padding: "0 20px 20px" }}>
          <button onClick={() => { onChange(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`); onClose(); }}
            style={{ width: "100%", padding: "13px", background: "#111827", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string; }) {
  const [open, setOpen] = useState(false);
  const [hh, mm] = value.split(":");
  return (
    <>
      <div className="flex flex-col items-center gap-1.5">
        {label && <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</span>}
        <button onClick={() => setOpen(true)}
          className="min-w-[82px] rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-center text-[22px] font-black tabular-nums text-slate-900 transition active:scale-95">
          {hh}:{mm}
        </button>
      </div>
      {open && <ClockPicker value={value} onChange={v => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} label={label} />}
    </>
  );
}

const ATTENDANCE_ACTIVE: Record<Attendance, string> = {
  출석: "bg-slate-950 text-white border-slate-950",
  결석: "bg-rose-500 text-white border-rose-500",
  지각: "bg-amber-500 text-white border-amber-500",
  조퇴: "bg-violet-500 text-white border-violet-500",
};
const ATTENDANCE_INACTIVE = "bg-slate-50 text-slate-500 border-slate-200";

const SCORE_LABELS = ["매우 못함", "못함", "보통", "잘함", "매우 잘함"];

// ─── 메인 폼 ────────────────────────────────────────────────────
function WorklogForm() {
  const router = useRouter();
  const params = useSearchParams();

  const traineeId    = params.get("traineeId") ?? "";
  const attendanceId = params.get("attendanceId") ?? "";
  const traineeName  = params.get("traineeName") ?? "훈련생";
  const trainingType = (params.get("trainingType") as TrainingType) ?? "FIELD";
  const logId        = params.get("logId");  // 수정 모드일 때 존재

  const isAdaptation = trainingType === "ADAPTATION";
  const trainingLabel = trainingType === "PRE" ? "사전훈련" : trainingType === "FIELD" ? "현장훈련" : "적응지도";

  const [siteInfo, setSiteInfo] = useState<SiteInfo>({ workType: "FULL_DAY", traineeCount: 1, commuteGuidanceIncluded: false });
  const [resolvedAttendanceId, setResolvedAttendanceId] = useState(attendanceId);

  // 관리자 설정 시간 (읽기 전용)
  const [guideTimes, setGuideTimes] = useState({ start: "09:00", end: "17:00", workEnd: "18:00" }); // end=guidanceEnd(계산용), workEnd=표시용
  const [isCommuteGuide, setIsCommuteGuide] = useState(false);
  const [isBreakGuide, setIsBreakGuide] = useState(false);

  // 연장지도 (직무지도원 입력 가능)
  const [isExtraGuide, setIsExtraGuide] = useState(false);
  const [extraStart, setExtraStart] = useState("17:00");
  const [extraEnd, setExtraEnd] = useState("18:00");

  // 일지 내용
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [logDate, setLogDate] = useState(todayStr);
  const [attendance, setAttendance] = useState<Attendance>("출석");
  const [taskName, setTaskName] = useState("");
  const [taskScore, setTaskScore] = useState(3);
  const [measurementTime, setMeasurementTime] = useState("");
  const [content, setContent] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");  // 적응지도 전용

  // AI 음성
  const [isRecording, setIsRecording] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [sentenceCount, setSentenceCount] = useState(2);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loadingLog, setLoadingLog] = useState(false);

  const premium = isPremium(siteInfo.agencyPlanType, siteInfo.trialEndsAt);
  const core = diffHours(guideTimes.start, guideTimes.end);
  const extra = isExtraGuide ? diffHours(extraStart, extraEnd) : 0;
  const bonus = calcBonus(isCommuteGuide, isBreakGuide);
  const isMulti = siteInfo.traineeCount > 1;
  const totalTime = parseFloat((core + extra + bonus).toFixed(1));

  // 사이트 정보 로드
  useEffect(() => {
    fetch("/api/worker/site/current").then(r => r.json()).then(d => {
      if (d.success && d.data) {
        setSiteInfo(d.data);
        if (!attendanceId && d.data.attendanceId) setResolvedAttendanceId(d.data.attendanceId);
        const t = adminTimes(d.data.workType, d.data.customWorkStart, d.data.customWorkEnd);
        setGuideTimes(t);
        setExtraStart(t.workEnd);
        setExtraEnd(t.workEnd === "18:00" ? "19:00" : t.workEnd === "13:00" ? "14:00" : t.workEnd === "17:00" ? "18:00" : "19:00");
        const g = adminGuidance(d.data.workType, d.data.commuteGuidanceIncluded ?? false);
        setIsCommuteGuide(g.commute);
        setIsBreakGuide(g.breakTime);
        // 측정 시간 자동 입력 (수정 모드가 아닐 때만)
        if (!logId && !measurementTime) {
          const wt = d.data.workType;
          if (wt === "FULL_DAY") setMeasurementTime("8");
          else if (wt === "AM" || wt === "PM") setMeasurementTime("4");
          else if (wt === "CUSTOM" && d.data.customWorkStart && d.data.customWorkEnd) {
            const hrs = diffHours(d.data.customWorkStart, d.data.customWorkEnd);
            if (hrs > 0) setMeasurementTime(String(hrs));
          }
        }
      }
    }).catch(() => {});
  }, []);

  // 수정 모드: 기존 일지 로드
  useEffect(() => {
    if (!logId) return;
    setLoadingLog(true);
    fetch(`/api/worker/logs/${logId}`).then(r => r.json()).then(d => {
      if (d.success && d.log) {
        const l = d.log;
        setLogDate(l.workDate || todayStr);
        setAttendance((l.attendance as Attendance) || "출석");
        setTaskName(l.taskName || "");
        setTaskScore(l.taskScore || 3);
        setMeasurementTime(l.measurementTime || "");
        setContent(l.content || "");
        setSpecialNotes(l.specialNotes || "");
        // 연장지도: extTime1on1 > 0이면 체크
        if (l.extTime1on1 > 0 || l.extTimeGroup > 0) setIsExtraGuide(true);
      }
    }).catch(() => {}).finally(() => setLoadingLog(false));
  }, [logId]);

  // 임시 저장
  const draftKey = `worklog_draft_${resolvedAttendanceId || "noatt"}_${traineeId || "not"}`;
  useEffect(() => {
    if (logId) return;  // 수정 모드에서는 드래프트 무시
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setContent(saved);
    } catch {}
  }, [draftKey, logId]);
  useEffect(() => {
    if (!content || logId) return;
    try { localStorage.setItem(draftKey, content); } catch {}
  }, [content, draftKey, logId]);

  // 음성 녹음
  async function startRecording() {
    if (!premium) { alert("음성 AI 변환은 PREMIUM 기능입니다.\n에이전시 담당자에게 구독 문의해주세요."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (!chunksRef.current.length) return;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAiLoading(true);
        try {
          const form = new FormData();
          form.append("audio", blob, `rec.${mimeType.includes("mp4") ? "mp4" : "webm"}`);
          form.append("traineeName", traineeName);
          form.append("taskScore", String(taskScore));
          form.append("sentenceCount", String(sentenceCount));
          const res = await fetch("/api/worker/ai/voice-to-log", { method: "POST", body: form });
          const data = await res.json();
          if (data.success && data.content) setContent(data.content);
          else alert(data.message || "음성 변환 실패");
        } catch { alert("서버 오류"); } finally { setAiLoading(false); }
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

  async function handleSave(isComplete: boolean) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/worker/logs/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traineeId,
          attendanceId: resolvedAttendanceId,
          trainingType,
          attendance,
          time1on1: isMulti ? 0 : core + extra,
          timeGroup: isMulti ? core + extra : 0,
          extTime1on1: 0,
          extTimeGroup: 0,
          totalRecognizedTime: totalTime,
          taskName,
          taskScore,
          measurementTime,
          specialNotes: isAdaptation ? specialNotes : "",
          content,
          isCompleted: isComplete,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "저장 실패"); return; }
      try { localStorage.removeItem(draftKey); } catch {}
      setSaved(true);
      setTimeout(() => router.back(), 1200);
    } catch { setError("서버와 연결할 수 없습니다."); } finally { setSaving(false); }
  }

  if (loadingLog) {
    return <div className="flex min-h-dvh items-center justify-center bg-slate-50">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
    </div>;
  }

  if (saved) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 p-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100">
          <CheckCircle2 className="h-9 w-9 text-emerald-500" />
        </div>
        <p className="text-lg font-black text-emerald-600">일지가 저장되었습니다.</p>
        <div className="mt-2 flex gap-3">
          <button onClick={() => router.push("/worker/home")}
            className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white">
            <Home className="h-4 w-4" /> 홈으로
          </button>
          <button onClick={() => router.push("/worker/logs")}
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700">
            <CalendarDays className="h-4 w-4" /> 일지 목록
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-base font-black text-slate-900">
            {isAdaptation ? "적응지도 일지" : `훈련 일지`}
          </span>
          <span className="text-xs font-semibold text-slate-400">{traineeName}</span>
        </div>
        <button onClick={() => handleSave(true)} disabled={saving}
          className="rounded-xl bg-slate-950 px-3 py-1.5 text-sm font-black text-white transition active:scale-95 disabled:opacity-60">
          {saving ? "저장중" : logId ? "수정 완료" : "완료"}
        </button>
      </header>

      <div className="mx-auto max-w-md space-y-3 px-4 py-3 pb-10">

        {/* 훈련 구분 배지 (훈련일지만) */}
        {!isAdaptation && (
          <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5">
            <Info className="h-4 w-4 flex-shrink-0 text-sky-500" />
            <span className="text-xs font-black text-sky-700">
              {trainingLabel} · {isMulti ? "1:多" : "1:1"} · {siteInfo.traineeCount}명
            </span>
          </div>
        )}

        {/* 날짜 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-slate-700">날짜</span>
            <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
          </div>
        </div>

        {/* 출결 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">출결</p>
          <div className="flex gap-2">
            {(["출석", "결석", "지각", "조퇴"] as Attendance[]).map(a => (
              <button key={a} onClick={() => setAttendance(a)}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-black transition active:scale-95 ${attendance === a ? ATTENDANCE_ACTIVE[a] : ATTENDANCE_INACTIVE}`}>
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* ── 훈련 시간 / 근무 시간 (관리자 설정, 잠금) ── */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-black text-slate-700">
              {isAdaptation ? "근무 시간" : "훈련 시간"}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">관리자 설정</span>
          </div>

          {/* 시간 표시 (잠금) — 적응지도는 실제 퇴근시간(workEnd) 표시 */}
          <div className="mb-4 flex items-center justify-center gap-4">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">시작</span>
              <span className="rounded-xl bg-slate-100 px-4 py-2.5 text-[22px] font-black tabular-nums text-slate-500">{guideTimes.start}</span>
            </div>
            <span className="mt-4 text-lg font-light text-slate-300">—</span>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">종료</span>
              <span className="rounded-xl bg-slate-100 px-4 py-2.5 text-[22px] font-black tabular-nums text-slate-500">
                {isAdaptation ? guideTimes.workEnd : guideTimes.end}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">시간</span>
              <span className="rounded-xl bg-slate-950 px-4 py-2.5 text-[22px] font-black tabular-nums text-white">{core}H</span>
            </div>
          </div>

          {/* 지도 여부 체크박스 */}
          <div className="mt-1 flex flex-wrap gap-4 border-t border-slate-100 pt-4">
            {isAdaptation ? (
              /* 적응지도: 통합 1개 */
              <label className="flex cursor-not-allowed items-center gap-2 opacity-60">
                <input type="checkbox" checked={isCommuteGuide || isBreakGuide} disabled className="h-4 w-4 accent-slate-950" />
                <span className="text-sm font-semibold text-slate-700">출퇴근 지도 및 휴게시간 지도 여부 (관리자 설정)</span>
              </label>
            ) : (
              /* 훈련일지: 분리 2개 */
              <>
                <label className="flex cursor-not-allowed items-center gap-2 opacity-60">
                  <input type="checkbox" checked={isCommuteGuide} disabled className="h-4 w-4 accent-slate-950" />
                  <span className="text-sm font-semibold text-slate-700">출퇴근 지도 (관리자 설정)</span>
                </label>
                <label className="flex cursor-not-allowed items-center gap-2 opacity-60">
                  <input type="checkbox" checked={isBreakGuide} disabled className="h-4 w-4 accent-slate-950" />
                  <span className="text-sm font-semibold text-slate-700">지도 및 휴게시간 지도 여부 (관리자 설정)</span>
                </label>
              </>
            )}
            {/* 연장지도: 직무지도원 입력 */}
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={isExtraGuide} onChange={e => setIsExtraGuide(e.target.checked)} className="h-4 w-4 accent-slate-950" />
              <span className="text-sm font-semibold text-slate-700">연장 지도</span>
            </label>
          </div>

          {/* 연장 시간 입력 */}
          {isExtraGuide && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-black text-rose-600">연장 시간</span>
                <span className="text-lg font-black tabular-nums text-rose-600">{extra}H</span>
              </div>
              <div className="flex items-center justify-center gap-5">
                <TimeInput value={extraStart} onChange={setExtraStart} label="시작" />
                <span className="mt-4 text-lg font-light text-slate-300">—</span>
                <TimeInput value={extraEnd} onChange={setExtraEnd} label="종료" />
              </div>
            </div>
          )}
        </div>

        {/* ── 수행 과제 ── */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">수행 과제</p>
          <input type="text" value={taskName} onChange={e => setTaskName(e.target.value)}
            placeholder={isAdaptation ? "수행한 직무·과제 내용을 입력하세요" : "수행한 과제명을 입력하세요"}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100" />
        </div>

        {/* ── 수행정도 + 측정시간 ── */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">수행 정도</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" onClick={() => setTaskScore(n)}
                className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-2.5 transition active:scale-95 ${taskScore === n ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                <span className="text-base font-black">{n}</span>
                <span className="text-center text-[9px] font-semibold leading-tight">{SCORE_LABELS[n - 1]}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">측정 시간</span>
            <div className="relative flex-1">
              <input type="number" min="0" step="0.5" value={measurementTime}
                onChange={e => setMeasurementTime(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 pr-8 text-sm font-semibold text-slate-700 outline-none focus:border-sky-400 focus:bg-white" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">H</span>
            </div>
          </div>
        </div>

        {/* ── 지도사항 / 평가 및 지도사항 ── */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-black text-slate-700">
              {isAdaptation ? "지도사항" : "평가 및 지도사항"}
            </span>
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-xl border border-slate-200">
                {[2, 3, 4].map(n => (
                  <button key={n} type="button" onClick={() => setSentenceCount(n)}
                    className={`px-2.5 py-1.5 text-xs font-black transition ${sentenceCount === n ? "bg-slate-950 text-white" : "bg-white text-slate-400"}`}>
                    {n}문
                  </button>
                ))}
              </div>
              <button type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={aiLoading}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-white transition active:scale-95 disabled:opacity-70 ${isRecording ? "bg-rose-500" : "bg-slate-950"}`}>
                {aiLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />AI 변환 중...</>
                  : isRecording ? <><Square className="h-3.5 w-3.5" />중지</>
                  : <><Mic className="h-3.5 w-3.5" />음성입력</>}
                {!premium && <span className="ml-1 rounded bg-white/20 px-1 py-px text-[9px] font-black">PRO</span>}
              </button>
            </div>
          </div>
          {isRecording && (
            <div className="mb-2 flex items-center gap-2 py-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
              <span className="text-xs font-black text-rose-600">녹음 중 {recordingSec}초</span>
            </div>
          )}
          <textarea
            value={content} onChange={e => setContent(e.target.value)}
            placeholder={isAdaptation ? "지도사항을 입력하세요" : "평가 및 지도사항을 입력하세요"}
            className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-relaxed text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
            rows={5} />
        </div>

        {/* ── 특이사항 (적응지도 전용) ── */}
        {isAdaptation && (
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-3 text-sm font-black text-slate-700">특이사항</p>
            <textarea
              value={specialNotes} onChange={e => setSpecialNotes(e.target.value)}
              placeholder="특이사항을 입력하세요 (선택)"
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-relaxed text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              rows={3} />
          </div>
        )}

        {/* ── 공단 인정 시간 요약 ── */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">공단 인정 시간</p>
          {[
            { label: isMulti ? "1:多 지도 시간" : "1:1 지도 시간", value: `${(core + extra).toFixed(1)} H`, red: false },
            { label: "출퇴근/휴게 인정",  value: `${bonus.toFixed(1)} H`,          red: false },
            { label: "연장 지도",         value: `${extra.toFixed(1)} H`,          red: true  },
          ].map(row => (
            <div key={row.label} className="mb-2 flex justify-between">
              <span className={`text-sm font-semibold ${row.red ? "text-rose-500" : "text-slate-500"}`}>{row.label}</span>
              <span className={`text-sm font-black tabular-nums ${row.red ? "text-rose-500" : "text-slate-800"}`}>{row.value}</span>
            </div>
          ))}
          <div className="my-2.5 h-px bg-slate-100" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-slate-900">합계</span>
            <span className="text-xl font-black tabular-nums text-slate-900">{totalTime.toFixed(1)} H</span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center text-sm font-semibold text-rose-700">{error}</div>
        )}

        <button onClick={() => handleSave(false)} disabled={saving}
          className="min-h-12 w-full rounded-2xl bg-slate-700 text-base font-black text-white transition active:scale-[0.97] disabled:opacity-70">
          임시저장
        </button>
      </div>
    </div>
  );
}

export default function WorklogPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm font-semibold text-slate-400">로딩 중...</div>}>
      <WorklogForm />
    </Suspense>
  );
}
