// app/api/admin/document-runs/missing/route.ts
// 미제출 가시화: 해당 월 활성 배정 중 '출근부(ATTENDANCE_SHEET)'를 아직 제출하지 않은 배정 목록.
//  · 출근부는 매월 필수 제출 문서라 미제출 판정이 명확(일지/종합평가는 시점이 유동적이라 제외).
//  · 제출 여부 = 그 배정(assignmentId)에 대해 해당 월과 겹치는 ATTENDANCE_SHEET DocumentRun(제출 이상) 존재.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { getKstDateString, isValidYmd } from "@/lib/time";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);
    let ym = (searchParams.get("yearMonth") ?? "").trim();
    // 형식(YYYY-MM) + 달력 실존(월 01~12) — 둘 중 하나라도 아니면 현재 월로 폴백(기존 동작 유지).
    //  2026-13은 정규식은 통과하나 아래 new Date(...)에서 Invalid Date로 DateTime 필터 500나던 것을 폴백으로 차단.
    if (!/^\d{4}-\d{2}$/.test(ym) || !isValidYmd(`${ym}-01`)) ym = getKstDateString().slice(0, 7);

    const [y, m] = ym.split("-").map(Number);
    const monthStart = new Date(`${ym}-01T00:00:00+09:00`);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = new Date(`${ym}-${String(lastDay).padStart(2, "0")}T23:59:59+09:00`);

    // 그 달에 근무 중이거나 근무한(기간 겹침) 배정.
    //  D1: ACTIVE만 보면 계약서명됐지만 아직 ACTIVE 아닌(CONFIRMED)·그 달 종료된(ENDED) 배정의 출근부 미제출이
    //   후보에서 빠져 "모두 제출" 오신호가 났다 → 출근부 제출이 가능한/필요한 상태집합으로 확장.
    const assignments = await prisma.siteAssignment.findMany({
      where: {
        agencyId: scope.agencyId,
        status: { in: ["CONFIRMED", "ACTIVE", "ENDED"] },
        startDate: { lte: monthEnd },
        OR: [{ endDate: null }, { endDate: { gte: monthStart } }],
      },
      select: {
        id: true,
        workType: true,
        user: { select: { workerName: true, loginId: true } },
        site: { select: { companyName: true } },
      },
      orderBy: [{ siteId: "asc" }, { id: "asc" }],
    });

    // 그 달과 겹치는 출근부 제출 건 → assignmentId 집합
    const submittedRuns = await prisma.documentRun.findMany({
      where: {
        agencyId: scope.agencyId,
        docType: "ATTENDANCE_SHEET",
        // D2: 반려(CHANGES_REQUESTED)는 '제출됨'이 아니다 — 제출→반려→미재제출을 준수로 오카운트하지 않도록 제외.
        signStage: { notIn: ["DRAFT", "CHANGES_REQUESTED"] },
        periodStart: { lte: monthEnd },
        periodEnd: { gte: monthStart },
      },
      select: { assignmentId: true, signStage: true },
    });
    const submittedByAssignment = new Map<string, string>();
    for (const r of submittedRuns) if (r.assignmentId != null) submittedByAssignment.set(r.assignmentId.toString(), r.signStage);

    // D1 정정: 그 달 '실제 출근기록이 있는' 배정만 출근부 제출 대상으로 본다.
    //  (근무 0일 배정 — 예: 25일 시작 CONFIRMED, 계약취소 후 무근무 ENDED — 을 미제출로 잡아 매니저에게 불가능한
    //   제출을 독촉하던 허위 미제출 방지. 출근부는 근무가 있어야 제출 의무가 생긴다.)
    //  ★출근기록이 '존재'하면 근무한 것으로 본다 — startTime 유무로 거르지 않는다.
    //   (소급 일지입력(batch-save/logs-save)으로 만든 출근기록은 clock-in이 없어 startTime=null이지만, 그래도
    //    그 달 근무했고 출근부 제출 의무가 있다. startTime 조건을 걸면 이런 배정이 미제출 보드에서 숨겨진다.)
    const periodStartStr = `${ym}-01`;
    const periodEndStr = `${ym}-${String(lastDay).padStart(2, "0")}`;
    const attended = assignments.length ? await prisma.dailyAttendance.findMany({
      where: { assignmentId: { in: assignments.map(a => a.id) }, workDate: { gte: periodStartStr, lte: periodEndStr } },
      select: { assignmentId: true },
      distinct: ["assignmentId"],
    }) : [];
    const attendedSet = new Set(attended.map(a => a.assignmentId.toString()));

    const rows = assignments.filter(a => attendedSet.has(a.id.toString())).map(a => ({
      assignmentId: a.id.toString(),
      workerName: a.user?.workerName ?? "",
      loginId: a.user?.loginId ?? "",
      siteName: a.site?.companyName ?? "",
      workType: a.workType ?? "FULL_DAY",
      submitted: submittedByAssignment.has(a.id.toString()),
      signStage: submittedByAssignment.get(a.id.toString()) ?? null,
    }));

    const missing = rows.filter(r => !r.submitted);
    return NextResponse.json({
      success: true,
      yearMonth: ym,
      totalActive: rows.length,
      submittedCount: rows.length - missing.length,
      missingCount: missing.length,
      missing,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
