// app/api/admin/audit-package/route.ts
// 감사 대응 서류 패키지 — STANDARD+
// GET /api/admin/audit-package?workerId=X&periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { prisma } from "@/lib/prisma";
import { renderPdfToBuffer, type DocumentType } from "@/lib/pdf";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { isPayrollPending } from "@/lib/attendance/payrollGate";
import { overtimeMinutesForDay } from "@/lib/attendance/overtime";
import JSZip from "jszip";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtHHMM(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}
function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number | null) {
  if (!n) return "";
  return ({ 1: "매우못함", 2: "못함", 3: "보통", 4: "잘함", 5: "매우잘함" } as any)[n] || String(n);
}
const ALLOWED_IMG_HOST = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname; } catch { return ""; }
})();

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
function safeFilename(s: string) { return s.replace(/[\\/:*?"<>|]/g, "_"); }

// ─── route ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const scope    = await requireManagerSession(request);
    const agencyId = scope.agencyId;

    const planCheck = await checkAgencyPlanAccess(agencyId, "AUDIT_PACKAGE");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const workerIdRaw = searchParams.get("workerId");
    const periodStart = searchParams.get("periodStart") || new Date().toISOString().slice(0, 10);
    const periodEnd   = searchParams.get("periodEnd")   || periodStart;

    if (!workerIdRaw) {
      return NextResponse.json({ success: false, message: "workerId 필요" }, { status: 400 });
    }

    const workerId = BigInt(workerIdRaw);

    // 직무지도원 + 배정 조회
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });
    const assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, agencyId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      include: { site: true },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment?.site) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 400 });
    }

    const site  = assignment.site;
    const docTimes = dailyDocTimes((assignment as any).workType, (assignment as any).commuteGuidanceIncluded, (assignment as any).customWorkStart, (assignment as any).customWorkEnd);
    const start = periodStart;
    const end   = periodEnd;

    // 서명 이미지 로드
    const workerImg = await toBase64DataUri(user?.signatureUrl);
    const sigs = {
      worker:          { name: user?.workerName || "", imageUrl: workerImg },
      govAgent:       { name: "", imageUrl: undefined },
      agencyAgent:    { name: "", imageUrl: undefined },
      companyManager: { name: "", imageUrl: undefined },
    };

    // 출근부용 데이터
    const attendances = await prisma.dailyAttendance.findMany({
      where: { workerId, workDate: { gte: start, lte: end } },
      include: {
        logs: { select: { extTime1on1: true, extTimeGroup: true } },
        assignment: { select: { workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true } },
      },
      orderBy: { workDate: "asc" },
    });

    // 이 현장의 훈련생
    const trainees = await prisma.trainee.findMany({
      where: { currentSiteId: site.id },
      select: { id: true, name: true },
    });

    // ZIP 생성
    const zip = new JSZip();

    // 1) 출근부
    {
      // 1:1 vs 1:多 = 현장 배정 훈련생 수로 택1. 일별 = 근무형태 인정시간. 연장 = 퇴근시각 자동/면제는 수동.
      const traineeCount = await prisma.traineePlacement.count({
        where: {
          siteId: site.id, status: "ACTIVE",
          startDate: { lte: new Date(end + "T23:59:59+09:00") },
          OR: [{ endDate: null }, { endDate: { gte: new Date(start + "T00:00:00+09:00") } }],
        },
      });
      const isMulti = traineeCount >= 2;
      const recognizedHours = docTimes.measHours;
      const entries = attendances.map(a => {
        const pending = isPayrollPending({
          actualStartTime: a.actualStartTime ?? null,
          actualEndTime: a.actualEndTime ?? null,
          payrollConfirmedAt: a.payrollConfirmedAt ?? null,
          workType: a.assignment?.workType ?? null,
          commuteGuidanceIncluded: a.assignment?.commuteGuidanceIncluded ?? null,
          customWorkStart: a.assignment?.customWorkStart ?? null,
          customWorkEnd: a.assignment?.customWorkEnd ?? null,
          exempt: a.assignment?.attendanceButtonExempt ?? false,
        });
        const baseH = pending ? 0 : recognizedHours;
        const extH  = pending ? 0 : +(overtimeMinutesForDay({
          workType: a.assignment?.workType,
          exempt: a.assignment?.attendanceButtonExempt,
          actualEndTime: a.actualEndTime,
          commuteGuidanceIncluded: a.assignment?.commuteGuidanceIncluded,
          customWorkStart: a.assignment?.customWorkStart,
          customWorkEnd: a.assignment?.customWorkEnd,
          manualExtHours: a.logs.reduce((s, l) => s + Number(l.extTime1on1) + Number(l.extTimeGroup), 0),
        }) / 60).toFixed(2);
        return {
          date: a.workDate,
          start: pending ? "" : (a.startTime ? fmtHHMM(a.startTime) : ""),
          end:   pending ? "" : (a.endTime   ? fmtHHMM(a.endTime)   : ""),
          pending,
          hours: baseH,
          multiHours: isMulti ? baseH : 0,
          _ext: extH,
        };
      });
      const baseTotal = entries.reduce((s, e) => s + Number(e.hours), 0);
      const extTotal  = entries.reduce((s, e) => s + Number(e._ext), 0);
      const payload = {
        workerName:  user?.workerName || "", workerPhone: user?.phoneNumber || user?.loginId || "",
        companyName: site.companyName, periodStartYMD: fmtDot(start), periodEndYMD: fmtDot(end),
        totalDays: entries.length, totalHours: baseTotal + extTotal, weeklyHolidayCount: 0, monthlyLeaveCount: 0,
        allowanceTotalWon: "0",
        oneToOneHours: isMulti ? 0 : baseTotal, oneToManyHours: isMulti ? baseTotal : 0,
        otOneToOneHours: isMulti ? 0 : extTotal, otOneToManyHours: isMulti ? extTotal : 0,
        entries: entries.map(({ _ext, ...e }) => e),
        signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
      };
      const buf = await renderPdfToBuffer({ documentType: "ATTENDANCE_SHEET" as DocumentType, payload });
      zip.file("출근부.pdf", buf);
    }

    // 2) 훈련생별 문서 — DB 쿼리를 모든 훈련생에 걸쳐 병렬 실행
    await Promise.all(trainees.map(async (trainee) => {
      const tid    = trainee.id;
      const folder = zip.folder(safeFilename(`훈련생_${trainee.name}`))!;

      // 4개 쿼리 병렬
      const [trainingLogs, trainingEv, adaptLogs, adaptEv] = await Promise.all([
        prisma.traineeLog.findMany({
          where: { writerId: workerId, traineeId: tid, trainingType: { in: ["PRE", "FIELD"] }, attendance: { workDate: { gte: start, lte: end } } },
          include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
        }),
        prisma.traineeEvaluation.findFirst({
          where: { traineeId: tid, writerId: workerId, evalType: "TRAINING" }, orderBy: { updatedAt: "desc" },
        }),
        prisma.traineeLog.findMany({
          where: { writerId: workerId, traineeId: tid, trainingType: "ADAPTATION", attendance: { workDate: { gte: start, lte: end } } },
          include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
        }),
        prisma.traineeEvaluation.findFirst({
          where: { traineeId: tid, writerId: workerId, evalType: "ADAPTATION" }, orderBy: { updatedAt: "desc" },
        }),
      ]);

      // 훈련일지
      {
        const payload = {
          traineeName: trainee.name, companyName: site.companyName,
          periodPreText:   fmtPeriod(assignment.stepStart?.toISOString().slice(0, 10) || start, start),
          periodFieldText: fmtPeriod(start, end),
          rows: trainingLogs.map(l => ({
            section: l.trainingType === "PRE" ? "PRE" : "FIELD",
            date: l.attendance.workDate,
            attendanceStatus: l.evaluation || "출석",
            trainingTime: docTimes.trainingTimeH,
            guidanceFlag: docTimes.guidanceYN, task: l.tasks[0]?.taskName || "",
            taskLevelMeasured: `${scoreLabel(l.tasks[0]?.performanceScore)}\n(${docTimes.measTimeH})`,
            evalGuidance: l.content || "",
          })),
          signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
        };
        const buf = await renderPdfToBuffer({ documentType: "TRAINING_DAILY_LOG" as DocumentType, payload });
        folder.file("훈련일지.pdf", buf);
      }

      // 훈련생 종합평가
      {
        const payload = {
          traineeName: trainee.name, companyName: site.companyName,
          preTrainingStart: assignment.stepStart?.toISOString().slice(0, 10) || start,
          preTrainingEnd: start, fieldTrainingStart: start, fieldTrainingEnd: end,
          scores: (trainingEv?.scores as any) || {}, comments: (trainingEv?.comments as any) || {},
          signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
        };
        const buf = await renderPdfToBuffer({ documentType: "TRAINEE_FINAL_EVAL" as DocumentType, payload });
        folder.file("훈련생_종합평가.pdf", buf);
      }

      // 적응지도 일지
      {
        const payload = {
          traineeName: trainee.name, companyName: site.companyName, periodStart: start, periodEnd: end,
          entries: adaptLogs.map(l => ({
            dateISO: l.attendance.workDate, attendance: l.evaluation || "출석",
            workTime: docTimes.workTimeRange, guidance: docTimes.guidanceYN, task: l.tasks[0]?.taskName || "",
            performanceLabel: scoreLabel(l.tasks[0]?.performanceScore),
            performanceTime: docTimes.measTimeH, coaching: l.content || "",
          })),
          signatures: { worker: sigs.worker, govAgent: sigs.govAgent },
        };
        const buf = await renderPdfToBuffer({ documentType: "ADAPTATION_DAILY_LOG" as DocumentType, payload });
        folder.file("적응지도_일지.pdf", buf);
      }

      // 적응지도 종합평가
      {
        const payload = {
          traineeName: trainee.name, companyName: site.companyName,
          periodStart: start, periodEnd: end,
          scores: (adaptEv?.scores as any) || {}, comments: (adaptEv?.comments as any) || {},
          signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
        };
        const buf = await renderPdfToBuffer({ documentType: "ADAPTATION_FINAL_EVAL" as DocumentType, payload });
        folder.file("적응지도_종합평가.pdf", buf);
      }
    }));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    const workerName = safeFilename(user?.workerName || workerIdRaw);
    const filename  = `감사서류_${workerName}_${start}_${end}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type":        "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control":       "no-store",
      },
    });

  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[audit-package]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
