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
import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";
import JSZip from "jszip";
import { imageToDataUri } from "@/lib/signatureImage";
import { mapWithConcurrency } from "@/lib/concurrency";
import { logAccess } from "@/lib/accessLog";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtDot(s: string) { return s.replace(/-/g, "."); }
function fmtPeriod(s: string, e: string) { return `${fmtDot(s)} ~ ${fmtDot(e)}`; }
function scoreLabel(n?: number | null) {
  if (!n) return "";
  return ({ 1: "매우못함", 2: "못함", 3: "보통", 4: "잘함", 5: "매우잘함" } as any)[n] || String(n);
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

    // 에이전시 스코프 게이트 먼저 — 소속 기관 배정이 없으면 PII(성명·연락처·서명·계정)를 조회하기 전에 400.
    //  (심층방어: 타 기관 워커 요청 시 개인정보를 아예 fetch하지 않는다.)
    // ★10차#6: 멀티현장 워커도 '모든 현장' 서류를 담는다. 과거 findFirst로 최신 배정 1곳만 골라 다른 현장의
    //  출근부·훈련일지·평가가 공단 감사 ZIP에서 조용히 누락되던 문제 종결. 기간 내 배정을 전부 조회해 현장별로 묶는다.
    //  ENDED(종료) 포함 — 감사(공단 실사)는 통상 근무 종료 후 발생. agencyId 스코프 유지 → 타 기관 워커 PII 차단.
    const assignments = await prisma.siteAssignment.findMany({
      where: { workerId, agencyId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } },
      include: { site: true },
      orderBy: [{ endedAt: "desc" }, { assignedAt: "desc" }],
    });
    // 현장별 대표 배정(최신) — orderBy상 현장 첫 등장이 최신. 같은 현장 복수 배정은 대표 1건의 근무형태/시각으로
    //  출근부·일지를 렌더(단일현장 기존 동작과 동일). 현장 간에는 각자 대표 배정으로 독립 렌더.
    type Entry = { site: NonNullable<(typeof assignments)[number]["site"]>; assignment: (typeof assignments)[number] };
    const bySite = new Map<string, Entry>();
    for (const a of assignments) {
      if (!a.site) continue;
      const k = a.site.id.toString();
      if (!bySite.has(k)) bySite.set(k, { site: a.site, assignment: a });
    }
    const siteEntries = [...bySite.values()];
    if (siteEntries.length === 0) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 400 });
    }
    const multiSite = siteEntries.length > 1;

    // 게이트 통과 후 직무지도원 PII 조회 (워커 단위 — 현장 무관)
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { workerName: true, phoneNumber: true, signatureUrl: true, loginId: true },
    });

    const start = periodStart;
    const end   = periodEnd;
    // TraineePlacement 기간겹침(startDate<=끝 && (endDate null||endDate>=시작)) 산정용 경계.
    const startBound = new Date(periodStart + "T00:00:00+09:00");
    const endBound   = new Date(periodEnd + "T23:59:59+09:00");

    // 서명 이미지 로드 (워커 단위 — 현장 무관)
    const workerImg = await imageToDataUri(user?.signatureUrl);
    const sigs = {
      worker:          { name: user?.workerName || "", imageUrl: workerImg },
      govAgent:       { name: "", imageUrl: undefined },
      agencyAgent:    { name: "", imageUrl: undefined },
      companyManager: { name: "", imageUrl: undefined },
    };

    // ZIP 생성
    const zip = new JSZip();

    // 한 현장의 출근부 + 훈련생 문서를 target(루트 또는 현장 폴더)에 생성.
    const buildForSite = async (target: JSZip, site: Entry["site"], assignment: Entry["assignment"]) => {
      const docTimes = dailyDocTimes(assignment.workType, assignment.commuteGuidanceIncluded, assignment.customWorkStart, assignment.customWorkEnd);

      // 1) 출근부
      {
        const { payload } = await buildAttendanceSheetPayload({
          workerId,
          start, end,
          siteId: site.id,
          companyName: site.companyName,
          workerName: user?.workerName || "",
          workerPhone: user?.phoneNumber || user?.loginId || "",
          fallbackAssignment: {
            workType: assignment.workType ?? null,
            commuteGuidanceIncluded: assignment.commuteGuidanceIncluded ?? null,
            customWorkStart: assignment.customWorkStart ?? null,
            customWorkEnd: assignment.customWorkEnd ?? null,
            attendanceButtonExempt: assignment.attendanceButtonExempt ?? null,
          },
          signatures: { govAgent: sigs.govAgent, companyManager: sigs.companyManager, worker: sigs.worker },
        });
        const buf = await renderPdfToBuffer({ documentType: "ATTENDANCE_SHEET" as DocumentType, payload });
        target.file("출근부.pdf", buf);
      }

      // 이 현장에 '조회 기간 내' 배치됐던 훈련생 — #10: currentSiteId(현재 재직)로 뽑으면 기간 중 있었으나
      //  이후 이동/이탈한 훈련생이 누락되고, 기간엔 없던 현재 재적자는 빈 문서가 만들어진다.
      const placements = await prisma.traineePlacement.findMany({
        where: {
          siteId: site.id,
          startDate: { lte: endBound },
          OR: [{ endDate: null }, { endDate: { gte: startBound } }],
        },
        select: { trainee: { select: { id: true, name: true } } },
      });
      const trainees = [...new Map(placements.map((p) => [String(p.trainee.id), p.trainee])).values()];

      // 2) 훈련생별 문서 — DB 쿼리·PDF 렌더를 병렬화하되 동시성 상한(무제한 fan-out 시 커넥션/메모리 폭주 방지)
      await mapWithConcurrency(trainees, 4, async (trainee) => {
        const tid    = trainee.id;
        const folder = target.folder(safeFilename(`훈련생_${trainee.name}`))!;

        // 4개 쿼리 병렬
        const [trainingLogs, trainingEv, adaptLogs, adaptEv] = await Promise.all([
          prisma.traineeLog.findMany({
            where: { writerId: workerId, traineeId: tid, trainingType: { in: ["PRE", "FIELD"] }, attendance: { siteId: site.id, workDate: { gte: start, lte: end } } },
            include: { attendance: true, tasks: true }, orderBy: { attendance: { workDate: "asc" } },
          }),
          prisma.traineeEvaluation.findFirst({
            where: { traineeId: tid, writerId: workerId, evalType: "TRAINING" }, orderBy: { updatedAt: "desc" },
          }),
          prisma.traineeLog.findMany({
            where: { writerId: workerId, traineeId: tid, trainingType: "ADAPTATION", attendance: { siteId: site.id, workDate: { gte: start, lte: end } } },
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
            scores: (trainingEv?.scores as Record<string, unknown>) || {}, comments: (trainingEv?.comments as Record<string, unknown>) || {},
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
            scores: (adaptEv?.scores as Record<string, unknown>) || {}, comments: (adaptEv?.comments as Record<string, unknown>) || {},
            signatures: { worker: sigs.worker, agencyAgent: sigs.agencyAgent },
          };
          const buf = await renderPdfToBuffer({ documentType: "ADAPTATION_FINAL_EVAL" as DocumentType, payload });
          folder.file("적응지도_종합평가.pdf", buf);
        }
      });
    };

    // 단일현장이면 기존과 동일하게 루트에 담고(무회귀), 멀티현장이면 현장별 폴더로 분리한다.
    for (const { site, assignment } of siteEntries) {
      const target = multiSite ? zip.folder(safeFilename(`현장_${site.companyName}`))! : zip;
      await buildForSite(target, site, assignment);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    const workerName = safeFilename(user?.workerName || workerIdRaw);
    const filename  = `감사서류_${workerName}_${start}_${end}.zip`;

    // 접속기록(안전성 확보조치 제8조): 최대밀도 PII 패키지(출근부+훈련생 일지·평가) 제공 지점 기록.
    await logAccess(request, scope, {
      subjectType: "Worker",
      subjectId: workerId,
      subjectLabel: user?.workerName ?? null,
      resource: "audit_package",
      action: "export",
    });

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
