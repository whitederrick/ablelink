"use client";
// app/worker/worklog/page.tsx
// 업무일지 작성 — 시간 자동계산 + 음성→AI 변환 (PREMIUM)

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
  return Math.max(0, Math.round(diff / 6) / 10); // 소수점 1자리
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

// ─── 메인 컴포넌트 ─────────────────────────────────────────
function WorklogForm() {
  const router = useRouter();
  const params = useSearchParams();
  const traineeId = params.get("traineeId") ?? "";
  const attendanceId = params.get("attendanceId") ?? "";
  const traineeName = params.get("traineeName") ?? "훈련생";
  const trainingType: TrainingType = (params.get("trainingType") as TrainingType) ?? "FIELD";

  // Site 정보 (홈에서 전달받거나 API로 가져옴)
  const [siteInfo, setSiteInfo] = useState<SiteInfo>({
    workType: "전일(8H)", traineeCount: 1, isExtraTime: false,
  });

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // 입력 상태
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

  // AI 음성 상태 (Groq Whisper 기반)
  const [isRecording, setIsRecording] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // 제출 상태
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const premium = isPremium(siteInfo.agencyPlanType, siteInfo.trialEndsAt);

  // Site 정보 로드
  useEffect(() => {
    fetch("/api/worker/site/current")
      .then(r => r.json())
      .then(d => { if (d.success && d.data) setSiteInfo(d.data); })
      .catch(() => {});
  }, []);

  // isExtraTime 동기화
  useEffect(() => {
    if (siteInfo.isExtraTime) {
      setIsCommuteGuide(true);
      setIsBreakGuide(true);
    }
  }, [siteInfo.isExtraTime]);

  // 시간 계산
  const core = diffHours(trainStart, trainEnd);
  const extra = isExtraGuide ? diffHours(extraStart, extraEnd) : 0;
  const bonus = (isCommuteGuide || isBreakGuide) ? 1.5 : 0;
  const isMulti = siteInfo.traineeCount > 1;
  const recognized = calcRecognized({ core, extra, bonus });

  // ── 음성 녹음 ────────────────────────────────────────────
  // Groq Whisper 기반 음성 녹음 시작
  async function startRecording() {
    if (!premium) {
      alert("음성 AI 변환은 PREMIUM 기능입니다.\n에이전시 담당자에게 구독 문의해주세요.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // webm 지원 여부 확인 (Safari 대응)
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await sendAudioToGroq(blob, mimeType);
      };

      recorder.start(500); // 500ms마다 데이터 수집
      mediaRef.current = recorder;
      setIsRecording(true);
    } catch {
      alert("마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setIsRecording(false);
  }

  // Groq Whisper STT + Gemini 일지 변환
  async function sendAudioToGroq(blob: Blob, mimeType: string) {
    setAiLoading(true);
    setContent("🎤 음성 분석 중...");
    try {
      const formData = new FormData();
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      formData.append("audio", blob, `recording.${ext}`);
      formData.append("traineeName", traineeName);
      formData.append("taskScore", String(taskScore));

      const res = await fetch("/api/worker/ai/voice-to-log", {
        method: "POST",
        body: formData,
      });
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

  // ── 전일 내용 불러오기 ──────────────────────────────────
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

  // ── 저장 ────────────────────────────────────────────────
  async function handleSave(isComplete: boolean) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/worker/logs/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traineeId,
          attendanceId,
          trainingType,
          attendance,
          trainStartTime: trainStart,
          trainEndTime: trainEnd,
          isCommuteGuide,
          isBreakGuide,
          isExtraGuide,
          extraStartTime: isExtraGuide ? extraStart : null,
          extraEndTime: isExtraGuide ? extraEnd : null,
          time1on1: isMulti ? 0 : core + extra,
          timeGroup: isMulti ? core + extra : 0,
          extTime1on1: 0,
          extTimeGroup: 0,
          totalRecognizedTime: recognized.total,
          taskScore,
          completionRate,
          content,
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
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <span style={{ fontSize: 48 }}>✅</span>
        <p style={{ fontSize: 18, fontWeight: 700, color: "#2e7d32" }}>저장되었습니다.</p>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* 헤더 */}
        <div style={s.header}>
          <button onClick={() => router.back()} style={s.closeBtn}>✕</button>
          <span style={s.headerTitle}>업무일지 작성</span>
          <button onClick={() => handleSave(true)} style={s.doneBtn} disabled={saving}>
            {saving ? "저장중" : "완료"}
          </button>
        </div>

        {/* 날짜 */}
        <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} style={s.dateInput} />

        {/* 1:1 / 1:多 안내 */}
        <div style={s.infoBadge}>
          <span style={s.infoIcon}>ℹ️</span>
          <div>
            <p style={s.infoTitle}>현재 {isMulti ? "1:多" : "1:1"} 지도 현장입니다.</p>
            <p style={s.infoSub}>(훈련생 {siteInfo.traineeCount}명 / {siteInfo.workType})</p>
          </div>
        </div>

        {/* 근무 시간 */}
        <div style={s.card}>
          <div style={s.row}>
            <span style={s.cardLabel}>근무 시간</span>
            <div style={s.timeRow}>
              <input type="time" value={workStart} onChange={e => setWorkStart(e.target.value)} style={s.timeInput} />
              <span style={s.sep}>~</span>
              <input type="time" value={workEnd} onChange={e => setWorkEnd(e.target.value)} style={s.timeInput} />
              <span style={s.badge}>총 {diffHours(workStart, workEnd)}H</span>
            </div>
          </div>
          <p style={s.notice}>※ {isMulti ? "1:多" : "1:1"} 지도 기준이 적용됩니다.</p>
        </div>

        {/* 훈련생별 섹션 */}
        <div style={s.traineeSection}>
          <div style={s.traineeHeader}>
            <span style={s.traineeBadge}>{traineeName}</span>
            <span style={s.traineeLabel}>훈련생</span>
          </div>

          {/* 출석 */}
          <div style={s.attendanceRow}>
            {(["출석", "결석", "지각", "조퇴"] as Attendance[]).map(a => (
              <label key={a} style={s.radioLabel}>
                <input type="radio" name="attendance" checked={attendance === a}
                  onChange={() => setAttendance(a)} style={{ accentColor: "#2563eb" }} />
                <span style={{ fontSize: 15, color: attendance === a ? "#333" : "#aaa" }}>{a}</span>
              </label>
            ))}
          </div>

          {/* 훈련 시간 */}
          <div style={s.row}>
            <span style={s.cardLabel}>훈련 시간</span>
            <div style={s.timeRow}>
              <input type="time" value={trainStart} onChange={e => setTrainStart(e.target.value)} style={s.timeInput} />
              <span style={s.sep}>~</span>
              <input type="time" value={trainEnd} onChange={e => setTrainEnd(e.target.value)} style={s.timeInput} />
              <span style={s.badge}>{core}H</span>
            </div>
          </div>

          {/* 체크박스 */}
          <div style={s.checks}>
            {[
              { label: "출퇴근 지도", val: isCommuteGuide, set: setIsCommuteGuide, fixed: siteInfo.isExtraTime },
              { label: "휴게시간 지도", val: isBreakGuide, set: setIsBreakGuide, fixed: siteInfo.isExtraTime },
              { label: "연장 지도", val: isExtraGuide, set: setIsExtraGuide, fixed: false },
            ].map(({ label, val, set, fixed }) => (
              <label key={label} style={{ ...s.checkItem, opacity: fixed ? 0.6 : 1 }}>
                <input type="checkbox" checked={val || fixed}
                  onChange={e => !fixed && set(e.target.checked)}
                  disabled={fixed}
                  style={{ accentColor: "#2563eb", width: 18, height: 18 }} />
                <span style={{ fontSize: 14, color: "#444" }}>{label}{fixed ? " (고정)" : ""}</span>
              </label>
            ))}
          </div>

          {/* 연장 시간 */}
          {isExtraGuide && (
            <div style={{ ...s.row, backgroundColor: "#fff5f5", padding: "8px 12px", borderRadius: 8, marginTop: 8 }}>
              <span style={{ ...s.cardLabel, color: "#e53935" }}>연장 시간</span>
              <div style={s.timeRow}>
                <input type="time" value={extraStart} onChange={e => setExtraStart(e.target.value)} style={s.timeInput} />
                <span style={s.sep}>~</span>
                <input type="time" value={extraEnd} onChange={e => setExtraEnd(e.target.value)} style={s.timeInput} />
                <span style={{ ...s.badge, backgroundColor: "#e53935" }}>{extra}H</span>
              </div>
            </div>
          )}

          {/* 과제 수행 평가 */}
          <p style={s.subTitle}>과제 수행 평가</p>
          <div style={s.ratingRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" onClick={() => setTaskScore(n)}
                style={{ ...s.ratingBtn, ...(taskScore === n ? s.ratingActive : {}) }}>
                <span>{n}</span>
                <span style={s.ratingLabel}>{["매우 못함", "못함", "보통", "잘함", "매우 잘함"][n - 1]}</span>
              </button>
            ))}
          </div>

          {/* 과제 수행률 */}
          <p style={s.subTitle}>과제 수행률</p>
          <div style={s.ratingRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" onClick={() => setCompletionRate(n)}
                style={{ ...s.ratingBtn, ...(completionRate === n ? s.ratingActive : {}) }}>
                <span>{n}</span>
                <span style={s.ratingLabel}>{["25%↓", "25%↑", "50%↑", "75%↑", "100%"][n - 1]}</span>
              </button>
            ))}
          </div>

          {/* 지도 내용 */}
          <div style={s.contentHeader}>
            <p style={s.subTitle}>지도 내용</p>
            <div style={s.contentBtns}>
              {/* 음성 등록 버튼 */}
              <button
                type="button"
                style={{
                  ...s.voiceBtn,
                  backgroundColor: isRecording ? "#e53935" : "#2563eb",
                  opacity: aiLoading ? 0.7 : 1,
                }}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={aiLoading}
              >
                {aiLoading ? "⏳ AI 변환 중..." : isRecording ? "⏹ 녹음 중지" : "🎤 음성등록"}
                {!premium && <span style={s.premiumTag}>PRO</span>}
              </button>
              <button type="button" style={s.prevBtn} onClick={loadPrevContent}>
                전일내용 불러오기
              </button>
            </div>
          </div>

          {isRecording && (
            <div style={s.recordingIndicator}>
              <span style={s.recordingDot} />
              <span style={{ fontSize: 13, color: "#e53935" }}>녹음 중... 종료하려면 다시 누르세요</span>
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

        {/* 공단 인정 시간 요약 */}
        <div style={s.summaryBox}>
          {[
            { label: "1:1 지도 시간", value: `${isMulti ? "0.0" : (core + extra).toFixed(1)} H`, red: false },
            { label: "1:多 지도 시간", value: `${isMulti ? (core + extra).toFixed(1) : "0.0"} H`, red: false },
            { label: "1:1 연장 지도 시간", value: `${!isMulti && isExtraGuide ? extra.toFixed(1) : "0.0"} H`, red: true },
            { label: "1:多 연장 지도 시간", value: `${isMulti && isExtraGuide ? extra.toFixed(1) : "0.0"} H`, red: true },
            { label: "출퇴근/휴게 직무지도 인정", value: `${bonus.toFixed(1)} H`, red: false },
          ].map(row => (
            <div key={row.label} style={s.summaryRow}>
              <span style={{ ...s.summaryLabel, color: row.red ? "#e53935" : "#666" }}>{row.label}</span>
              <span style={{ ...s.summaryValue, color: row.red ? "#e53935" : "#333" }}>{row.value}</span>
            </div>
          ))}
          <div style={s.divider} />
          <div style={s.summaryRow}>
            <span style={s.totalLabel}>공단 인정 시간</span>
            <span style={s.totalValue}>{recognized.total.toFixed(1)} H</span>
          </div>
        </div>

        {error && <p style={s.error}>{error}</p>}

        {/* 임시저장 버튼 */}
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
    <Suspense fallback={<div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>로딩 중...</div>}>
      <WorklogForm />
    </Suspense>
  );
}

