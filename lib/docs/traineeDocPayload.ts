// lib/docs/traineeDocPayload.ts
// 4종 훈련생 공식문서(훈련일지·훈련생종합평가·적응지도일지·적응지도종합평가)의
// payload "형태"(필드명·행 매핑) 단일 출처. 순수함수 — DB 접근/게이트/서명조회 없음.
//
// 배경: 이 payload 조립이 worker/admin의 generate·preview·submit 6곳에 사본으로 흩어져
//  drift(필드 오타·매핑 불일치)가 반복됐다. 조회·IDOR가드·평가확정게이트·서명주입 정책은
//  경로마다 정당하게 다르므로 각 호출처에 남기고, "객체 조립"만 이 빌더로 통일한다.
//  holidays·signatures는 파라미터 → 각 호출처가 지금 넘기던 값을 그대로 전달하면 출력 불변.

function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number | null): string {
  if (!n) return "";
  return ({ 1: "매우못함", 2: "못함", 3: "보통", 4: "잘함", 5: "매우잘함" } as any)[n] || String(n);
}

export interface DocTimeValues {
  trainingTimeH: string;
  guidanceYN: string;
  measTimeH: string;
  workTimeRange: string;
}

/** traineeLog + 관계(attendance, tasks)에서 payload 조립에 쓰는 최소 형태. */
export interface TraineeLogLike {
  trainingType: string;
  evaluation: string | null;
  content: string | null;
  attendance: { workDate: string };
  tasks: { taskName: string | null; performanceScore: number | null }[];
}

/** 확정 평가(traineeEvaluation)에서 쓰는 최소 형태. null이면 빈 점수/소견. */
export interface EvalLike {
  scores: unknown;
  comments: unknown;
}

// ── 1) 지원고용 훈련일지 ──────────────────────────────────────
export function trainingDailyLogPayload(args: {
  traineeName: string;
  companyName: string;
  /** 사전훈련 시작일(YYYY-MM-DD). 보통 assignment.stepStart ?? start. */
  preStartYmd: string;
  start: string;
  end: string;
  logs: TraineeLogLike[];
  docTimes: DocTimeValues;
  /** 있으면 payload에 포함(자동생성 제외 휴무일). 미전달 시 키 자체 생략(preview/admin 기존 동작 보존). */
  holidays?: string[];
  signatures: Record<string, { name: string; imageUrl?: string }>;
}) {
  const { traineeName, companyName, preStartYmd, start, end, logs, docTimes, holidays, signatures } = args;
  return {
    traineeName,
    companyName,
    periodPreText:   fmtPeriod(preStartYmd, start),
    periodFieldText: fmtPeriod(start, end),
    ...(holidays !== undefined ? { holidays } : {}),
    rows: logs.map((l) => ({
      section: l.trainingType === "PRE" ? "PRE" : "FIELD",
      date: l.attendance.workDate,
      attendanceStatus: l.evaluation || "출석",
      trainingTime: docTimes.trainingTimeH,
      guidanceFlag: docTimes.guidanceYN,
      task: l.tasks[0]?.taskName || "",
      taskLevelMeasured: `${scoreLabel(l.tasks[0]?.performanceScore)}\n(${docTimes.measTimeH})`,
      evalGuidance: l.content || "",
    })),
    signatures,
  };
}

// ── 2) 지원고용 훈련생 종합 평가기록부 ────────────────────────
export function traineeFinalEvalPayload(args: {
  traineeName: string;
  companyName: string;
  preStartYmd: string;
  start: string;
  end: string;
  ev: EvalLike | null;
  signatures: Record<string, { name: string; imageUrl?: string }>;
}) {
  const { traineeName, companyName, preStartYmd, start, end, ev, signatures } = args;
  return {
    traineeName,
    companyName,
    preTrainingStart:   preStartYmd,
    preTrainingEnd:     start,
    fieldTrainingStart: start,
    fieldTrainingEnd:   end,
    scores:   (ev?.scores as any)   || {},
    comments: (ev?.comments as any) || {},
    signatures,
  };
}

// ── 3) 취업 후 적응지도 일지 ──────────────────────────────────
export function adaptationDailyLogPayload(args: {
  traineeName: string;
  companyName: string;
  start: string;
  end: string;
  logs: TraineeLogLike[];
  docTimes: DocTimeValues;
  holidays?: string[];
  signatures: Record<string, { name: string; imageUrl?: string }>;
}) {
  const { traineeName, companyName, start, end, logs, docTimes, holidays, signatures } = args;
  return {
    traineeName,
    companyName,
    periodStart: start,
    periodEnd:   end,
    ...(holidays !== undefined ? { holidays } : {}),
    entries: logs.map((l) => ({
      dateISO: l.attendance.workDate,
      attendance: l.evaluation || "출석",
      workTime: docTimes.workTimeRange,
      guidance: docTimes.guidanceYN,
      task: l.tasks[0]?.taskName || "",
      performanceLabel: scoreLabel(l.tasks[0]?.performanceScore),
      performanceTime: docTimes.measTimeH,
      coaching: l.content || "",
    })),
    signatures,
  };
}

// ── 4) 적응지도 대상자 종합 평가기록부 ────────────────────────
export function adaptationFinalEvalPayload(args: {
  traineeName: string;
  companyName: string;
  start: string;
  end: string;
  ev: EvalLike | null;
  /** 적응지도 기간 내 실제 지도(근무)한 날 수 = 작성된 적응지도 일지 수. 헤더 '(N)일' 표기용. */
  workedDays?: number;
  signatures: Record<string, { name: string; imageUrl?: string }>;
}) {
  const { traineeName, companyName, start, end, ev, workedDays, signatures } = args;
  return {
    traineeName,
    companyName,
    periodStart: start,
    periodEnd:   end,
    ...(workedDays != null ? { workedDays } : {}),
    scores:   (ev?.scores as any)   || {},
    comments: (ev?.comments as any) || {},
    signatures,
  };
}
