// lib/docs/buildDocPayload.ts
// 문서 "제출(submit)" 전용 payload 빌더 — DocumentVersion.sourceData 스냅샷용.
// ⚠️ 안정성 위해 PDF 생성부(/worker/docs/generate)와는 분리(독립 사본)한다.
//    generate 의 검증된 payload 로직을 그대로 복사한 것이며, generate 는 절대 건드리지 않음.
//    generate 의 payload 규칙이 바뀌면 이 파일도 수동으로 맞춰야 한다(렌더러는 공용).

export const runtime = "nodejs";

import { prisma } from "@/lib/prisma";
import { buildDocFileName } from "@/lib/pdf/filename";
import { getKrHolidayDates } from "@/lib/krHolidays";
import { getKstDateString } from "@/lib/time";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import { findTraineeAtSiteInPeriod } from "@/lib/docs/traineeSiteGuard";
import { PDF_TO_PRISMA_DOCTYPE } from "@/lib/docs/docTypeMap";
import { sigRequirement } from "@/lib/docs/requiredSignatures";
import { imageToDataUri } from "@/lib/signatureImage";

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
function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number | null): string {
  if (!n) return "";
  return ({ 1: "매우못함", 2: "못함", 3: "보통", 4: "잘함", 5: "매우잘함" } as any)[n] || String(n);
}

export interface BuildDocOptions {
  workerId: bigint;
  docType: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  traineeId?: string | number | bigint | null;
  companyManagerSignToken?: string | null;
  /** 멀티현장: 선택 배정(assignmentId). 주면 그 현장으로 문서 생성(소유 검증). 없으면 최신 1건 폴백. */
  assignmentId?: string | number | bigint | null;
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

  let selAssignmentId: bigint | null = null;
  try { selAssignmentId = opts.assignmentId != null && String(opts.assignmentId).trim() !== "" ? BigInt(opts.assignmentId as any) : null; } catch { selAssignmentId = null; }

  let assignment = await prisma.siteAssignment.findFirst({
    where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] }, ...(selAssignmentId != null ? { id: selAssignmentId } : {}) },
    include: { site: true },
    orderBy: { assignedAt: "desc" },
  });

  // C3: 선택 쿠키(activeAssignment)의 id가 종료(ENDED)·무효라 매칭에 실패하면 최신 활성 배정으로 폴백.
  //  (쿠키는 90일 TTL이라 배정 종료 후에도 남아, 폴백이 없으면 모든 문서 화면이 '배정 없음'으로 전면 차단됐다.)
  if (!assignment && selAssignmentId != null) {
    assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      include: { site: true },
      orderBy: { assignedAt: "desc" },
    });
  }

  if (!assignment?.site) throw new DocPayloadError("배정된 현장이 없습니다.");

  const site = assignment.site;
  const start = periodStart || getKstDateString();
  const end   = periodEnd   || getKstDateString();

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
    imageToDataUri(user?.signatureUrl),
    imageToDataUri(companyManagerSignatureUrl),
  ]);

  const sigs = {
    worker:          { name: user?.workerName || "",        imageUrl: workerImg },
    govAgent:       { name: "",                          imageUrl: undefined as string | undefined },
    companyManager: { name: companyManagerSignerName,    imageUrl: companyImg },
    agencyAgent:    { name: "",                          imageUrl: undefined as string | undefined },
  };

  // ── 제출 게이트(직무지도원→매니저): 필수 서명 미등록 시 제출 차단 + 경고 ──
  //   매니저 서명은 제출 단계에선 검사하지 않음(이후 일지 관리 sign 액션에서 들어감).
  const req = sigRequirement(PDF_TO_PRISMA_DOCTYPE[docType] ?? docType);
  if (req.worker && !workerImg) {
    throw new DocPayloadError(
      "직무지도원 서명이 등록되어 있지 않습니다.\n프로필에서 서명을 먼저 등록한 뒤 제출해주세요.",
      400, { missingSignature: "worker" },
    );
  }
  if (req.companyManager && !companyImg) {
    throw new DocPayloadError(
      "사업체 담당자 서명이 필요합니다.\n사업체 담당자에게 서명을 받은 뒤 제출해주세요.",
      400, { missingSignature: "companyManager" },
    );
  }

  let payload: any;
  let fileName: string;
  let traineeName: string | null = null;

  if (docType === "ATTENDANCE_SHEET") {
    ({ payload, fileName } = await buildAttendanceSheetPayload({
      workerId,
      start, end,
      siteId: site.id,
      companyName: site.companyName,
      workerName: user?.workerName || "",
      workerPhone: user?.phoneNumber || user?.loginId || "",
      fallbackAssignment: {
        workType: (assignment as any).workType ?? null,
        commuteGuidanceIncluded: (assignment as any).commuteGuidanceIncluded ?? null,
        customWorkStart: (assignment as any).customWorkStart ?? null,
        customWorkEnd: (assignment as any).customWorkEnd ?? null,
        attendanceButtonExempt: (assignment as any).attendanceButtonExempt ?? null,
      },
      signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
    }));

  } else if (docType === "TRAINING_DAILY_LOG") {
    if (!traineeIdBig) throw new DocPayloadError("훈련생을 선택해주세요.");
    const trainee = await findTraineeAtSiteInPeriod(traineeIdBig, site.id, start, end); // IDOR 방지: 배정 현장+기간 재적 훈련생만
    if (!trainee) throw new DocPayloadError("해당 기간에 이 현장 소속이 아닌 훈련생입니다.");
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
    const trainee = await findTraineeAtSiteInPeriod(traineeIdBig, site.id, start, end); // IDOR 방지: 배정 현장+기간 재적 훈련생만
    if (!trainee) throw new DocPayloadError("해당 기간에 이 현장 소속이 아닌 훈련생입니다.");
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
    const trainee = await findTraineeAtSiteInPeriod(traineeIdBig, site.id, start, end); // IDOR 방지: 배정 현장+기간 재적 훈련생만
    if (!trainee) throw new DocPayloadError("해당 기간에 이 현장 소속이 아닌 훈련생입니다.");
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
    const trainee = await findTraineeAtSiteInPeriod(traineeIdBig, site.id, start, end); // IDOR 방지: 배정 현장+기간 재적 훈련생만
    if (!trainee) throw new DocPayloadError("해당 기간에 이 현장 소속이 아닌 훈련생입니다.");
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
