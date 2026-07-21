// app/api/admin/leave/attendance-check/route.ts
// 출근부 발송 전 교차검증(소프트 게이트) — 선택한 DocumentRun 중 출근부(ATTENDANCE_SHEET)에 대해
// "출근 기록 없는 소정근로일 ⓐ > 등록 연차 ⓑ"인 건을 경고 목록으로 반환. 발송 자체는 막지 않는다(매니저 확인).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkLeaveVsAttendance } from "@/lib/leave/attendanceCheck";
import { mapWithConcurrency } from "@/lib/concurrency";

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const body = await req.json().catch(() => ({}));
    const raw: unknown[] = Array.isArray(body?.runIds) ? body.runIds : [];
    const runIds = raw.filter((x) => /^\d+$/.test(String(x))).map((x) => BigInt(String(x))).slice(0, 100);
    if (runIds.length === 0) return NextResponse.json({ success: true, warnings: [] });

    const runs = await prisma.documentRun.findMany({
      where: { id: { in: runIds }, agencyId: scope.agencyId, docType: "ATTENDANCE_SHEET" },
      select: {
        id: true, workerId: true, siteId: true, periodStart: true, periodEnd: true,
        worker: { select: { workerName: true } },
        site: { select: { companyName: true } },
      },
    });

    type Warning = {
      runId: string; workerName: string; siteName: string; period: string;
      emptyDays: number; leaveDays: number; emptyDates: string[];
    };
    // ★2026-07-21 감사 P2(성능): run당 4쿼리를 직렬로 돌면 월말 최대 100건 발송 전 대기가 수 초로 누적된다.
    //  매니저 대면 경로라 동시성 상한(8)으로 병렬화(DB 커넥션 폭주는 상한으로 방어).
    const perRun = await mapWithConcurrency(runs, 8, async (run): Promise<Warning | null> => {
      try {
        // DocumentRun 기간은 KST(+09:00) 저장 — KST 벽시계 날짜로 환원.
        const start = new Date(run.periodStart.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
        const end = new Date(run.periodEnd.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
        const chk = await checkLeaveVsAttendance({
          agencyId: scope.agencyId, workerId: run.workerId, siteId: run.siteId, start, end,
        });
        if (!chk.mismatch) return null;
        return {
          runId: run.id.toString(),
          workerName: run.worker?.workerName ?? "-",
          siteName: run.site?.companyName ?? "-",
          period: `${start}~${end}`,
          emptyDays: chk.emptyScheduledDays.length,
          leaveDays: chk.leaveDays,
          emptyDates: chk.emptyScheduledDays.slice(0, 10),
        };
      } catch { return null; /* 개별 판정 실패는 경고 생략(발송 흐름 무영향) */ }
    });
    const warnings = perRun.filter((w): w is Warning => w != null);
    return NextResponse.json({ success: true, warnings });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/leave/attendance-check]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
