"use client";
// app/worker/evaluation/page.tsx - 훈련생 종합평가 / 적응지도 평가 점수 입력

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const SECTIONS = [
  { code: "WORK_ATTITUDE", label: "근무태도", items: [
    "결근, 지각, 조퇴 등을 하지 않는다",
    "결근, 지각, 조퇴 등을 할 때는 연락을 취한다",
    "휴식시간과 근무시간을 잘 지킨다",
    "주의사항을 잘 듣고 그대로 이행한다",
    "외모를 깨끗하고 단정하게 유지한다",
  ]},
  { code: "INTERPERSONAL", label: "대인관계", items: [
    "상황에 맞는 적절한 경어를 사용한다",
    "주위동료와 협조를 잘한다",
    "상사, 동료, 고객에게 인사를 잘한다",
    "질문에 적절한 답변을 할 수 있다",
    "다른 사람의 이야기를 잘 청취한다.",
  ]},
  { code: "WORK_STYLE", label: "작업태도", items: [
    "적극적으로 업무에 참여한다",
    "지시없이 스스로 자신의 일을 수행한다",
    "열심히 작업에 몰두한다",
    "목표량을 완수하면 다른 일거리를 찾는다",
    "잘못을 지적할 때 호의적으로 반응한다",
  ]},
  { code: "WORK_PERFORMANCE", label: "작업수행", items: [
    "도구나 기계를 잘 다룬다.",
    "지시한 방법대로 작업을 수행한다(정확성)",
    "근무시간동안 산만하지 않고, 꾸준히 일한다.",
    "주어진 작업량을 완수한다.",
    "직무를 수행할수록, 속도와 정확성이 증가한다.(숙련성)",
  ]},
];

const SCORE_LABELS = ["", "불량(1)", "미흡(2)", "보통(3)", "양호(4)", "우수(5)"];

type ScoreRow = { initial: string; final: string };
type Scores = Record<string, ScoreRow[]>;
type Comments = Record<string, string>;

function defaultScores(): Scores {
  return Object.fromEntries(SECTIONS.map(s => [s.code, Array.from({length:5}, () => ({initial:"", final:""})) ]));
}

function calcTotal(scores: Scores, field: "initial"|"final") {
  return Object.values(scores).flat().reduce((sum, r) => sum + (parseInt(r[field])||0), 0);
}

