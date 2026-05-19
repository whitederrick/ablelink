// lib/pdfGenerator.ts
// jsreport API 호출하여 PDF 생성 + AWS SES 이메일 발송

const JSREPORT_URL = process.env.JSREPORT_URL || "http://localhost:5488";

export type DocType =
  | "attendance-sheet"
  | "training-daily-log"
  | "trainee-final-eval"
  | "adaptation-daily-log"
  | "adaptation-final-eval";

export const DOC_LABELS: Record<DocType, string> = {
  "attendance-sheet":     "출근부",
  "training-daily-log":   "지원고용 훈련일지",
  "trainee-final-eval":   "훈련생 종합 평가기록부",
  "adaptation-daily-log": "취업 후 적응지도 일지",
  "adaptation-final-eval":"적응지도 종합 평가기록부",
};

// ── PDF 생성 ─────────────────────────────────────────────
export async function generatePdf(
  template: DocType,
  data: Record<string, any>
): Promise<Buffer> {
  const res = await fetch(`${JSREPORT_URL}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      template: { name: template },
      data,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`jsreport 오류 (${res.status}): ${errText}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ── 출근부 데이터 생성 ────────────────────────────────────
export function buildAttendanceSheetData(params: {
  coachName: string;
  coachPhone: string;
  companyName: string;
  periodStart: string;
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
  signatureUrl?: string | null;
}) {
  const { coachName, coachPhone, companyName, periodStart, periodEnd, attendances, signatureUrl } = params;
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const startDate = new Date(periodStart);
  const endDate = new Date(periodEnd);

  const weeks: any[] = [];
  let current = new Date(startDate);
  const startDay = current.getDay();
  current.setDate(current.getDate() - ((startDay + 6) % 7));

  while (current <= endDate) {
    const week: any = { days: {} };
    for (let i = 0; i < 7; i++) {
      const dayKey = DAYS[current.getDay()];
      const ymd = current.toISOString().slice(0, 10);
      const att = attendances.find(a => a.workDate === ymd);
      if (current >= startDate && current <= endDate && att?.startTime) {
        week.days[dayKey] = {
          date: `${current.getMonth() + 1}/${current.getDate()}`,
          start: att.startTime,
          end: att.endTime || "",
          hours: att.time1on1 + att.extTime1on1,
          multiHours: att.timeGroup + att.extTimeGroup,
        };
      } else {
        week.days[dayKey] = { date: null };
      }
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    if (current > endDate) break;
  }

  const workDays = attendances.filter(a => a.startTime).length;
  const totalHours = attendances.reduce((s, a) => s + a.time1on1 + a.timeGroup + a.extTime1on1 + a.extTimeGroup, 0);
  const now = new Date();

  return {
    coachName, coachPhone, companyName,
    periodStartYMD: periodStart.replace(/-/g, " . "),
    periodEndYMD: periodEnd.replace(/-/g, " . "),
    totalDays: workDays,
    totalHours,
    weeklyHolidayCount: 0,
    monthlyLeaveCount: 0,
    allowanceTotalWon: "0",
    oneToOneHours: attendances.reduce((s, a) => s + a.time1on1 + a.extTime1on1, 0),
    oneToManyHours: attendances.reduce((s, a) => s + a.timeGroup + a.extTimeGroup, 0),
    otOneToOneHours: 0,
    otOneToManyHours: 0,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    weeks,
    signatureUrl: signatureUrl || null,
  };
}

// ── AWS SES 이메일 발송 ───────────────────────────────────
export async function sendEmailWithPdf(params: {
  from: string;       // 직무지도원 등록 이메일 (발신자)
  to: string;         // 에이전시 담당자 이메일 (수신자)
  subject: string;
  body: string;
  pdfBuffer: Buffer;
  fileName: string;
}): Promise<void> {
  const region = process.env.AWS_SES_REGION || "ap-northeast-2";
  const accessKey = process.env.AWS_SES_ACCESS_KEY;
  const secretKey = process.env.AWS_SES_SECRET_KEY;
  const defaultFrom = process.env.EMAIL_FROM || "AbleLink <noreply@able-link.co.kr>";

  if (!accessKey || !secretKey) {
    throw new Error("AWS SES 환경변수가 설정되지 않았습니다.");
  }

  const { SESClient, SendRawEmailCommand } = await import("@aws-sdk/client-ses");

  const client = new SESClient({
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const boundary = `----=_Part_${Date.now()}`;
  const base64Pdf = params.pdfBuffer.toString("base64");
  const htmlBody = params.body.replace(/\n/g, "<br>");

  // 발신자: 직무지도원 이메일이 있으면 사용, 없으면 기본값
  const fromAddr = params.from || defaultFrom;

  const rawMessage = [
    `From: ${fromAddr}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(`<p>${htmlBody}</p>`).toString("base64"),
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${params.fileName}"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${params.fileName}"`,
    ``,
    base64Pdf,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  await client.send(new SendRawEmailCommand({
    RawMessage: { Data: Buffer.from(rawMessage) },
  }));
}
