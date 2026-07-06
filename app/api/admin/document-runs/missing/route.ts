// app/api/admin/document-runs/missing/route.ts
// 미제출 가시화: 해당 월 활성 배정 중 '출근부(ATTENDANCE_SHEET)'를 아직 제출하지 않은 배정 목록.
//  · 출근부는 매월 필수 제출 문서라 미제출 판정이 명확(일지/종합평가는 시점이 유동적이라 제외).
//  · 제출 여부 = 그 배정(assignmentId)에 대해 해당 월과 겹치는 ATTENDANCE_SHEET DocumentRun(제출 이상) 존재.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { getKstDateString } from "@/lib/time";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);
    let ym = (searchParams.get("yearMonth") ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) ym = getKstDateString().slice(0, 7);

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

    const rows = assignments.map(a => ({
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