function EvalInner() {
  const router = useRouter();
  const params = useSearchParams();
  const traineeId   = params.get("traineeId") || "";
  const traineeName = params.get("traineeName") || "훈련생";
  const evalType    = (params.get("evalType") || "TRAINING") as "TRAINING"|"ADAPTATION";
  const periodStart = params.get("periodStart") || "";
  const periodEnd   = params.get("periodEnd")   || "";

  const [scores,   setScores]   = useState<Scores>(defaultScores());
  const [comments, setComments] = useState<Comments>({});
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState("");
  const [loading,  setLoading]  = useState(true);

  const label1 = evalType === "TRAINING" ? "사전" : "초기";
  const label2 = evalType === "TRAINING" ? "현장" : "후기";
  const title  = evalType === "TRAINING" ? "훈련생 종합평가" : "적응지도 종합평가";

  useEffect(() => {
    if (!traineeId) { setLoading(false); return; }
    fetch(`/api/worker/evaluation?traineeId=${traineeId}&evalType=${evalType}&periodStart=${periodStart}&periodEnd=${periodEnd}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setScores(d.evaluation.scores as Scores || defaultScores());
          setComments(d.evaluation.comments as Comments || {});
        }
      })
      .finally(() => setLoading(false));
  }, [traineeId, evalType, periodStart, periodEnd]);

  const setScore = useCallback((code: string, idx: number, field: "initial"|"final", val: string) => {
    setScores(prev => {
      const next = { ...prev, [code]: [...prev[code]] };
      next[code][idx] = { ...next[code][idx], [field]: val };
      return next;
    });
  }, []);

  const setComment = useCallback((code: string, val: string) => {
    setComments(prev => ({ ...prev, [code]: val }));
  }, []);

  async function save() {
    if (!traineeId) return;
    setSaving(true);
    const res = await fetch("/api/worker/evaluation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traineeId, evalType, periodStart, periodEnd, scores, comments }),
    });
    const d = await res.json();
    setSaving(false);
    if (d.success) { setToast("저장되었습니다."); setTimeout(() => setToast(""), 2500); }
    else setToast("저장 실패: " + (d.message || ""));
  }

  if (loading) return <div style={s.center}>불러오는 중...</div>;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={() => router.back()} style={s.backBtn}>←</button>
        <div>
          <h1 style={s.title}>{title}</h1>
          <p style={s.sub}>{traineeName} · {periodStart} ~ {periodEnd}</p>
        </div>
      </div>

      <div style={s.container}>
        {/* 점수표 */}
        {SECTIONS.map(sec => (
          <div key={sec.code} style={s.card}>
            <div style={s.secHeader}>
              <span style={s.secTitle}>{sec.label}</span>
              <span style={s.secScore}>
                {label1}: {sec.items.reduce((s,_,i) => s+(parseInt(scores[sec.code]?.[i]?.initial)||0), 0)}점 /
                {label2}: {sec.items.reduce((s,_,i) => s+(parseInt(scores[sec.code]?.[i]?.final)||0), 0)}점
              </span>
            </div>

            {sec.items.map((item, idx) => (
              <div key={idx} style={s.itemRow}>
                <p style={s.itemText}>{idx+1}. {item}</p>
                <div style={s.scoreRow}>
                  <div style={s.scoreField}>
                    <span style={s.scoreLabel}>{label1}</span>
                    <select
                      value={scores[sec.code]?.[idx]?.initial || ""}
                      onChange={e => setScore(sec.code, idx, "initial", e.target.value)}
                      style={s.select}
                    >
                      <option value="">-</option>
                      {[1,2,3,4,5].map(v => <option key={v} value={v}>{v}점</option>)}
                    </select>
                  </div>
                  <div style={s.scoreField}>
                    <span style={s.scoreLabel}>{label2}</span>
                    <select
                      value={scores[sec.code]?.[idx]?.final || ""}
                      onChange={e => setScore(sec.code, idx, "final", e.target.value)}
                      style={s.select}
                    >
                      <option value="">-</option>
                      {[1,2,3,4,5].map(v => <option key={v} value={v}>{v}점</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}

            {/* 평가소견 */}
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>평가소견</p>
              <textarea
                value={comments[sec.code] || ""}
                onChange={e => setComment(sec.code, e.target.value)}
                placeholder="평가소견을 입력하세요"
                style={s.textarea}
                rows={3}
              />
            </div>
          </div>
        ))}

        {/* 총점 */}
        <div style={s.totalCard}>
          <span style={s.totalLabel}>총점 (만점 100점)</span>
          <div style={s.totalScores}>
            <span style={s.totalScore}>{label1}: <strong>{calcTotal(scores,"initial")}</strong>점</span>
            <span style={s.totalScore}>{label2}: <strong>{calcTotal(scores,"final")}</strong>점</span>
          </div>
        </div>

        <p style={s.note}>※ 항목별 점수채점: 우수 5점, 양호 4점, 보통 3점, 미흡 2점, 불량 1점</p>

        <button onClick={save} disabled={saving || !traineeId} style={s.saveBtn}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      {toast && (
        <div style={s.toast}>{toast}</div>
      )}
    </div>
  );
}

export default function EvalPage() {
  return (
    <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100dvh"}}>로딩 중...</div>}>
      <EvalInner />
    </Suspense>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:       { minHeight:"100dvh", background:"#f9fafb", paddingBottom:80 },
  header:     { display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:"#fff", borderBottom:"1px solid #f3f4f6", position:"sticky", top:0, zIndex:10 },
  backBtn:    { background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#374151", fontWeight:700 },
  title:      { fontSize:16, fontWeight:700, color:"#111827", margin:0 },
  sub:        { fontSize:12, color:"#9ca3af", margin:"2px 0 0" },
  container:  { maxWidth:480, margin:"0 auto", padding:"16px 16px 20px" },
  card:       { background:"#fff", borderRadius:12, padding:"14px 16px", marginBottom:12, border:"1px solid #f0f0f0" },
  secHeader:  { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 },
  secTitle:   { fontSize:14, fontWeight:700, color:"#111827" },
  secScore:   { fontSize:12, color:"#6b7280" },
  itemRow:    { marginBottom:10, paddingBottom:10, borderBottom:"1px solid #f9fafb" },
  itemText:   { fontSize:13, color:"#374151", margin:"0 0 6px", lineHeight:1.5 },
  scoreRow:   { display:"flex", gap:12 },
  scoreField: { display:"flex", alignItems:"center", gap:6 },
  scoreLabel: { fontSize:12, color:"#6b7280", whiteSpace:"nowrap" },
  select:     { height:34, border:"1px solid #e5e7eb", borderRadius:6, fontSize:13, padding:"0 6px", color:"#111827", background:"#fff" },
  textarea:   { width:"100%", border:"1px solid #e5e7eb", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#374151", resize:"vertical", boxSizing:"border-box" },
  totalCard:  { background:"#111827", borderRadius:12, padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 },
  totalLabel: { fontSize:13, color:"#9ca3af", fontWeight:600 },
  totalScores:{ display:"flex", gap:16 },
  totalScore: { fontSize:14, color:"#fff" },
  note:       { fontSize:11, color:"#9ca3af", textAlign:"center", margin:"0 0 16px" },
  saveBtn:    { width:"100%", padding:"14px", background:"#111827", color:"#fff", border:"none", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer" },
  toast:      { position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"#111827", color:"#fff", padding:"11px 20px", borderRadius:10, fontSize:14, fontWeight:600, zIndex:2000 },
  center:     { display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100dvh" },
};
