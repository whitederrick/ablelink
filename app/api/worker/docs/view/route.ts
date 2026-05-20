// app/api/worker/docs/view/route.ts
// 문서 조회 API — 5종 문서 각각 분리
// docType:
//   attendance-sheet      → 출근부 (날짜별 출퇴근)
//   training-daily-log    → 훈련일지 (PRE+FIELD, 날짜별)
//   trainee-final-eval    → 훈련생 종합평가 (PRE+FIELD, 훈련생별 집계)
//   adaptation-daily-log  → 적응지도 일지 (ADAPTATION, 날짜별)
//   adaptation-final-eval → 적응지도 종합평가 (ADAPTATION, 훈련생별 집계)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

function formatKST(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function defaultPeriod() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const docType = searchParams.get("docType") ?? "attendance-sheet";
    const def = defaultPeriod();
    const startStr = searchParams.get("periodStart") || def.start;
    const endStr   = searchParams.get("periodEnd")   || def.end;

    const userId = BigInt(session.userId);

    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      include: { site: true },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment) return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });

    const siteId = assignment.siteId;
    const siteName = assignment.site.companyName;
    const period = { start: startStr, end: endStr };

    // ── 출근부 ──────────────────────────────────────────────────────────
    if (docType === "attendance-sheet") {
      const records = await prisma.dailyAttendance.findMany({
        where: { userId, siteId, workDate: { gte: startStr, lte: endStr } },
        orderBy: { workDate: "asc" },
      });
      const rows = records.map(r => ({
        date:          r.workDate,
        startTime:     r.startTime ? formatKST(r.startTime) : null,
        endTime:       r.endTime   ? formatKST(r.endTime)   : null,
        status:        r.status,
        isFinalClosed: r.isFinalClosed,
        withinRange:   r.withinRange ?? null,
      }));
      return NextResponse.json({
        success: true, docType, site: siteName, period,
        summary: {
          totalDays:  rows.length,
          workDays:   rows.filter(r => r.startTime).length,
          closedDays: rows.filter(r => r.isFinalClosed).length,
        },
        rows,
      });
    }

    // ── 훈련일지 (PRE + FIELD, 날짜별) ──────────────────────────────────
    if (docType === "training-daily-log") {
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: userId,
          trainingType: { in: ["PRE", "FIELD"] },
          attendance: { siteId, workDate: { gte: startStr, lte: endStr } },
        },
        include: { trainee: true, attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });
      const rows = logs.map(l => ({
        date:          l.attendance.workDate,
        traineeName:   l.trainee.name,
        traineeGender: l.trainee.gender,
        trainingType:  l.trainingType,
        time1on1:      Number(l.time1on1),
        timeGroup:     Number(l.timeGroup),
        totalTime:     Number(l.totalRecognizedTime),
        content:       l.content ?? "",
        isCompleted:   l.isCompleted,
        taskScore:     l.tasks[0]?.performanceScore ?? null,
        evaluation:    l.evaluation ?? null,
      }));
      const byTrainee: Record<string, typeof rows> = {};
      rows.forEach(r => { (byTrainee[r.traineeName] ??= []).push(r); });
      return NextResponse.json({
        success: true, docType, site: siteName, period,
        summary: {
          totalLogs:     rows.length,
          completedLogs: rows.filter(r => r.isCompleted).length,
          totalTime:     +rows.reduce((s, r) => s + r.totalTime, 0).toFixed(1),
        },
        rows, byTrainee,
      });
    }

    // ── 훈련생 종합평가 (PRE + FIELD, 훈련생별) ──────────────────────────
    if (docType === "trainee-final-eval") {
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: userId,
          trainingType: { in: ["PRE", "FIELD"] },
          attendance: { siteId, workDate: { gte: startStr, lte: endStr } },
        },
        include: { trainee: true, attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });
      const map: Record<string, any> = {};
      logs.forEach(l => {
        const k = l.traineeId.toString();
        if (!map[k]) map[k] = { traineeId: k, traineeName: l.trainee.name, traineeGender: l.trainee.gender, logCount: 0, completedCount: 0, totalTime: 0, taskScores: [], evaluations: [], firstDate: l.attendance.workDate, lastDate: "" };
        const e = map[k];
        e.logCount++;
        if (l.isCompleted) e.completedCount++;
        e.totalTime += Number(l.totalRecognizedTime);
        if (l.tasks[0]?.performanceScore) e.taskScores.push(l.tasks[0].performanceScore);
        if (l.evaluation) e.evaluations.push(l.evaluation);
        if (l.attendance.workDate > e.lastDate) e.lastDate = l.attendance.workDate;
      });
      const rows = Object.values(map).map((e: any) => ({
        traineeId:      e.traineeId,
        traineeName:    e.traineeName,
        traineeGender:  e.traineeGender,
        logCount:       e.logCount,
        completedCount: e.completedCount,
        completionRate: e.logCount > 0 ? Math.round((e.completedCount / e.logCount) * 100) : 0,
        totalTime:      +e.totalTime.toFixed(1),
        avgTaskScore:   e.taskScores.length > 0 ? +(e.taskScores.reduce((a: number, b: number) => a + b, 0) / e.taskScores.length).toFixed(1) : null,
        evaluations:    e.evaluations,
        firstDate:      e.firstDate,
        lastDate:       e.lastDate,
      }));
      return NextResponse.json({
        success: true, docType, site: siteName, period,
        summary: { traineeCount: rows.length, totalLogs: logs.length, totalTime: +rows.reduce((s: number, r: any) => s + r.totalTime, 0).toFixed(1) },
        rows,
      });
    }

    // ── 적응지도 일지 (ADAPTATION, 날짜별) ──────────────────────────────
    if (docType === "adaptation-daily-log") {
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: userId,
          trainingType: "ADAPTATION",
          attendance: { siteId, workDate: { gte: startStr, lte: endStr } },
        },
        include: { trainee: true, attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });
      const rows = logs.map(l => ({
        date:          l.attendance.workDate,
        traineeName:   l.trainee.name,
        traineeGender: l.trainee.gender,
        totalTime:     Number(l.totalRecognizedTime),
        content:       l.content ?? "",
        isCompleted:   l.isCompleted,
        taskScore:     l.tasks[0]?.performanceScore ?? null,
        evaluation:    l.evaluation ?? null,
      }));
      const byTrainee: Record<string, typeof rows> = {};
      rows.forEach(r => { (byTrainee[r.traineeName] ??= []).push(r); });
      return NextResponse.json({
        success: true, docType, site: siteName, period,
        summary: {
          totalLogs:     rows.length,
          completedLogs: rows.filter(r => r.isCompleted).length,
          totalTime:     +rows.reduce((s, r) => s + r.totalTime, 0).toFixed(1),
        },
        rows, byTrainee,
      });
    }

    // ── 적응지도 종합평가 (ADAPTATION, 훈련생별) ─────────────────────────
    if (docType === "adaptation-final-eval") {
      const logs = await prisma.traineeLog.findMany({
        where: {
          writerId: userId,
          trainingType: "ADAPTATION",
          attendance: { siteId, workDate: { gte: startStr, lte: endStr } },
        },
        include: { trainee: true, attendance: true, tasks: true },
        orderBy: { attendance: { workDate: "asc" } },
      });
      const map: Record<string, any> = {};
      logs.forEach(l => {
        const k = l.traineeId.toString();
        if (!map[k]) map[k] = { traineeId: k, traineeName: l.trainee.name, traineeGender: l.trainee.gender, logCount: 0, completedCount: 0, totalTime: 0, taskScores: [], evaluations: [], firstDate: l.attendance.workDate, lastDate: "" };
        const e = map[k];
        e.logCount++;
        if (l.isCompleted) e.completedCount++;
        e.totalTime += Number(l.totalRecognizedTime);
        if (l.tasks[0]?.performanceScore) e.taskScores.push(l.tasks[0].performanceScore);
        if (l.evaluation) e.evaluations.push(l.evaluation);
        if (l.attendance.workDate > e.lastDate) e.lastDate = l.attendance.workDate;
      });
      const rows = Object.values(map).map((e: any) => ({
        traineeId:      e.traineeId,
        traineeName:    e.traineeName,
        traineeGender:  e.traineeGender,
        logCount:       e.logCount,
        completedCount: e.completedCount,
        completionRate: e.logCount > 0 ? Math.round((e.completedCount / e.logCount) * 100) : 0,
        totalTime:      +e.totalTime.toFixed(1),
        avgTaskScore:   e.taskScores.length > 0 ? +(e.taskScores.reduce((a: number, b: number) => a + b, 0) / e.taskScores.length).toFixed(1) : null,
        evaluations:    e.evaluations,
        firstDate:      e.firstDate,
        lastDate:       e.lastDate,
      }));
      return NextResponse.json({
        success: true, docType, site: siteName, period,
        summary: { traineeCount: rows.length, totalLogs: logs.length, totalTime: +rows.reduce((s: number, r: any) => s + r.totalTime, 0).toFixed(1) },
        rows,
      });
    }

    return NextResponse.json({ success: false, message: "지원하지 않는 문서 유형입니다." }, { status: 400 });

  } catch (error: any) {
    console.error("[docs/view]", error);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다.", detail: error?.message }, { status: 500 });
  }
}
