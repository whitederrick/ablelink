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

    // 그 달에 활성(기간 겹침)인 배정
    const assignments = await prisma.siteAssignment.findMany({
      where: {
        agencyId: scope.agencyId,
        status: "ACTIVE",
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
        signStage: { not: "DRAFT" },
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
