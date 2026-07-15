// app/api/admin/docs/workers/route.ts
// 문서 조회(/manager/docs) 전용 — 현장(배정)별 행 목록.
// 멀티현장 워커(오전 A·오후 B)는 배정 수만큼 행이 나와 각 현장 문서를 정확히 주소지정한다
// (종전: /api/admin/workers의 activeAssignment[0]=최신 배정 1행 → 타현장 문서 접근 불가).
// 스코프 = assignment.agencyId(권위 귀속 — site.agencyId 금지 규율). 조회 전용이라 부작용 없음.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const rows = await prisma.siteAssignment.findMany({
      where: { agencyId: scope.agencyId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      select: {
        id: true,
        siteId: true,
        serviceStep: true,
        user: { select: { id: true, workerName: true } },
        site: { select: { companyName: true } },
      },
      // 워커 최신순(기존 문서 조회 목록과 동일 감각) → 같은 워커의 현장 행이 이어서 표시
      orderBy: [{ workerId: "desc" }, { id: "desc" }],
    });

    return NextResponse.json({
      success: true,
      data: rows.map((a) => ({
        assignmentId: String(a.id),
        workerId: String(a.user.id),
        workerName: a.user.workerName,
        siteId: String(a.siteId),
        siteName: a.site?.companyName || "-",
        serviceStep: String(a.serviceStep),
      })),
    });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/docs/workers]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
