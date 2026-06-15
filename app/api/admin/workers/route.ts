// app/api/admin/workers/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { AssignStatus, WorkerRole, Prisma } from "@prisma/client";

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function kstStart(dateStr: string) {
  return new Date(`${dateStr}T00:00:00.000+09:00`);
}
function kstEnd(dateStr: string) {
  return new Date(`${dateStr}T23:59:59.999+09:00`);
}

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const page = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 20), 100);

    const from = (searchParams.get("from") || "").trim();
    const to = (searchParams.get("to") || "").trim();

    let fromDt: Date | null = null;
    let toDt: Date | null = null;
    if (from) {
      if (!isDateOnly(from)) throw new Error("VALIDATION:from");
      fromDt = kstStart(from);
    }
    if (to) {
      if (!isDateOnly(to)) throw new Error("VALIDATION:to");
      toDt = kstEnd(to);
    }

    const where: Prisma.WorkerWhereInput = {
      role: WorkerRole.WORKER,
      ...(q
        ? {
            OR: [
              { workerName: { contains: q, mode: "insensitive" } },
              { loginId: { contains: q, mode: "insensitive" } },
              { phoneNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // 기간 오버랩 + site.agencyId 기반으로 코치 노출 제한
    // User-Agency 직접 FK가 없으므로 SiteAssignment로 스코프 결정
    {
      const agencyId = scope.agencyId;

      // assignment 기간 필터(선택)
      const assignmentWhere: Prisma.SiteAssignmentWhereInput = {
        // 배정 관리 목록 = 확정 이후(계약 대기→연결·위치→근무중). 요청/수락 단계는 '배정 확정' 화면 소관.
        status: { in: [AssignStatus.ASSIGNED, AssignStatus.CONFIRMED, AssignStatus.ACTIVE] },
      };

      if (fromDt || toDt) {
        assignmentWhere.AND = [
          ...(fromDt ? [{ startDate: { lte: toDt ?? new Date("9999-12-31T00:00:00Z") } }] : []),
          ...(toDt ? [{ OR: [{ endDate: null }, { endDate: { gte: fromDt ?? new Date("1970-01-01T00:00:00Z") } }] }] : []),
        ];
      }

      // 배정의 site가 agencyId인 것만
      assignmentWhere.site = { is: { agencyId } };

      where.assignments = { some: assignmentWhere };
    }

    // 워커 상태 필터(활성/일시정지/퇴사). 상태별 카운트는 필터와 무관하게 전체 표시.
    const VALID_W_STATUS = ["ACTIVE", "PAUSED", "RESIGNED"];
    const statuses = (searchParams.get("status") || "").split(",").map(s => s.trim()).filter(s => VALID_W_STATUS.includes(s));
    const listWhere: Prisma.WorkerWhereInput = statuses.length ? { ...where, status: { in: statuses as any } } : where;

    const [total, rows, statusGroups, pendingRequestCount] = await Promise.all([
      prisma.worker.count({ where: listWhere }),
      prisma.worker.findMany({
        where: listWhere,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          loginId: true,
          workerName: true,
          phoneNumber: true,
          status: true,
          planType: true,
          createdAt: true,
          assignments: {
            where: { status: { in: [AssignStatus.ACTIVE, AssignStatus.ASSIGNED, AssignStatus.CONFIRMED] } },
            orderBy: { id: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              startDate: true,
              serviceStep: true,
              adaptationStartDate: true,
              workType: true,
              requestedWorkTypes: true,
              replyDeadline: true,
              site: { select: { companyName: true } },
              agency: { select: { name: true } },
            },
          },
        },
      }),
      prisma.worker.groupBy({ by: ["status"], where, _count: { _all: true } }),
      // 미처리 배정 요청(회신 대기/수락) 수 — '배정 요청 관리' 버튼 배지(전체 기준 정확값)
      prisma.siteAssignment.count({ where: { agencyId: scope.agencyId, status: { in: [AssignStatus.REQUESTED, AssignStatus.ACCEPTED] } } }),
    ]);

    const counts: Record<string, number> = { ACTIVE: 0, PAUSED: 0, RESIGNED: 0 };
    for (const g of statusGroups) counts[String(g.status)] = g._count._all;

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      counts,
      pendingRequestCount,
      data: rows.map((u) => ({
        id: String(u.id),
        loginId: u.loginId,
        workerName: u.workerName,
        phoneNumber: u.phoneNumber,
        status: String(u.status),
        planType: String(u.planType),
        createdAt: u.createdAt.toISOString(),
        activeAssignment: u.assignments[0] ? {
          assignmentId: String(u.assignments[0].id),
          assignStatus: String(u.assignments[0].status),
          siteName: u.assignments[0].site?.companyName || "-",
          agencyName: u.assignments[0].agency?.name || "-",
          startDate: u.assignments[0].startDate.toISOString(),
          serviceStep: String(u.assignments[0].serviceStep),
          adaptationStartDate: u.assignments[0].adaptationStartDate?.toISOString() ?? null,
          workType: u.assignments[0].workType ? String(u.assignments[0].workType) : null,
          requestedWorkTypes: u.assignments[0].requestedWorkTypes ?? null,
          replyDeadline: u.assignments[0].replyDeadline?.toISOString() ?? null,
        } : null,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