// ─── 스타일 ────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f7f8fa" },
  container: { maxWidth: 480, margin: "0 auto", padding: "0 0 60px" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #eee", backgroundColor: "#fff", position: "sticky", top: 0, zIndex: 10 },
  closeBtn: { background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#666", width: 36 },
  headerTitle: { fontSize: 17, fontWeight: 700, color: "#333" },
  doneBtn: { backgroundColor: "transparent", border: "none", color: "#2563eb", fontSize: 16, fontWeight: 700, cursor: "pointer" },

  dateInput: { margin: "16px 16px 8px", fontSize: 20, fontWeight: 700, border: "none", backgroundColor: "transparent", color: "#333", cursor: "pointer", width: "calc(100% - 32px)" },

  infoBadge: { display: "flex", alignItems: "flex-start", gap: 8, backgroundColor: "#f0f2ff", margin: "0 16px 12px", padding: "12px", borderRadius: 12 },
  infoIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  infoTitle: { fontSize: 14, fontWeight: 700, color: "#2563eb", margin: 0 },
  infoSub: { fontSize: 12, color: "#2563eb", margin: "2px 0 0" },

  card: { backgroundColor: "#fff", margin: "0 16px 12px", borderRadius: 14, padding: "16px" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  cardLabel: { fontSize: 15, fontWeight: 700, color: "#444" },
  timeRow: { display: "flex", alignItems: "center", gap: 6 },
  timeInput: { border: "none", borderBottom: "1.5px solid #ddd", fontSize: 16, color: "#2563eb", fontWeight: 600, width: 72, textAlign: "center", outline: "none", backgroundColor: "transparent" },
  sep: { color: "#888", fontSize: 14 },
  badge: { backgroundColor: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 6 },
  notice: { fontSize: 12, color: "#e53935", margin: "8px 0 0", fontWeight: 500 },

  traineeSection: { backgroundColor: "#fff", margin: "0 16px 12px", borderRadius: 14, padding: "16px", borderTop: "6px solid #f5f5f5" },
  traineeHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 },
  traineeBadge: { backgroundColor: "#2563eb", color: "#fff", padding: "6px 14px", borderRadius: 20, fontSize: 14, fontWeight: 700 },
  traineeLabel: { fontSize: 18, fontWeight: 700, color: "#333" },
  attendanceRow: { display: "flex", gap: 16, marginBottom: 20 },
  radioLabel: { display: "flex", alignItems: "center", gap: 4, cursor: "pointer" },
  checks: { display: "flex", flexWrap: "wrap", gap: 12, margin: "12px 0" },
  checkItem: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" },
  subTitle: { fontSize: 15, fontWeight: 700, color: "#333", margin: "16px 0 10px" },
  ratingRow: { display: "flex", gap: 6, marginBottom: 8 },
  ratingBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 4px", border: "1.5px solid #eee", borderRadius: 10, cursor: "pointer", backgroundColor: "#fff", fontSize: 15, fontWeight: 600, color: "#666" },
  ratingActive: { backgroundColor: "#2563eb", color: "#fff", border: "1.5px solid #2563eb" },
  ratingLabel: { fontSize: 9, fontWeight: 400, textAlign: "center" as const },

  contentHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  contentBtns: { display: "flex", gap: 6, flexWrap: "wrap" as const },
  voiceBtn: { display: "flex", alignItems: "center", gap: 4, padding: "7px 10px", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", position: "relative" as const },
  premiumTag: { fontSize: 9, backgroundColor: "rgba(255,255,255,0.3)", padding: "1px 4px", borderRadius: 4, marginLeft: 2 },
  prevBtn: { padding: "7px 10px", backgroundColor: "#f0f0f0", color: "#555", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" },
  recordingIndicator: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", animation: "fadeIn 0.3s" },
  recordingDot: { width: 10, height: 10, borderRadius: "50%", backgroundColor: "#e53935", animation: "pulse 1s infinite" },
  textarea: { width: "100%", border: "1.5px solid #eee", borderRadius: 12, padding: "12px", fontSize: 15, color: "#333", backgroundColor: "#fafafa", outline: "none", resize: "vertical" as const, boxSizing: "border-box" as const, fontFamily: "inherit", lineHeight: 1.6, marginTop: 8 },

  summaryBox: { backgroundColor: "#f7f8fa", margin: "0 16px 12px", borderRadius: 14, padding: "16px", border: "1px solid #e5e7eb" },
  summaryRow: { display: "flex", justifyContent: "space-between", marginBottom: 8 },
  summaryLabel: { fontSize: 13 },
  summaryValue: { fontSize: 13, fontWeight: 700 },
  divider: { height: 1, backgroundColor: "#e5e7eb", margin: "10px 0" },
  totalLabel: { fontSize: 15, fontWeight: 700, color: "#2563eb" },
  totalValue: { fontSize: 18, fontWeight: 700, color: "#2563eb" },

  error: { color: "#e53935", fontSize: 13, backgroundColor: "#fff5f5", padding: "12px 16px", borderRadius: 10, margin: "0 16px 12px", textAlign: "center" },
  tempSaveBtn: { width: "calc(100% - 32px)", margin: "0 16px", padding: 14, backgroundColor: "#333", color: "#fff", fontSize: 16, fontWeight: 700, border: "none", borderRadius: 12, cursor: "pointer" },
};
