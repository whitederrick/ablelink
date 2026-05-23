// app/api/admin/coaches/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";
import { AssignStatus, UserRole, Prisma } from "@prisma/client";

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
    const scope = await requireAdminSession(req);

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

    const where: Prisma.UserWhereInput = {
      role: UserRole.COACH,
      ...(q
        ? {
            OR: [
              { userName: { contains: q, mode: "insensitive" } },
              { loginId: { contains: q, mode: "insensitive" } },
              { phoneNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // ✅ AGENCY 스코프: 기간 오버랩 + site.agencyId 기반으로 코치 노출 제한
    // - User-Agency 직접 FK가 없으므로 SiteAssignment로 스코프 결정
    if (scope.role === "AGENCY") {
      const agencyId = requireAgencyScope(scope);

      // assignment 기간 필터(선택)
      const assignmentWhere: Prisma.SiteAssignmentWhereInput = {
        status: { in: [AssignStatus.ASSIGNED, AssignStatus.CONFIRMED, AssignStatus.ACTIVE] },
      };

      if (fromDt || toDt) {
        assignmentWhere.AND = [
          ...(fromDt ? [{ startDate: { lte: toDt ?? new Date("9999-12-31T00:00:00Z") } }] : []),
          ...(toDt ? [{ OR: [{ endDate: null }, { endDate: { gte: fromDt ?? new Date("1970-01-01T00:00:00Z") } }] }] : []),
        ];
      }

      // ✅ 핵심: 배정의 site가 agencyId인 것만
      assignmentWhere.site = { is: { agencyId } };

      where.assignments = { some: assignmentWhere };
    }

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          loginId: true,
          userName: true,
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
              startDate: true,
              site: { select: { companyName: true } },
              agency: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      data: rows.map((u) => ({
        id: String(u.id),
        loginId: u.loginId,
        userName: u.userName,
        phoneNumber: u.phoneNumber,
        status: String(u.status),
        planType: String(u.planType),
        createdAt: u.createdAt.toISOString(),
        activeAssignment: u.assignments[0] ? {
          assignmentId: String(u.assignments[0].id),
          siteName: u.assignments[0].site?.companyName || "-",
          agencyName: u.assignments[0].agency?.name || "-",
          startDate: u.assignments[0].startDate.toISOString(),
        } : null,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
