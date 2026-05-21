"use client";
// app/worker/worklog/page.tsx
// 업무일지 작성 — Phase 2 UX 개선

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── 타입 ─────────────────────────────────────────────────
type Attendance = "출석" | "결석" | "지각" | "조퇴";
type TrainingType = "PRE" | "FIELD" | "ADAPTATION";

interface SiteInfo {
  workType: string;
  traineeCount: number;
  isExtraTime: boolean;
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
function defaultTimes(workType: string): { workStart: string; workEnd: string; trainStart: string; trainEnd: string } {
  if (workType.includes("오전") || workType.includes("AM")) {
    return { workStart: "09:00", workEnd: "13:00", trainStart: "09:00", trainEnd: "13:00" };
  }
  if (workType.includes("오후") || workType.includes("PM")) {
    return { workStart: "13:00", workEnd: "17:00", trainStart: "13:00", trainEnd: "17:00" };
  }
  // 전일(8H) 기본
  return { workStart: "09:00", workEnd: "18:00", trainStart: "09:00", trainEnd: "17:00" };
}

// ─── 시계 다이얼 피커 ────────────────────────────────────
// iOS/안드로이드 기본 시계 선택 UI와 동일한 방식:
// 시 선택 → 자동으로 분 선택으로 전환, 모두 동일한 원형 다이얼

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

