// app/api/admin/leave/requests/route.ts
// 연차 신청 인박스(Phase7) — 매니저 전용 목록. 워커 신청(WORKER_REQUEST)과
// 매니저 등록 확인 요청(MANAGER_ENTRY_CONFIRM)의 상태를 함께 보여준다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import type { Prisma } from "@prisma/client";

// GET ?box=pending|all&page=&pageSize= — pending(기본)=처리 대기(신청 대기 + 이의)만.
export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const sp = new URL(req.url).searchParams;
    const box = sp.get("box") === "all" ? "all" : "pending";
    const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(sp.get("pageSize") ?? 5) || 5));

    // pending 박스 = 매니저 액션 필요한 것: 워커 신청 대기 + 워커 이의(정정 필요).
    const where: Prisma.AnnualLeaveRequestWhereInput = box === "pending"
      ? {
          agencyId: scope.agencyId,
          OR: [
            { kind: "WORKER_REQUEST", status: "PENDING" },
            { kind: "MANAGER_ENTRY_CONFIRM", status: "DISPUTED" },
          ],
        }
      : { agencyId: scope.agencyId };

    const [total, rows, pendingCount] = await Promise.all([
      prisma.annualLeaveRequest.count({ where }),
      prisma.annualLeaveRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, workerId: true, kind: true, status: true, effectiveDate: true, days: true,
          reason: true, responseNote: true, createdAt: true, resolvedAt: true,
          worker: { select: { workerName: true, loginId: true } },
        },
      }),
      prisma.annualLeaveRequest.count({
        where: {
          agencyId: scope.agencyId,
          OR: [
            { kind: "WORKER_REQUEST", status: "PENDING" },
            { kind: "MANAGER_ENTRY_CONFIRM", status: "DISPUTED" },
          ],
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      total,
      pendingCount,
      items: rows.map((r) => ({
        id: r.id.toString(),
        workerId: r.workerId.toString(),
        workerName: r.worker?.workerName ?? "-",
        loginId: r.worker?.loginId ?? "",
        kind: r.kind,
        status: r.status,
        effectiveDate: r.effectiveDate.toISOString().slice(0, 10),
        days: Number(r.days),
        reason: r.reason,
        responseNote: r.responseNote,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      })),
    });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/leave/requests GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
