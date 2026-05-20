// lib/pdfGenerator.ts
// jsreport API 호출 → PDF 생성 + AWS SES 이메일 발송
// ⚠️ jsreport 템플릿(Handlebars)은 절대 수정하지 않음
//    각 템플릿이 기대하는 데이터 구조를 정확히 만들어 전달만 함

const JSREPORT_URL = process.env.JSREPORT_URL || "http://localhost:5488";

export type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

export const DOC_LABELS: Record<DocType, string> = {
  "attendance-sheet":      "직무지도원 출근부",
  "training-daily-log":    "지원고용 훈련일지",
  "trainee-final-eval":    "지원고용 훈련생 종합 평가기록부",
  "adaptation-daily-log":  "취업 후 적응지도 일지",
  "adaptation-final-eval": "적응지도 대상자 종합 평가기록부",
};

// ── 서명 이미지 URL → base64 data URI 변환 ──────────────
// jsreport(Chrome PDF)는 외부 URL 이미지를 크기 제어 못함
// base64로 변환하면 HTML에 직접 포함되어 height/width가 완벽하게 적용됨
async function urlToBase64(url: string): Promise<string | null> {
  if (!url || !url.startsWith("http")) return url || null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const mime = res.headers.get("content-type") || "image/png";
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

// 서명 세트의 모든 imageUrl을 base64로 변환
async function resolveSignatureImages(sigs: Record<string, any>): Promise<Record<string, any>> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(sigs)) {
    if (val && typeof val === "object" && "imageUrl" in val) {
      result[key] = {
        ...val,
        imageUrl: val.imageUrl ? await urlToBase64(val.imageUrl) : null,
      };
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ── PDF 생성 (jsreport API 호출) ─────────────────────────
export async function generatePdf(template: DocType, data: Record<string, any>): Promise<Buffer> {
  // 서명 이미지 URL → base64 변환 (Chrome PDF에서 크기 제어 보장)
  if (data.signatures) {
    data = { ...data, signatures: await resolveSignatureImages(data.signatures) };
  }
  const res = await fetch(`${JSREPORT_URL}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: { name: template }, data }),
  });
  if (!res.ok) throw new Error(`jsreport 오류 (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── 서명 구조 타입 ───────────────────────────────────────
export interface SignatureSet {
  coachImageUrl?:          string | null;  // 직무지도원
  coachName?:              string | null;
  govAgentImageUrl?:       string | null;  // (공단/위탁기관) 담당자 = 에이전시 관리자
  govAgentName?:           string | null;
  companyManagerImageUrl?: string | null;  // 사업체 담당자 (즉석 서명)
  companyManagerName?:     string | null;
  agencyAgentImageUrl?:    string | null;  // 적응지도 문서용 위탁기관 담당자
  agencyAgentName?:        string | null;
}

// ─────────────────────────────────────────────────────────
// ① 출근부 (attendance-sheet)
// beforeRender: entries[] → weeks[] 자동 변환
// ─────────────────────────────────────────────────────────
export function buildAttendanceSheetData(params: {
  coachName: string;
  coachPhone: string;
  companyName: string;
  periodStart: string;  // YYYY-MM-DD
  periodEnd: string;
  attendances: Array<{
    workDate: string;
    startTime: string | null;
    endTime: string | null;
    time1on1: number;
    timeGroup: number;
    extTime1on1: number;
    extTimeGroup: number;
  }>;
  signatures: SignatureSet;
}) {
  const { coachName, coachPhone, companyName, periodStart, periodEnd, attendances, signatures } = params;

  const entries = attendances
    .filter(a => a.startTime)
    .map(a => ({
      date: a.workDate,
      start: a.startTime,
      end: a.endTime || "",
      hours: +(a.time1on1 + a.extTime1on1).toFixed(1),
      multiHours: +(a.timeGroup + a.extTimeGroup).toFixed(1),
    }));

  const now = new Date();
  return {
    coachName, coachPhone, companyName,
    periodStart, periodEnd,
    totalDays:       entries.length,
    totalHours:      +attendances.reduce((s,a) => s+a.time1on1+a.timeGroup+a.extTime1on1+a.extTimeGroup, 0).toFixed(1),
    weeklyHolidayCount: 0,
    monthlyLeaveCount:  0,
    allowanceTotalWon:  "0",
    oneToOneHours:   +attendances.reduce((s,a) => s+a.time1on1+a.extTime1on1, 0).toFixed(1),
    oneToManyHours:  +attendances.reduce((s,a) => s+a.timeGroup+a.extTimeGroup, 0).toFixed(1),
    otOneToOneHours: +attendances.reduce((s,a) => s+a.extTime1on1, 0).toFixed(1),
    otOneToManyHours:+attendances.reduce((s,a) => s+a.extTimeGroup, 0).toFixed(1),
    year: now.getFullYear(), month: now.getMonth()+1, day: now.getDate(),
    entries, // beforeRender가 entries → weeks 변환
    signatures: {
      govAgent:       { imageUrl: signatures.govAgentImageUrl       || null, name: signatures.govAgentName       || "" },
      companyManager: { imageUrl: signatures.companyManagerImageUrl || null, name: signatures.companyManagerName || "" },
      coach:          { imageUrl: signatures.coachImageUrl          || null, name: signatures.coachName          || "" },
    },
  };
}

// ─────────────────────────────────────────────────────────
// ② 훈련일지 (training-daily-log)
// 서명: govAgent(공단/위탁기관), companyManager(사업체), coach(직무지도원)
// ─────────────────────────────────────────────────────────
export function buildTrainingDailyLogData(params: {
  traineeName: string;
  companyName: string;
  preTrainingPeriod: string;    // "2026.01.05 ~ 2026.01.05"
  fieldTrainingPeriod: string;  // "2026.01.06 ~ 2026.05.31"
  entries: Array<{
    trainingType: "PRE" | "FIELD";
    date: string;        // YYYY-MM-DD
    attendance: string;  // 출석/결석/지각/조퇴
    hours: string;       // "4H"
    guidance: string;    // Y/N
    task: string;
    performanceLabel: string;
    performanceTime: string;
    coaching: string;
  }>;
  signatures: SignatureSet;
}) {
  const { traineeName, companyName, preTrainingPeriod, fieldTrainingPeriod, entries, signatures } = params;

  let prevType = "";
  const mappedEntries = entries.map(e => {
    const display = e.trainingType !== prevType
      ? (e.trainingType === "PRE" ? "사전훈련" : "현장훈련") : "〃";
    prevType = e.trainingType;
    const [y, m, d] = e.date.split("-");
    return {
      trainingTypeDisplay: display,
      dateY:  y ? `${y}년` : "",
      dateMD: m && d ? `${Number(m)}/${Number(d)}` : "",
      attendance: e.attendance,
      hours: e.hours,
      guidance: e.guidance,
      task: e.task,
      performanceLabel: e.performanceLabel,
      performanceTime: e.performanceTime,
      coaching: e.coaching,
    };
  });

  return {
    traineeName, companyName,
    preTrainingPeriod, fieldTrainingPeriod,
    entries: mappedEntries,
    signatures: {
      govAgent:       { imageUrl: signatures.govAgentImageUrl       || null, name: signatures.govAgentName       || "" },
      companyManager: { imageUrl: signatures.companyManagerImageUrl || null, name: signatures.companyManagerName || "" },
      coach:          { imageUrl: signatures.coachImageUrl          || null, name: signatures.coachName          || "" },
    },
  };
}

// ─────────────────────────────────────────────────────────
// ③ 훈련생 종합평가 (trainee-final-eval)
// beforeRender: scores/comments → sections/총점 자동 계산
// 서명: coach(직무지도원), agencyAgent(위탁기관 담당자)
// ─────────────────────────────────────────────────────────
export function buildTraineeFinalEvalData(params: {
  traineeName: string;
  companyName: string;
  prePeriod: string;    // "2026.01.05 ~ 2026.01.05"
  fieldPeriod: string;  // "2026.01.06 ~ 2026.05.31"
  scores: {
    WORK_ATTITUDE:    Array<{ initial: number|string; final: number|string }>;
    INTERPERSONAL:    Array<{ initial: number|string; final: number|string }>;
    WORK_STYLE:       Array<{ initial: number|string; final: number|string }>;
    WORK_PERFORMANCE: Array<{ initial: number|string; final: number|string }>;
  };
  comments: {
    WORK_ATTITUDE?:    string;
    INTERPERSONAL?:    string;
    WORK_STYLE?:       string;
    WORK_PERFORMANCE?: string;
  };
  signatures: SignatureSet;
}) {
  const { traineeName, companyName, prePeriod, fieldPeriod, scores, comments, signatures } = params;
  return {
    traineeName, companyName,
    prePeriod, fieldPeriod,
    scores, comments,
    signatures: {
      coach:       { imageUrl: signatures.coachImageUrl    || null, name: signatures.coachName       || "" },
      agencyAgent: { imageUrl: signatures.govAgentImageUrl || null, name: signatures.govAgentName    || "" }, // 위탁기관 = 에이전시 관리자
    },
  };
}

// ─────────────────────────────────────────────────────────
// ④ 적응지도 일지 (adaptation-daily-log)
// beforeRender: entries 자동 생성 또는 직접 전달
// 서명: coach(직무지도원), govAgent(위탁기관 담당자)
// ─────────────────────────────────────────────────────────
export function buildAdaptationDailyLogData(params: {
  traineeName: string;
  companyName: string;
  periodStart: string;  // YYYY-MM-DD (beforeRender가 포맷 변환)
  periodEnd: string;
  defaultWorkTime?: string;  // "09:00~13:00"
  entries: Array<{
    date: string;          // YYYY-MM-DD
    attendance: string;    // 출석/결석/지각/조퇴
    workTime: string;      // "09:00~13:00"
    guidance: string;      // Y/N
    task: string;
    performanceLabel: string;
    performanceTime: string;
    coaching: string;
  }>;
  issues?: string;  // 특이사항
  signatures: SignatureSet;
}) {
  const { traineeName, companyName, periodStart, periodEnd, entries, issues, signatures, defaultWorkTime } = params;

  // beforeRender가 dateMD 포맷 자동 변환하므로 dateISO만 전달
  const mappedEntries = entries.map(e => {
    const [, m, d] = e.date.split("-");
    return {
      dateISO: e.date,
      dateMD: m && d ? `${m}/${d}` : "",
      attendance: e.attendance,
      workTime: e.workTime,
      guidance: e.guidance,
      task: e.task,
      performanceLabel: e.performanceLabel,
      performanceTime: e.performanceTime,
      coaching: e.coaching,
    };
  });

  return {
    traineeName, companyName,
    periodStart, periodEnd,
    defaultWorkTime: defaultWorkTime || "",
    entries: mappedEntries,
    issues: issues || "",
    signatures: {
      coach:    { imageUrl: signatures.coachImageUrl    || null, name: signatures.coachName    || "" },
      govAgent: { imageUrl: signatures.govAgentImageUrl || null, name: signatures.govAgentName || "" },
    },
  };
}

// ─────────────────────────────────────────────────────────
// ⑤ 적응지도 종합평가 (adaptation-final-eval)
// beforeRender: sections/총점 자동 계산
// 서명: coach(직무지도원), agencyAgent(위탁기관 담당자)
// ─────────────────────────────────────────────────────────
export function buildAdaptationFinalEvalData(params: {
  traineeName: string;
  companyName: string;
  periodStart: string;  // YYYY-MM-DD
  periodEnd: string;
  scores: {
    WORK_ATTITUDE:    Array<{ initial: number|string; final: number|string }>;
    INTERPERSONAL:    Array<{ initial: number|string; final: number|string }>;
    WORK_STYLE:       Array<{ initial: number|string; final: number|string }>;
    WORK_PERFORMANCE: Array<{ initial: number|string; final: number|string }>;
  };
  comments: {
    WORK_ATTITUDE?:    string;
    INTERPERSONAL?:    string;
    WORK_STYLE?:       string;
    WORK_PERFORMANCE?: string;
  };
  signatures: SignatureSet;
}) {
  const { traineeName, companyName, periodStart, periodEnd, scores, comments, signatures } = params;
  return {
    traineeName, companyName,
    periodStart, periodEnd,
    scores, comments,
    signatures: {
      coach:       { imageUrl: signatures.coachImageUrl    || null, name: signatures.coachName    || "" },
      agencyAgent: { imageUrl: signatures.govAgentImageUrl || null, name: signatures.govAgentName || "" },
    },
  };
}

// ── AWS SES 이메일 발송 ───────────────────────────────────
export async function sendEmailWithPdf(params: {
  from: string; to: string; subject: string; body: string;
  pdfBuffer: Buffer; fileName: string;
}): Promise<void> {
  const region    = process.env.AWS_SES_REGION     || "ap-northeast-2";
  const accessKey = process.env.AWS_SES_ACCESS_KEY;
  const secretKey = process.env.AWS_SES_SECRET_KEY;

  if (!accessKey || !secretKey) throw new Error("AWS SES 환경변수가 설정되지 않았습니다.");

  const { SESClient, SendRawEmailCommand } = await import("@aws-sdk/client-ses");
  const client = new SESClient({ region, credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } });

  const boundary = `----=_Part_${Date.now()}`;
  const rawMessage = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(`<p>${params.body.replace(/\n/g,"<br>")}</p>`).toString("base64"),
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${params.fileName}"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${params.fileName}"`,
    ``,
    params.pdfBuffer.toString("base64"),
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  await client.send(new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(rawMessage) } }));
}
