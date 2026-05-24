"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Home,
  Info,
  Loader2,
  Mic,
  Square,
} from "lucide-react";

// ─── 타입 ─────────────────────────────────────────────────
type Attendance = "출석" | "결석" | "지각" | "조퇴";
type TrainingType = "PRE" | "FIELD" | "ADAPTATION";

interface SiteInfo {
  workType: string;
  traineeCount: number;
  /** 출퇴근 지도 포함 여부 — 관리자 설정값, 직무지도원 변경 불가 */
  commuteGuidanceIncluded: boolean;
  agencyPlanType?: string;
  trialEndsAt?: string | null;
}

// ─── 시간 계산 ─────────────────────────────────────────────
function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function diffHours(start: string, end: string): number {
  const diff = parseHHMM(end) - parseHHMM(start);
  return Math.max(0, Math.round(diff / 6) / 10);
}
function calcRecognized(params: {
  core: number; extra: number; bonus: number;
}): { oneOnOne: number; multiOnOne: number; total: number } {
  const { core, extra, bonus } = params;
  return {
    oneOnOne: core + extra,
    multiOnOne: 0,
    total: parseFloat((core + extra + bonus).toFixed(1)),
  };
}

// ─── PREMIUM 체크 ─────────────────────────────────────────
function isPremium(plan?: string, trialEndsAt?: string | null): boolean {
  if (!plan || plan === "FREE") return false;
  if (plan === "TRIAL") return trialEndsAt ? new Date(trialEndsAt) > new Date() : false;
  return ["STARTER", "STANDARD", "PRO"].includes(plan);
}

// ─── workType → 기본 시간 파생 ───────────────────────────────
function defaultTimes(workType: string, customStart?: string | null, customEnd?: string | null): { workStart: string; workEnd: string; trainStart: string; trainEnd: string } {
  if (workType === "AM") return { workStart: "09:00", workEnd: "12:00", trainStart: "09:00", trainEnd: "12:00" };
  if (workType === "PM") return { workStart: "13:00", workEnd: "17:00", trainStart: "13:00", trainEnd: "17:00" };
  if (workType === "CUSTOM" && customStart && customEnd) {
    return { workStart: customStart, workEnd: customEnd, trainStart: customStart, trainEnd: customEnd };
  }
  return { workStart: "09:00", workEnd: "18:00", trainStart: "09:00", trainEnd: "17:00" };
}

// 근무형태별 출퇴근/휴게 지도 기본값 계산
function resolveGuidance(workType: string, commuteGuidanceIncluded: boolean): { commute: boolean; breakTime: boolean } {
  if (workType === "FULL_DAY") return { commute: false, breakTime: false };
  return { commute: commuteGuidanceIncluded, breakTime: true };
}