    // 배경 원
    ctx.fillStyle = "#f3f4f6";
    ctx.beginPath();
    ctx.arc(CX, CY, SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.fill();

    if (mode === "hour") {
      // 바깥(1~12), 안쪽(0/13~23)
      const outer = Array.from({length:12}, (_, i) => ({ val: i===0?12:i, idx:i }));
      const inner = Array.from({length:12}, (_, i) => ({ val: i===0?0:i+12, idx:i }));
      const isOuter = hour >= 1 && hour <= 12;
      const selIdx  = isOuter ? (hour===12?0:hour) : (hour===0?0:hour-12);
      const handR   = isOuter ? HAND_OUTER : HAND_INNER;
      const ang     = (selIdx/12)*Math.PI*2 - Math.PI/2;
      const hx = CX + Math.cos(ang)*handR;
      const hy = CY + Math.sin(ang)*handR;

      // 핸드
      ctx.strokeStyle="#111827"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(hx,hy); ctx.stroke();
      ctx.fillStyle="#111827";
      ctx.beginPath(); ctx.arc(CX,CY,5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx,hy,20,0,Math.PI*2); ctx.fill();

      // 바깥 숫자
      outer.forEach(({val,idx}) => {
        const a=(idx/12)*Math.PI*2-Math.PI/2;
        const nx=CX+Math.cos(a)*R_OUTER, ny=CY+Math.sin(a)*R_OUTER;
        const sel=isOuter&&idx===selIdx;
        ctx.font=`${sel?"700":"400"} 15px -apple-system,sans-serif`;
        ctx.fillStyle=sel?"#fff":"#374151";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(String(val),nx,ny);
      });

      // 안쪽 숫자
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
      // 분 다이얼: 5분 단위 12개
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

      // 5분 단위 아닌 경우 중앙에 현재 분 표시
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
        {/* 헤더 */}
        <div style={cp.header}>
          <span style={cp.title}>{label??"시간 선택"}</span>
          <button onClick={onClose} style={cp.closeBtn}>✕</button>
        </div>

        {/* 시:분 수동 입력 디스플레이 */}
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

        {/* 모드 힌트 */}
        <p style={cp.hint}>
          {mode==="hour" ? "시를 선택하면 분으로 이동합니다" : "분을 선택하세요"}
        </p>

        {/* 시계 다이얼 */}
        <div style={{display:"flex",justifyContent:"center",padding:"4px 0 16px"}}>
          <canvas
            ref={canvasRef}
            onClick={e=>interact(e.clientX,e.clientY)}
            onTouchEnd={e=>{e.preventDefault(); const t=e.changedTouches[0]; if(t)interact(t.clientX,t.clientY);}}
            style={{cursor:"pointer",borderRadius:"50%",touchAction:"none",display:"block"}}
          />
        </div>

        {/* 확인 */}
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
      <div style={{display:"flex",flexDirection:"column" as const,alignItems:"center",gap:6}}>
        {label && <span style={{fontSize:11,color:"#9ca3af",fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px"}}>{label}</span>}
        <button
          onClick={()=>setOpen(true)}
          style={{background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:10,padding:"10px 14px",fontSize:22,fontWeight:800,color:"#111827",cursor:"pointer",fontVariantNumeric:"tabular-nums",letterSpacing:"-0.5px",minWidth:82,textAlign:"center" as const}}
        >{hh}:{mm}</button>
      </div>
      {open && <ClockPicker value={value} onChange={v=>{onChange(v);setOpen(false);}} onClose={()=>setOpen(false)} label={label} />}
    </>
  );
}
// ─── 메인 컴포넌트 ─────────────────────────────────────────
function WorklogForm() {
  const router = useRouter();
  const params = useSearchParams();
  const traineeId = params.get("traineeId") ?? "";
  const attendanceId = params.get("attendanceId") ?? "";
  const traineeName = params.get("traineeName") ?? "훈련생";
  const trainingType: TrainingType = (params.get("trainingType") as TrainingType) ?? "FIELD";

  const [siteInfo, setSiteInfo] = useState<SiteInfo>({
    workType: "전일(8H)", traineeCount: 1, isExtraTime: false,
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

  const premium = isPremium(siteInfo.agencyPlanType, siteInfo.trialEndsAt);

  // attendanceId 없으면 오늘 출근 기록에서 자동 조회
  const [resolvedAttendanceId, setResolvedAttendanceId] = useState(attendanceId);

  useEffect(() => {
    fetch("/api/worker/site/current")
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setSiteInfo(d.data);
          // attendanceId 없으면 오늘 출근 기록 ID 사용
          if (!attendanceId && d.data.attendanceId) {
            setResolvedAttendanceId(d.data.attendanceId);
          }
          // workType에서 기본 근무/훈련 시간 자동 적용
          const times = defaultTimes(d.data.workType ?? "전일(8H)");
          setWorkStart(times.workStart);
          setWorkEnd(times.workEnd);
          setTrainStart(times.trainStart);
          setTrainEnd(times.trainEnd);
          // 연장 기본 시간도 workEnd 기준으로 설정
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
    if (siteInfo.isExtraTime) {
      setIsCommuteGuide(true);
      setIsBreakGuide(true);
    }
  }, [siteInfo.isExtraTime]);

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
      recordingTimerRef.current = setInterval(() => {
        setRecordingSec(s => s + 1);
      }, 1000);
    } catch {
      alert("마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingSec(0);
  }

  async function sendAudioToGroq(blob: Blob, mimeType: string) {
    setAiLoading(true);
    // 기존 content는 유지 (AI 변환 완료 후 교체)
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
      if (data.success && data.content) {
        setContent(data.content);
      } else {
        alert("이전 일지 내용이 없습니다.");
      }
    } catch {
      alert("불러오기에 실패했습니다.");
    }
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
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, background: "#f9fafb", padding: 24 }}>
        <span style={{ fontSize: 56 }}>✅</span>
        <p style={{ fontSize: 18, fontWeight: 700, color: "#16a34a", margin: 0 }}>일지가 저장되었습니다.</p>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button onClick={() => router.push("/worker/home")}
            style={{ padding: "12px 24px", background: "#111827", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            🏠 홈으로
          </button>
          <button onClick={() => router.push("/worker/calendar")}
            style={{ padding: "12px 24px", background: "#fff", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            📅 캘린더
          </button>
        </div>
      </div>
    );
  }

  const ATTENDANCE_OPTIONS: Attendance[] = ["출석", "결석", "지각", "조퇴"];
  const ATTENDANCE_COLORS: Record<Attendance, string> = {
    출석: "#111827", 결석: "#dc2626", 지각: "#d97706", 조퇴: "#7c3aed",
  };

  return (
    <div style={s.page}>
      {/* ─ 헤더 ─ */}
      <div style={s.header}>
        <button onClick={() => router.back()} style={s.closeBtn}>←</button>
        <div style={s.headerCenter}>
          <span style={s.headerTitle}>
            {trainingType === "ADAPTATION" ? "적응지도 일지" : "훈련 일지"}
          </span>
          <span style={s.headerSub}>{traineeName} 훈련생</span>
        </div>
        <button onClick={() => handleSave(true)} style={s.doneBtn} disabled={saving}>
          {saving ? "저장중" : "완료"}
        </button>
      </div>

      <div style={s.container}>

        {/* ─ 날짜 ─ */}
        <div style={s.card}>
          <div style={s.cardRow}>
            <span style={s.cardLabel}>날짜</span>
            <input
              type="date"
              value={logDate}
              onChange={e => setLogDate(e.target.value)}
              style={s.dateInput}
            />
          </div>
        </div>

        {/* ─ 현장 유형 배지 ─ */}
        <div style={s.infoBadge}>
          <span style={s.infoIcon}>ℹ️</span>
          <span style={s.infoText}>
            {isMulti ? "1:多" : "1:1"} 지도 현장 &nbsp;·&nbsp; {siteInfo.traineeCount}명 &nbsp;·&nbsp; {siteInfo.workType}
          </span>
        </div>

        {/* ─ 출석 상태 ─ */}
        <div style={s.card}>
          <span style={s.cardLabel}>출결</span>
          <div style={s.attendanceRow}>
            {ATTENDANCE_OPTIONS.map(a => (
              <button
                key={a}
                onClick={() => setAttendance(a)}
                style={{
                  ...s.attendanceBtn,
                  background: attendance === a ? ATTENDANCE_COLORS[a] : "#f9fafb",
                  color: attendance === a ? "#fff" : "#6b7280",
                  border: attendance === a ? `1.5px solid ${ATTENDANCE_COLORS[a]}` : "1.5px solid #e5e7eb",
                }}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* ─ 근무 시간 ─ */}
        <div style={s.card}>
          <div style={{ ...s.cardRow, marginBottom: 16 }}>
            <span style={s.cardLabel}>근무 시간</span>
            <span style={s.timeHours}>{diffHours(workStart, workEnd)}H</span>
          </div>
          <div style={s.timeInputRow}>
            <TimeInput value={workStart} onChange={setWorkStart} label="시작" />
            <span style={s.timeSep}>—</span>
            <TimeInput value={workEnd} onChange={setWorkEnd} label="종료" />
          </div>
        </div>

        {/* ─ 훈련 시간 ─ */}
        <div style={s.card}>
          <div style={{ ...s.cardRow, marginBottom: 16 }}>
            <span style={s.cardLabel}>훈련 시간</span>
            <span style={s.timeHours}>{core}H</span>
          </div>
          <div style={s.timeInputRow}>
            <TimeInput value={trainStart} onChange={setTrainStart} label="시작" />
            <span style={s.timeSep}>—</span>
            <TimeInput value={trainEnd} onChange={setTrainEnd} label="종료" />
          </div>

          {/* 체크박스 */}
          <div style={s.checks}>
            {[
              { label: "출퇴근 지도", val: isCommuteGuide, set: setIsCommuteGuide, fixed: siteInfo.isExtraTime },
              { label: "휴게시간 지도", val: isBreakGuide, set: setIsBreakGuide, fixed: siteInfo.isExtraTime },
              { label: "연장 지도", val: isExtraGuide, set: setIsExtraGuide, fixed: false },
            ].map(({ label, val, set, fixed }) => (
              <label key={label} style={{ ...s.checkItem, opacity: fixed ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  checked={val || fixed}
                  onChange={e => !fixed && set(e.target.checked)}
                  disabled={fixed}
                  style={{ accentColor: "#111827", width: 17, height: 17, cursor: fixed ? "not-allowed" : "pointer" }}
                />
                <span style={{ fontSize: 14, color: "#374151" }}>
                  {label}{fixed ? " (고정)" : ""}
                </span>
              </label>
            ))}
          </div>

          {/* 연장 시간 */}
          {isExtraGuide && (
            <div style={s.extraTimeBox}>
              <div style={{ ...s.cardRow, marginBottom: 12 }}>
                <span style={{ ...s.cardLabel, color: "#dc2626" }}>연장 시간</span>
                <span style={{ ...s.timeHours, color: "#dc2626" }}>{extra}H</span>
              </div>
              <div style={s.timeInputRow}>
                <TimeInput value={extraStart} onChange={setExtraStart} label="시작" />
                <span style={s.timeSep}>—</span>
                <TimeInput value={extraEnd} onChange={setExtraEnd} label="종료" />
              </div>
            </div>
          )}
        </div>

        {/* ─ 평가 ─ */}
        <div style={s.card}>
          <div style={{ marginBottom: 20 }}>
            <p style={s.cardLabel}>과제 수행 평가</p>
            <div style={s.ratingRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setTaskScore(n)}
                  style={{ ...s.ratingBtn, background: taskScore === n ? "#111827" : "#f9fafb", color: taskScore === n ? "#fff" : "#6b7280", border: taskScore === n ? "1.5px solid #111827" : "1.5px solid #e5e7eb" }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{n}</span>
                  <span style={s.ratingLabel}>{["매우 못함", "못함", "보통", "잘함", "매우 잘함"][n - 1]}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p style={s.cardLabel}>과제 수행률</p>
            <div style={s.ratingRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setCompletionRate(n)}
                  style={{ ...s.ratingBtn, background: completionRate === n ? "#111827" : "#f9fafb", color: completionRate === n ? "#fff" : "#6b7280", border: completionRate === n ? "1.5px solid #111827" : "1.5px solid #e5e7eb" }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{n}</span>
                  <span style={s.ratingLabel}>{["25%↓", "25%↑", "50%↑", "75%↑", "100%"][n - 1]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ─ 지도 내용 ─ */}
        <div style={s.card}>
          <div style={s.contentHeader}>
            <span style={s.cardLabel}>지도 내용</span>
            <div style={s.contentBtns}>
              <button
                type="button"
                style={{
                  ...s.voiceBtn,
                  background: isRecording ? "#dc2626" : "#111827",
                  opacity: aiLoading ? 0.7 : 1,
                }}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={aiLoading}
              >
                {aiLoading ? "⏳ AI 변환 중..." : isRecording ? "⏹ 중지" : "🎤 음성입력"}
                {!premium && <span style={s.premiumTag}>PRO</span>}
              </button>
              <button type="button" style={s.prevBtn} onClick={loadPrevContent}>
                전일내용
              </button>
            </div>
          </div>

          {isRecording && (
            <div style={s.recordingIndicator}>
              <span style={s.recordingDot} />
              <span style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>
                녹음 중 {recordingSec}초 — 중지하려면 다시 누르세요
              </span>
            </div>
          )}
          {aiLoading && (
            <div style={s.recordingIndicator}>
              <span style={{ fontSize: 13, color: "#6b7280" }}>🤖 AI가 일지를 작성 중입니다...</span>
            </div>
          )}

          <textarea
            style={s.textarea}
            placeholder="지도 내용을 입력하세요."
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={5}
          />
        </div>

        {/* ─ 공단 인정 시간 요약 ─ */}
        <div style={s.summaryBox}>
          <p style={s.summaryTitle}>공단 인정 시간</p>
          {[
            { label: "1:1 지도 시간", value: `${isMulti ? "0.0" : (core + extra).toFixed(1)} H` },
            { label: "1:多 지도 시간", value: `${isMulti ? (core + extra).toFixed(1) : "0.0"} H` },
            { label: "1:1 연장 지도", value: `${!isMulti && isExtraGuide ? extra.toFixed(1) : "0.0"} H`, red: true },
            { label: "1:多 연장 지도", value: `${isMulti && isExtraGuide ? extra.toFixed(1) : "0.0"} H`, red: true },
            { label: "출퇴근/휴게 인정", value: `${bonus.toFixed(1)} H` },
          ].map(row => (
            <div key={row.label} style={s.summaryRow}>
              <span style={{ ...s.summaryLabel, color: (row as any).red ? "#dc2626" : "#6b7280" }}>{row.label}</span>
              <span style={{ ...s.summaryValue, color: (row as any).red ? "#dc2626" : "#374151" }}>{row.value}</span>
            </div>
          ))}
          <div style={s.divider} />
          <div style={s.summaryRow}>
            <span style={s.totalLabel}>합계</span>
            <span style={s.totalValue}>{recognized.total.toFixed(1)} H</span>
          </div>
        </div>

        {error && <p style={s.error}>{error}</p>}

        {/* ─ 임시저장 ─ */}
        <button
          style={{ ...s.tempSaveBtn, opacity: saving ? 0.7 : 1 }}
          onClick={() => handleSave(false)}
          disabled={saving}
        >
          임시저장
        </button>
      </div>
    </div>
  );
}

export default function WorklogPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f9fafb" }}>로딩 중...</div>}>
      <WorklogForm />
    </Suspense>
  );
}

// ─── 스타일 ────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f9fafb" },
  container: { maxWidth: 480, margin: "0 auto", padding: "12px 16px 80px" },

  // 헤더
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #f3f4f6", backgroundColor: "#fff", position: "sticky", top: 0, zIndex: 10 },
  closeBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#374151", width: 36, fontWeight: 700 },
  headerCenter: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  headerTitle: { fontSize: 16, fontWeight: 700, color: "#111827" },
  headerSub: { fontSize: 12, color: "#9ca3af", fontWeight: 500 },
  doneBtn: { background: "none", border: "none", color: "#111827", fontSize: 15, fontWeight: 700, cursor: "pointer", padding: "0 4px" },

  // 카드
  card: { backgroundColor: "#fff", borderRadius: 14, padding: "16px", marginBottom: 10, border: "1px solid #f3f4f6" },
  cardRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  cardLabel: { fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 12px" },

  // 날짜
  dateInput: { border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 15, fontWeight: 600, color: "#111827", padding: "8px 12px", outline: "none", background: "#f9fafb", cursor: "pointer" },

  // 배지
  infoBadge: { display: "flex", alignItems: "center", gap: 8, background: "#f0f9ff", borderRadius: 10, padding: "10px 14px", marginBottom: 10, border: "1px solid #bae6fd" },
  infoIcon: { fontSize: 14, flexShrink: 0 },
  infoText: { fontSize: 13, color: "#0369a1", fontWeight: 600 },

  // 출결
  attendanceRow: { display: "flex", gap: 8, marginTop: 4 },
  attendanceBtn: { flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.15s" },

  // 시간
  timeHours: { fontSize: 20, fontWeight: 800, color: "#111827" },
  timeInputRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 20 },
  timeSep: { fontSize: 18, color: "#d1d5db", fontWeight: 300, marginTop: 14 },

  // 체크박스
  checks: { display: "flex", flexWrap: "wrap", gap: 14, marginTop: 16, paddingTop: 16, borderTop: "1px solid #f3f4f6" },
  checkItem: { display: "flex", alignItems: "center", gap: 7, cursor: "pointer" },

  // 연장
  extraTimeBox: { background: "#fff5f5", borderRadius: 10, padding: "14px", marginTop: 14, border: "1px solid #fecaca" },

  // 평가
  ratingRow: { display: "flex", gap: 6 },
  ratingBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "10px 4px", borderRadius: 10, cursor: "pointer", fontSize: 14 },
  ratingLabel: { fontSize: 9, fontWeight: 500, textAlign: "center" as const, lineHeight: 1.2 },

  // 지도 내용
  contentHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  contentBtns: { display: "flex", gap: 6 },
  voiceBtn: { display: "flex", alignItems: "center", gap: 4, padding: "7px 11px", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", position: "relative" as const },
  premiumTag: { fontSize: 9, background: "rgba(255,255,255,0.25)", padding: "1px 4px", borderRadius: 4 },
  prevBtn: { padding: "7px 11px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" },
  recordingIndicator: { display: "flex", alignItems: "center", gap: 8, padding: "10px 0", marginBottom: 4 },
  recordingDot: { width: 8, height: 8, borderRadius: "50%", background: "#dc2626", animation: "pulse 1s infinite" },
  textarea: { width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px", fontSize: 14, color: "#374151", background: "#f9fafb", outline: "none", resize: "vertical" as const, boxSizing: "border-box" as const, fontFamily: "inherit", lineHeight: 1.7 },

  // 요약
  summaryBox: { background: "#fff", borderRadius: 14, padding: "16px", marginBottom: 10, border: "1px solid #f3f4f6" },
  summaryTitle: { fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 12px" },
  summaryRow: { display: "flex", justifyContent: "space-between", marginBottom: 8 },
  summaryLabel: { fontSize: 13 },
  summaryValue: { fontSize: 13, fontWeight: 600 },
  divider: { height: 1, background: "#f3f4f6", margin: "10px 0" },
  totalLabel: { fontSize: 15, fontWeight: 700, color: "#111827" },
  totalValue: { fontSize: 20, fontWeight: 800, color: "#111827" },

  error: { color: "#dc2626", fontSize: 13, background: "#fef2f2", padding: "12px 16px", borderRadius: 10, marginBottom: 12, textAlign: "center" as const, border: "1px solid #fecaca" },
  tempSaveBtn: { width: "100%", padding: 14, background: "#374151", color: "#fff", fontSize: 15, fontWeight: 700, border: "none", borderRadius: 12, cursor: "pointer", marginTop: 4 },
};
