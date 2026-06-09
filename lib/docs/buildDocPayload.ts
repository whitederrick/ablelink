// lib/docs/buildDocPayload.ts
// 문서 "제출(submit)" 전용 payload 빌더 — DocumentVersion.sourceData 스냅샷용.
// ⚠️ 안정성 위해 PDF 생성부(/worker/docs/generate)와는 분리(독립 사본)한다.
//    generate 의 검증된 payload 로직을 그대로 복사한 것이며, generate 는 절대 건드리지 않음.
//    generate 의 payload 규칙이 바뀌면 이 파일도 수동으로 맞춰야 한다(렌더러는 공용).

export const runtime = "nodejs";

import { prisma } from "@/lib/prisma";
import { buildDocFileName } from "@/lib/pdf/filename";
import { getKrHolidayDates } from "@/lib/krHolidays";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { isPayrollPending } from "@/lib/attendance/payrollGate";

// 빌드 중 사용자에게 보여줄 검증 오류(라우트가 적절한 status/메시지로 변환).
export class DocPayloadError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(message: string, status = 400, extra?: Record<string, unknown>) {
    super(message);
    this.name = "DocPayloadError";
    this.status = status;
    this.extra = extra;
  }
}

// ── 유틸 ──────────────────────────────────────────────────────
function fmtHHMM(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}
function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number | null): string {
  if (!n) return "";
  return ({ 1: "매우못함", 2: "못함", 3: "보통", 4: "잘함", 5: "매우잘함" } as any)[n] || String(n);
}

const ALLOWED_IMG_HOST = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname; } catch { return ""; }
})();

// 서명 이미지 URL → base64 변환
async function toBase64DataUri(url?: string | null): Promise<string | undefined> {
  if (!url || !url.startsWith("http")) return url || undefined;
  try {
    const host = new URL(url).hostname;
    if (ALLOWED_IMG_HOST && host !== ALLOWED_IMG_HOST) return undefined;
  } catch { return undefined; }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    const mime = res.headers.get("content-type") || "image/png";
    if (!mime.startsWith("image/")) return undefined;
    return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch { return undefined; }
}

export interface BuildDocOptions {
  workerId: bigint;
  docType: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  traineeId?: string | number | bigint | null;
  companyManagerSignToken?: string | null;
}

export interface DocPayloadMeta {
  assignmentId: bigint;
  siteId: bigint;
  workerId: bigint;
  traineeId: bigint | null;
  traineeName: string | null;
  companyName: string;
  workerName: string;
  start: string;
  end: string;
}

export interface DocPayloadResult {
  payload: any;
  fileName: string;
  meta: DocPayloadMeta;
}

/**
 * docType별 공식문서 payload + 파일명 빌드.
 * 데이터 없음/미확정 등은 DocPayloadError 로 throw.
 */