// ─── 시계 다이얼 피커 ────────────────────────────────────
function ClockPicker({ value, onChange, onClose, label }: {
  value: string; onChange: (v: string) => void; onClose: () => void; label?: string;
}) {
  const [hStr, mStr] = value.split(":");
  const [mode, setMode]     = useState<"hour" | "minute">("hour");
  const [hour, setHour]     = useState(parseInt(hStr ?? "9", 10));
  const [minute, setMinute] = useState(parseInt(mStr ?? "0", 10));
  const [manualH, setManualH] = useState(String(parseInt(hStr ?? "9", 10)).padStart(2, "0"));
  const [manualM, setManualM] = useState(String(parseInt(mStr ?? "0", 10)).padStart(2, "0"));

  const SIZE = 240;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R_OUTER = 95;
  const R_INNER = 60;
  const HAND_OUTER = 80;
  const HAND_INNER = 48;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width  = SIZE + "px";
    canvas.style.height = SIZE + "px";
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = "#f3f4f6";
    ctx.beginPath();
    ctx.arc(CX, CY, SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.fill();

    if (mode === "hour") {
      const outer = Array.from({length:12}, (_, i) => ({ val: i===0?12:i, idx:i }));
      const inner = Array.from({length:12}, (_, i) => ({ val: i===0?0:i+12, idx:i }));
      const isOuter = hour >= 1 && hour <= 12;
      const selIdx  = isOuter ? (hour===12?0:hour) : (hour===0?0:hour-12);
      const handR   = isOuter ? HAND_OUTER : HAND_INNER;
      const ang     = (selIdx/12)*Math.PI*2 - Math.PI/2;
      const hx = CX + Math.cos(ang)*handR;
      const hy = CY + Math.sin(ang)*handR;

      ctx.strokeStyle="#111827"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(hx,hy); ctx.stroke();
      ctx.fillStyle="#111827";
      ctx.beginPath(); ctx.arc(CX,CY,5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx,hy,20,0,Math.PI*2); ctx.fill();

      outer.forEach(({val,idx}) => {
        const a=(idx/12)*Math.PI*2-Math.PI/2;
        const nx=CX+Math.cos(a)*R_OUTER, ny=CY+Math.sin(a)*R_OUTER;
        const sel=isOuter&&idx===selIdx;
        ctx.font=`${sel?"700":"400"} 15px -apple-system,sans-serif`;
        ctx.fillStyle=sel?"#fff":"#374151";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(String(val),nx,ny);
      });

      inner.forEach(({val,idx}) => {
        const a=(idx/12)*Math.PI*2-Math.PI/2;
        const nx=CX+Math.cos(a)*R_INNER, ny=CY+Math.sin(a)*R_INNER;
        const sel=!isOuter&&idx===selIdx;
        if(sel){ ctx.fillStyle="#111827"; ctx.beginPath(); ctx.arc(nx,ny,15,0,Math.PI*2); ctx.fill(); }
        ctx.font=`${sel?"700":"400"} 11px -apple-system,sans-serif`;
        ctx.fillStyle=sel?"#fff":"#9ca3af";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(String(val),nx,ny);
      });

    } else {
      const mins=Array.from({length:12},(_,i)=>i*5);
      const selIdx=Math.round(minute/5)%12;
      const ang=(selIdx/12)*Math.PI*2-Math.PI/2;
      const hx=CX+Math.cos(ang)*HAND_OUTER;
      const hy=CY+Math.sin(ang)*HAND_OUTER;

      ctx.strokeStyle="#111827"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(hx,hy); ctx.stroke();
      ctx.fillStyle="#111827";
      ctx.beginPath(); ctx.arc(CX,CY,5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx,hy,20,0,Math.PI*2); ctx.fill();

      mins.forEach((val,i) => {
        const a=(i/12)*Math.PI*2-Math.PI/2;
        const nx=CX+Math.cos(a)*R_OUTER, ny=CY+Math.sin(a)*R_OUTER;
        const sel=i===selIdx;
        ctx.font=`${sel?"700":"400"} 14px -apple-system,sans-serif`;
        ctx.fillStyle=sel?"#fff":"#374151";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(String(val).padStart(2,"0"),nx,ny);
      });

      if(minute%5!==0){
        ctx.font="600 14px -apple-system,sans-serif";
        ctx.fillStyle="#6b7280";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(String(minute).padStart(2,"0"),CX,CY);
      }
    }
  }

  useEffect(()=>{ draw(); }, [mode, hour, minute]);

  function interact(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - rect.left - CX;
    const dy = clientY - rect.top  - CY;
    const dist = Math.sqrt(dx*dx+dy*dy);
    if (dist < 15) return;

    let angle = Math.atan2(dy,dx)+Math.PI/2;
    if(angle<0) angle+=Math.PI*2;
    const idx = Math.round(angle/(Math.PI*2/12))%12;

    if(mode==="hour"){
      const h = dist<72 ? (idx===0?0:idx+12) : (idx===0?12:idx);
      setHour(h); setManualH(String(h).padStart(2,"0"));
      setTimeout(()=>setMode("minute"), 200);
    } else {
      const m = idx*5;
      setMinute(m); setManualM(String(m).padStart(2,"0"));
    }
  }

  function applyH(v:string){ const h=Math.min(23,Math.max(0,parseInt(v.replace(/\D/g,"")||"0",10))); setHour(h); setManualH(String(h).padStart(2,"0")); }
  function applyM(v:string){ const m=Math.min(59,Math.max(0,parseInt(v.replace(/\D/g,"")||"0",10))); setMinute(m); setManualM(String(m).padStart(2,"0")); }

  return (
    <div style={cp.overlay} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={cp.modal}>
        <div style={cp.header}>
          <span style={cp.title}>{label??"시간 선택"}</span>
          <button onClick={onClose} style={cp.closeBtn}>✕</button>
        </div>

        <div style={cp.display}>
          <div style={cp.digitWrap}>
            <span style={cp.unit}>시</span>
            <input
              style={{...cp.digit, background:mode==="hour"?"#111827":"#f3f4f6", color:mode==="hour"?"#fff":"#111827"}}
              value={manualH} inputMode="numeric" maxLength={2}
              onChange={e=>setManualH(e.target.value)}
              onBlur={e=>applyH(e.target.value)}
              onFocus={()=>setMode("hour")}
            />
          </div>
          <span style={cp.colon}>:</span>
          <div style={cp.digitWrap}>
            <span style={cp.unit}>분</span>
            <input
              style={{...cp.digit, background:mode==="minute"?"#111827":"#f3f4f6", color:mode==="minute"?"#fff":"#111827"}}
              value={manualM} inputMode="numeric" maxLength={2}
              onChange={e=>setManualM(e.target.value)}
              onBlur={e=>applyM(e.target.value)}
              onFocus={()=>setMode("minute")}
            />
          </div>
        </div>

        <p style={cp.hint}>
          {mode==="hour" ? "시를 선택하면 분으로 이동합니다" : "분을 선택하세요"}
        </p>

        <div style={{display:"flex",justifyContent:"center",padding:"4px 0 16px"}}>
          <canvas
            ref={canvasRef}
            onClick={e=>interact(e.clientX,e.clientY)}
            onTouchEnd={e=>{e.preventDefault(); const t=e.changedTouches[0]; if(t)interact(t.clientX,t.clientY);}}
            style={{cursor:"pointer",borderRadius:"50%",touchAction:"none",display:"block"}}
          />
        </div>

        <div style={{padding:"0 20px 20px"}}>
          <button
            onClick={()=>{onChange(`${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`);onClose();}}
            style={cp.confirm}
          >확인</button>
        </div>
      </div>
    </div>
  );
}