export async function buildDocPayload(opts: BuildDocOptions): Promise<DocPayloadResult> {
  const { workerId, docType, periodStart, periodEnd, companyManagerSignToken } = opts;
  const traineeIdBig = opts.traineeId != null && String(opts.traineeId).trim() !== ""
    ? BigInt(opts.traineeId as any) : null;

  if (!docType) throw new DocPayloadError("문서 종류를 선택해주세요.");

  const user = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { workerName: true, phoneNumber: true, signatureUrl: true, loginId: true },
  });

  const assignment = await prisma.siteAssignment.findFirst({
    where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
    include: { site: true },
    orderBy: { assignedAt: "desc" },
  });

  if (!assignment?.site) throw new DocPayloadError("배정된 현장이 없습니다.");

  const site = assignment.site;
  const start = periodStart || new Date().toISOString().slice(0, 10);
  const end   = periodEnd   || new Date().toISOString().slice(0, 10);

  // 일지 PDF용 근무형태 고정 시간값 — 단일 출처
  const docTimes = dailyDocTimes(
    (assignment as any).workType,
    (assignment as any).commuteGuidanceIncluded,
    (assignment as any).customWorkStart,
    (assignment as any).customWorkEnd,
  );

  // ── 사업체담당자 즉석 서명 확인 ──
  let companyManagerSignatureUrl: string | null = null;
  let companyManagerSignerName = "";
  if (companyManagerSignToken) {
    const tokenRec = await prisma.siteSignToken.findUnique({
      where: { token: companyManagerSignToken },
      select: { signatureUrl: true, usedAt: true, signRole: true, signerName: true },
    });
    if (tokenRec?.usedAt && tokenRec.signRole === "company_manager") {
      companyManagerSignatureUrl = tokenRec.signatureUrl;
      companyManagerSignerName   = tokenRec.signerName || "";
    }
  }
  if (!companyManagerSignatureUrl) {
    const recentToken = await prisma.siteSignToken.findFirst({
      where: {
        assignmentId: assignment.id,
        periodStart:  start,
        periodEnd:    end,
        signRole:     "company_manager",
        usedAt:       { not: null },
      },
      orderBy: { usedAt: "desc" },
    });
    if (recentToken) {
      companyManagerSignatureUrl = recentToken.signatureUrl;
      companyManagerSignerName   = recentToken.signerName || "";
    }
  }

  const [workerImg, companyImg] = await Promise.all([
    toBase64DataUri(user?.signatureUrl),
    toBase64DataUri(companyManagerSignatureUrl),
  ]);

  const sigs = {
    worker:          { name: user?.workerName || "",        imageUrl: workerImg },
    govAgent:       { name: "",                          imageUrl: undefined as string | undefined },
    companyManager: { name: companyManagerSignerName,    imageUrl: companyImg },
    agencyAgent:    { name: "",                          imageUrl: undefined as string | undefined },
  };

  let payload: any;
  let fileName: string;
  let traineeName: string | null = null;

  if (docType === "ATTENDANCE_SHEET") {
    const attendances = await prisma.dailyAttendance.findMany({
      where: { workerId, workDate: { gte: start, lte: end } },
      include: { logs: { select: { time1on1: true, timeGroup: true, extTime1on1: true, extTimeGroup: true } } },
      orderBy: { workDate: "asc" },
    });

    const entries = attendances.map(a => {
      const pending = isPayrollPending({
        actualStartTime: a.actualStartTime ?? null,
        payrollConfirmedAt: a.payrollConfirmedAt ?? null,
        workType: (assignment as any).workType ?? null,
        commuteGuidanceIncluded: (assignment as any).commuteGuidanceIncluded ?? null,
        customWorkStart: (assignment as any).customWorkStart ?? null,
        customWorkEnd: (assignment as any).customWorkEnd ?? null,
      });
      return {
        date: a.workDate,
        start: pending ? "" : (a.startTime ? fmtHHMM(a.startTime) : ""),
        end:   pending ? "" : (a.endTime   ? fmtHHMM(a.endTime)   : ""),
        pending,
        hours: pending ? 0 : a.logs.reduce((s, l) => s + Number(l.time1on1) + Number(l.extTime1on1), 0),
        multiHours: pending ? 0 : a.logs.reduce((s, l) => s + Number(l.timeGroup) + Number(l.extTimeGroup), 0),
      };
    });

    const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0);
    const oneToMany  = entries.reduce((s, e) => s + Number(e.multiHours), 0);

    payload = {
      workerName: user?.workerName || "",
      workerPhone: user?.phoneNumber || user?.loginId || "",
      companyName: site.companyName,
      periodStartYMD: fmtDot(start),
      periodEndYMD:   fmtDot(end),
      totalDays: entries.length,
      totalHours,
      weeklyHolidayCount: 0,
      monthlyLeaveCount: 0,
      allowanceTotalWon: "0",
      oneToOneHours: totalHours - oneToMany,
      oneToManyHours: oneToMany,
      otOneToOneHours: 0,
      otOneToManyHours: 0,
      entries,
      signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
    };
    fileName = buildDocFileName("ATTENDANCE_SHEET", { companyName: site.companyName, start, end });

  } else if (docType === "TRAINING_DAILY_LOG") {
    if (!traineeIdBig) throw new DocPayloadError("훈련생을 선택해주세요.");
    const trainee = await prisma.trainee.findUnique({ where: { id: traineeIdBig }, select: { name: true } });
    traineeName = trainee?.name || "";
    const logs = await prisma.traineeLog.findMany({
      where: {
        writerId: workerId, traineeId: traineeIdBig,
        trainingType: { in: ["PRE", "FIELD"] },
        attendance: { workDate: { gte: start, lte: end } },
      },
      include: { attendance: true, tasks: true },
      orderBy: { attendance: { workDate: "asc" } },
    });

    const preStart = assignment.stepStart?.toISOString().slice(0, 10) || start;
    const siteHols = await prisma.siteHoliday.findMany({
      where: { assignmentId: assignment.id, countAsWorkday: false },
      select: { date: true },
    });
    const holidays = [...new Set([...getKrHolidayDates(preStart, end), ...siteHols.map(h => h.date)])];

    payload = {
      traineeName: trainee?.name || "",
      companyName: site.companyName,
      periodPreText:   fmtPeriod(assignment.stepStart?.toISOString().slice(0, 10) || start, start),
      periodFieldText: fmtPeriod(start, end),
      holidays,
      rows: logs.map(l => {
        const scoreText = scoreLabel(l.tasks[0]?.performanceScore as any);
        return {
          section: l.trainingType === "PRE" ? "PRE" : "FIELD",
          date: l.attendance.workDate,
          attendanceStatus: l.evaluation || "출석",
          trainingTime: docTimes.trainingTimeH,
          guidanceFlag: docTimes.guidanceYN,
          task: l.tasks[0]?.taskName || "",
          taskLevelMeasured: `${scoreText}\n(${docTimes.measTimeH})`,
          evalGuidance: l.content || "",
        };
      }),
      signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
    };
    fileName = buildDocFileName("TRAINING_DAILY_LOG", { traineeName: trainee?.name, companyName: site.companyName, start, end });

  } else if (docType === "TRAINEE_FINAL_EVAL") {
    if (!traineeIdBig) throw new DocPayloadError("훈련생을 선택해주세요.");
    const trainee = await prisma.trainee.findUnique({ where: { id: traineeIdBig }, select: { name: true } });
    traineeName = trainee?.name || "";
    const ev = await prisma.traineeEvaluation.findFirst({
      where: { traineeId: traineeIdBig, writerId: workerId, evalType: "TRAINING" },
      orderBy: { updatedAt: "desc" },
    });
    if (!ev) throw new DocPayloadError("종합평가를 먼저 작성해주세요.");
    if (!ev.isConfirmed) throw new DocPayloadError("종합평가를 최종 확정한 후 PDF를 생성할 수 있습니다.\n평가 페이지에서 '최종 확정' 버튼을 눌러주세요.", 400, { evalNotConfirmed: true });

    payload = {
      traineeName: trainee?.name || "",
      companyName: site.companyName,
      preTrainingStart:  assignment.stepStart?.toISOString().slice(0, 10) || start,
      preTrainingEnd:    start,
      fieldTrainingStart: start,
      fieldTrainingEnd:   end,
      scores:   (ev?.scores as any)   || {},
      comments: (ev?.comments as any) || {},
      signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
    };
    fileName = buildDocFileName("TRAINEE_FINAL_EVAL", { traineeName: trainee?.name, companyName: site.companyName, start, end });

  } else if (docType === "ADAPTATION_DAILY_LOG") {
    if (!traineeIdBig) throw new DocPayloadError("훈련생을 선택해주세요.");
    const trainee = await prisma.trainee.findUnique({ where: { id: traineeIdBig }, select: { name: true } });
    traineeName = trainee?.name || "";
    const logs = await prisma.traineeLog.findMany({
      where: {
        writerId: workerId, traineeId: traineeIdBig,
        trainingType: "ADAPTATION",
        attendance: { workDate: { gte: start, lte: end } },
      },
      include: { attendance: true, tasks: true },
      orderBy: { attendance: { workDate: "asc" } },
    });

    const siteHols = await prisma.siteHoliday.findMany({
      where: { assignmentId: assignment.id, countAsWorkday: false },
      select: { date: true },
    });
    const holidays = [...new Set([...getKrHolidayDates(start, end), ...siteHols.map(h => h.date)])];

    payload = {
      traineeName: trainee?.name || "",
      companyName: site.companyName,
      periodStart: start,
      periodEnd:   end,
      holidays,
      entries: logs.map(l => ({
        dateISO: l.attendance.workDate,
        attendance: l.evaluation || "출석",
        workTime: docTimes.workTimeRange,
        guidance: docTimes.guidanceYN,
        task: l.tasks[0]?.taskName || "",
        performanceLabel: scoreLabel(l.tasks[0]?.performanceScore as any),
        performanceTime: docTimes.measTimeH,
        coaching: l.content || "",
      })),
      signatures: { worker: sigs.worker, govAgent: sigs.govAgent },
    };
    fileName = buildDocFileName("ADAPTATION_DAILY_LOG", { traineeName: trainee?.name, companyName: site.companyName, start, end });

  } else if (docType === "ADAPTATION_FINAL_EVAL") {
    if (!traineeIdBig) throw new DocPayloadError("훈련생을 선택해주세요.");
    const trainee = await prisma.trainee.findUnique({ where: { id: traineeIdBig }, select: { name: true } });
    traineeName = trainee?.name || "";
    const ev = await prisma.traineeEvaluation.findFirst({
      where: { traineeId: traineeIdBig, writerId: workerId, evalType: "ADAPTATION" },
      orderBy: { updatedAt: "desc" },
    });
    if (!ev) throw new DocPayloadError("종합평가를 먼저 작성해주세요.");
    if (!ev.isConfirmed) throw new DocPayloadError("종합평가를 최종 확정한 후 PDF를 생성할 수 있습니다.\n평가 페이지에서 '최종 확정' 버튼을 눌러주세요.", 400, { evalNotConfirmed: true });

    payload = {
      traineeName: trainee?.name || "",
      companyName: site.companyName,
      periodStart: start,
      periodEnd:   end,
      scores:   (ev?.scores as any)   || {},
      comments: (ev?.comments as any) || {},
      signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
    };
    fileName = buildDocFileName("ADAPTATION_FINAL_EVAL", { traineeName: trainee?.name, companyName: site.companyName, start, end });

  } else {
    throw new DocPayloadError(`지원하지 않는 문서: ${docType}`);
  }

  return {
    payload,
    fileName,
    meta: {
      assignmentId: assignment.id,
      siteId: site.id,
      workerId,
      traineeId: traineeIdBig,
      traineeName,
      companyName: site.companyName,
      workerName: user?.workerName || "",
      start,
      end,
    },
  };
}