// cp 스타일 객체: 캔버스 좌표 계산에 사용되므로 유지
const cp: Record<string, React.CSSProperties> = {
  overlay:   {position:"fixed",inset:0,background:"rgba(0,0,0,0.50)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  modal:     {background:"#fff",borderRadius:20,width:"100%",maxWidth:320,boxShadow:"0 20px 60px rgba(0,0,0,0.20)"},
  header:    {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 18px 10px",borderBottom:"1px solid #f3f4f6"},
  title:     {fontSize:15,fontWeight:700,color:"#111827"},
  closeBtn:  {background:"none",border:"none",fontSize:18,cursor:"pointer",color:"#9ca3af",lineHeight:1},
  display:   {display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"16px 0 8px"},
  digitWrap: {display:"flex",flexDirection:"column" as const,alignItems:"center",gap:3},
  unit:      {fontSize:10,color:"#9ca3af",fontWeight:600,letterSpacing:"0.5px"},
  digit:     {width:64,height:48,textAlign:"center" as const,border:"none",borderRadius:10,fontSize:28,fontWeight:800,outline:"none",cursor:"pointer",fontVariantNumeric:"tabular-nums",transition:"background 0.15s,color 0.15s"},
  colon:     {fontSize:26,fontWeight:700,color:"#d1d5db",marginTop:16},
  hint:      {textAlign:"center" as const,fontSize:11,color:"#9ca3af",margin:"0 0 4px",fontWeight:500},
  confirm:   {width:"100%",padding:"13px",background:"#111827",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer"},
};

// ─── 시간 버튼 (탭 → 시계 피커) ─────────────────────────
function TimeInput({ value, onChange, label }: {
  value: string; onChange: (v: string) => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hh, mm] = value.split(":");
  return (
    <>
      <div className="flex flex-col items-center gap-1.5">
        {label && (
          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</span>
        )}
        <button
          onClick={() => setOpen(true)}
          className="min-w-[82px] rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-center text-[22px] font-black tabular-nums text-slate-900 transition active:scale-95"
        >
          {hh}:{mm}
        </button>
      </div>
      {open && (
        <ClockPicker value={value} onChange={v => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} label={label} />
      )}
    </>
  );
}

// ─── 출결 색상 ─────────────────────────────────────────
const ATTENDANCE_ACTIVE: Record<Attendance, string> = {
  출석: "bg-slate-950 text-white border-slate-950",
  결석: "bg-rose-500 text-white border-rose-500",
  지각: "bg-amber-500 text-white border-amber-500",
  조퇴: "bg-violet-500 text-white border-violet-500",
};
const ATTENDANCE_INACTIVE = "bg-slate-50 text-slate-500 border-slate-200";

// ─── 메인 컴포넌트 ─────────────────────────────────────────
function WorklogForm() {
  const router = useRouter();
  const params = useSearchParams();
  const traineeId = params.get("traineeId") ?? "";
  const attendanceId = params.get("attendanceId") ?? "";
  const traineeName = params.get("traineeName") ?? "훈련생";
  const trainingType: TrainingType = (params.get("trainingType") as TrainingType) ?? "FIELD";

  const [siteInfo, setSiteInfo] = useState<SiteInfo>({
    workType: "FULL_DAY", traineeCount: 1, commuteGuidanceIncluded: false,
  });

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [logDate, setLogDate] = useState(todayStr);
  const [attendance, setAttendance] = useState<Attendance>("출석");
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [trainStart, setTrainStart] = useState("09:00");
  const [trainEnd, setTrainEnd] = useState("17:00");
  const [isCommuteGuide, setIsCommuteGuide] = useState(false);
  const [isBreakGuide, setIsBreakGuide] = useState(false);
  const [isExtraGuide, setIsExtraGuide] = useState(false);
  const [extraStart, setExtraStart] = useState("17:00");
  const [extraEnd, setExtraEnd] = useState("18:00");
  const [taskScore, setTaskScore] = useState(3);
  const [completionRate, setCompletionRate] = useState(3);
  const [content, setContent] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const draftKey = `worklog_draft_${attendanceId || "noatt"}_${traineeId || "not"}`;
  const [draftRestored, setDraftRestored] = useState(false);

  const premium = isPremium(siteInfo.agencyPlanType, siteInfo.trialEndsAt);

  const [resolvedAttendanceId, setResolvedAttendanceId] = useState(attendanceId);

  useEffect(() => {
    fetch("/api/worker/site/current")
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setSiteInfo(d.data);
          if (!attendanceId && d.data.attendanceId) {
            setResolvedAttendanceId(d.data.attendanceId);
          }
          const times = defaultTimes(d.data.workType ?? "FULL_DAY", d.data.customWorkStart, d.data.customWorkEnd);
          setWorkStart(times.workStart);
          setWorkEnd(times.workEnd);
          setTrainStart(times.trainStart);
          setTrainEnd(times.trainEnd);
          setExtraStart(times.workEnd);
          setExtraEnd(
            times.workEnd === "18:00" ? "19:00" :
            times.workEnd === "13:00" ? "14:00" :
            times.workEnd === "17:00" ? "18:00" : "19:00"
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const { commute, breakTime } = resolveGuidance(siteInfo.workType, siteInfo.commuteGuidanceIncluded);
    setIsCommuteGuide(commute);
    setIsBreakGuide(breakTime);
  }, [siteInfo.workType, siteInfo.commuteGuidanceIncluded]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) { setContent(saved); setDraftRestored(true); }
    } catch {}
  }, [draftKey]);

  useEffect(() => {
    if (!content) return;
    try { localStorage.setItem(draftKey, content); } catch {}
  }, [content, draftKey]);

  const core = diffHours(trainStart, trainEnd);
  const extra = isExtraGuide ? diffHours(extraStart, extraEnd) : 0;
  const bonus = (isCommuteGuide || isBreakGuide) ? 1.5 : 0;
  const isMulti = siteInfo.traineeCount > 1;
  const recognized = calcRecognized({ core, extra, bonus });

  async function startRecording() {
    if (!premium) {
      alert("음성 AI 변환은 PREMIUM 기능입니다.\n에이전시 담당자에게 구독 문의해주세요.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await sendAudioToGroq(blob, mimeType);
      };
      recorder.start(500);
      mediaRef.current = recorder;
      setIsRecording(true);
      setRecordingSec(0);
      recordingTimerRef.current = setInterval(() => { setRecordingSec(s => s + 1); }, 1000);
    } catch {
      alert("마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setIsRecording(false);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setRecordingSec(0);
  }

  async function sendAudioToGroq(blob: Blob, mimeType: string) {
    setAiLoading(true);
    try {
      const formData = new FormData();
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      formData.append("audio", blob, `recording.${ext}`);
      formData.append("traineeName", traineeName);
      formData.append("taskScore", String(taskScore));
      const res = await fetch("/api/worker/ai/voice-to-log", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.content) {
        setContent(data.content);
      } else {
        setContent("");
        alert(data.message || "음성 변환에 실패했습니다. 다시 시도해주세요.");
      }
    } catch {
      setContent("");
      alert("서버와 연결할 수 없습니다.");
    } finally {
      setAiLoading(false);
    }
  }

  async function loadPrevContent() {
    try {
      const res = await fetch(`/api/worker/logs/prev?traineeId=${traineeId}`);
      const data = await res.json();
      if (data.success && data.content) { setContent(data.content); }
      else { alert("이전 일지 내용이 없습니다."); }
    } catch { alert("불러오기에 실패했습니다."); }
  }

  async function handleSave(isComplete: boolean) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/worker/logs/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traineeId, attendanceId: resolvedAttendanceId, trainingType, attendance,
          trainStartTime: trainStart, trainEndTime: trainEnd,
          isCommuteGuide, isBreakGuide, isExtraGuide,
          extraStartTime: isExtraGuide ? extraStart : null,
          extraEndTime: isExtraGuide ? extraEnd : null,
          time1on1: isMulti ? 0 : core + extra,
          timeGroup: isMulti ? core + extra : 0,
          extTime1on1: 0, extTimeGroup: 0,
          totalRecognizedTime: recognized.total,
          taskScore, completionRate, content,
          isCompleted: isComplete,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "저장 실패"); return; }
      try { localStorage.removeItem(draftKey); } catch {}
      setSaved(true);
      setTimeout(() => router.back(), 1200);
    } catch {
      setError("서버와 연결할 수 없습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 p-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100">
          <CheckCircle2 className="h-9 w-9 text-emerald-500" aria-hidden="true" />
        </div>
        <p className="text-lg font-black text-emerald-600">일지가 저장되었습니다.</p>
        <div className="mt-2 flex gap-3">
          <button
            onClick={() => router.push("/worker/home")}
            className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white"
          >
            <Home className="h-4 w-4" aria-hidden="true" /> 홈으로
          </button>
          <button
            onClick={() => router.push("/worker/calendar")}
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" /> 캘린더
          </button>
        </div>
      </div>
    );
  }

  const ATTENDANCE_OPTIONS: Attendance[] = ["출석", "결석", "지각", "조퇴"];

  const RATING_TASK_LABELS = ["매우 못함", "못함", "보통", "잘함", "매우 잘함"];
  const RATING_RATE_LABELS = ["25%↓", "25%↑", "50%↑", "75%↑", "100%"];

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-base font-black text-slate-900">
            {trainingType === "ADAPTATION" ? "적응지도 일지" : "훈련 일지"}
          </span>
          <span className="text-xs font-semibold text-slate-400">{traineeName} 훈련생</span>
        </div>
        <button
          onClick={() => handleSave(true)}
          disabled={saving}
          className="rounded-xl bg-slate-950 px-3 py-1.5 text-sm font-black text-white transition active:scale-95 disabled:opacity-60"
        >
          {saving ? "저장중" : "완료"}
        </button>
      </header>

      <div className="mx-auto max-w-md space-y-3 px-4 py-3 pb-10">

        {/* 날짜 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-slate-700">날짜</span>
            <input
              type="date"
              value={logDate}
              onChange={e => setLogDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
            />
          </div>
        </div>

        {/* 현장 유형 배지 */}
        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5">
          <Info className="h-4 w-4 flex-shrink-0 text-sky-500" aria-hidden="true" />
          <span className="text-xs font-black text-sky-700">
            {isMulti ? "1:多" : "1:1"} 지도 현장 &nbsp;·&nbsp; {siteInfo.traineeCount}명 &nbsp;·&nbsp; {siteInfo.workType}
          </span>
        </div>

        {/* 출결 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">출결</p>
          <div className="flex gap-2">
            {ATTENDANCE_OPTIONS.map(a => (
              <button
                key={a}
                onClick={() => setAttendance(a)}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-black transition active:scale-95 ${
                  attendance === a ? ATTENDANCE_ACTIVE[a] : ATTENDANCE_INACTIVE
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* 근무 시간 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-black text-slate-700">근무 시간</span>
            <span className="text-xl font-black tabular-nums text-slate-900">{diffHours(workStart, workEnd)}H</span>
          </div>
          <div className="flex items-center justify-center gap-5">
            <TimeInput value={workStart} onChange={setWorkStart} label="시작" />
            <span className="mt-4 text-lg font-light text-slate-300">—</span>
            <TimeInput value={workEnd} onChange={setWorkEnd} label="종료" />
          </div>
        </div>

        {/* 훈련 시간 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-black text-slate-700">훈련 시간</span>
            <span className="text-xl font-black tabular-nums text-slate-900">{core}H</span>
          </div>
          <div className="flex items-center justify-center gap-5">
            <TimeInput value={trainStart} onChange={setTrainStart} label="시작" />
            <span className="mt-4 text-lg font-light text-slate-300">—</span>
            <TimeInput value={trainEnd} onChange={setTrainEnd} label="종료" />
          </div>

          {/* 체크박스 */}
          <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-100 pt-4">
            {(() => {
              const { commute: fixedCommute, breakTime: fixedBreak } = resolveGuidance(siteInfo.workType, siteInfo.commuteGuidanceIncluded);
              const isFullDay = siteInfo.workType === "FULL_DAY";
              return [
                { label: "출퇴근 지도", val: isCommuteGuide, set: setIsCommuteGuide, fixed: true, adminSet: fixedCommute },
                { label: "휴게시간 지도", val: isBreakGuide, set: setIsBreakGuide, fixed: true, adminSet: fixedBreak },
                { label: "연장 지도", val: isExtraGuide, set: setIsExtraGuide, fixed: isFullDay, adminSet: false },
              ].map(({ label, val, set, fixed, adminSet }) => (
                <label key={label} className={`flex cursor-pointer items-center gap-2 ${fixed ? "opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    checked={fixed ? adminSet : val}
                    onChange={e => !fixed && set(e.target.checked)}
                    disabled={fixed}
                    className="h-4 w-4 accent-slate-950"
                    style={{ cursor: fixed ? "not-allowed" : "pointer" }}
                  />
                  <span className="text-sm font-semibold text-slate-700">
                    {label}{fixed ? " (관리자 설정)" : ""}
                  </span>
                </label>
              ));
            })()}
          </div>

          {/* 연장 시간 */}
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

        {/* 평가 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-4">
            <p className="mb-3 text-sm font-black text-slate-700">과제 수행 평가</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTaskScore(n)}
                  className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-2.5 transition active:scale-95 ${
                    taskScore === n
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  }`}
                >
                  <span className="text-base font-black">{n}</span>
                  <span className="text-center text-[9px] font-semibold leading-tight">{RATING_TASK_LABELS[n - 1]}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-black text-slate-700">과제 수행률</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCompletionRate(n)}
                  className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-2.5 transition active:scale-95 ${
                    completionRate === n
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  }`}
                >
                  <span className="text-base font-black">{n}</span>
                  <span className="text-center text-[9px] font-semibold leading-tight">{RATING_RATE_LABELS[n - 1]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 지도 내용 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-black text-slate-700">지도 내용</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={aiLoading}
                className={`relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-white transition active:scale-95 disabled:opacity-70 ${
                  isRecording ? "bg-rose-500" : "bg-slate-950"
                }`}
              >
                {aiLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> AI 변환 중...</>
                ) : isRecording ? (
                  <><Square className="h-3.5 w-3.5" aria-hidden="true" /> 중지</>
                ) : (
                  <><Mic className="h-3.5 w-3.5" aria-hidden="true" /> 음성입력</>
                )}
                {!premium && (
                  <span className="ml-1 rounded bg-white/20 px-1 py-px text-[9px] font-black">PRO</span>
                )}
              </button>
              <button
                type="button"
                onClick={loadPrevContent}
                className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 transition active:scale-95"
              >
                전일내용
              </button>
            </div>
          </div>

          {isRecording && (
            <div className="mb-2 flex items-center gap-2 py-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
              <span className="text-xs font-black text-rose-600">
                녹음 중 {recordingSec}초 — 중지하려면 다시 누르세요
              </span>
            </div>
          )}
          {aiLoading && (
            <div className="mb-2 py-2">
              <span className="text-xs font-semibold text-slate-500">AI가 일지를 작성 중입니다...</span>
            </div>
          )}

          {draftRestored && (
            <div className="mb-2 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <span className="text-xs font-semibold text-amber-600">이전에 작성 중이던 내용을 불러왔습니다.</span>
              <button
                onClick={() => { setContent(""); setDraftRestored(false); try { localStorage.removeItem(draftKey); } catch {} }}
                className="text-xs font-semibold text-slate-400 transition hover:text-slate-600"
              >
                지우기
              </button>
            </div>
          )}

          <textarea
            className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-relaxed text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
            placeholder="지도 내용을 입력하세요."
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={5}
          />
        </div>

        {/* 공단 인정 시간 요약 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-3 text-sm font-black text-slate-700">공단 인정 시간</p>
          {[
            { label: "1:1 지도 시간",   value: `${isMulti ? "0.0" : (core + extra).toFixed(1)} H`, red: false },
            { label: "1:多 지도 시간",  value: `${isMulti ? (core + extra).toFixed(1) : "0.0"} H`, red: false },
            { label: "1:1 연장 지도",   value: `${!isMulti && isExtraGuide ? extra.toFixed(1) : "0.0"} H`, red: true },
            { label: "1:多 연장 지도",  value: `${isMulti && isExtraGuide ? extra.toFixed(1) : "0.0"} H`, red: true },
            { label: "출퇴근/휴게 인정", value: `${bonus.toFixed(1)} H`, red: false },
          ].map(row => (
            <div key={row.label} className="mb-2 flex justify-between">
              <span className={`text-sm font-semibold ${row.red ? "text-rose-500" : "text-slate-500"}`}>{row.label}</span>
              <span className={`text-sm font-black tabular-nums ${row.red ? "text-rose-500" : "text-slate-800"}`}>{row.value}</span>
            </div>
          ))}
          <div className="my-2.5 h-px bg-slate-100" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-slate-900">합계</span>
            <span className="text-xl font-black tabular-nums text-slate-900">{recognized.total.toFixed(1)} H</span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {/* 임시저장 */}
        <button
          onClick={() => handleSave(false)}
          disabled={saving}
          className="min-h-12 w-full rounded-2xl bg-slate-700 text-base font-black text-white transition active:scale-[0.97] disabled:opacity-70"
        >
          임시저장
        </button>

      </div>
    </div>
  );
}

export default function WorklogPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm font-semibold text-slate-400">
        로딩 중...
      </div>
    }>
      <WorklogForm />
    </Suspense>
  );
}
