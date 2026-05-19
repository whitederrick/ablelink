// app/api/admin/attendances/route.ts
// 관리자(에이전시) - 직무지도원별 출퇴근(근태) 현황 조회 API
//
// GET /api/admin/attendances?userId=1&from=2026-01-01&to=2026-01-31&page=1&pageSize=50
// GET /api/admin/attendances?yearMonth=2026-01&userId=1
//
// ✅ 스코프(고도화)
// - AGENCY: (A) assignmentId가 있으면 assignment.site.agencyId 기준으로 제한(정식)
//          (B) assignmentId가 null인 레거시 데이터는 site.agencyId 기준으로 fallback 제한
//          (C) 기간(from/to 또는 yearMonth)이 있으면 assignment 기간과 오버랩되는 것만 포함(보수적)
// - ADMIN: 전체 조회 가능
// - GOV: 현재 차단(FORBIDDEN)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAdminSessionFromRequest } from "@/lib/adminCookies";
import { Prisma } from "@prisma/client";

type AdminSession = {
  sub: string;
  role: "ADMIN" | "GOV" | "AGENCY";
  loginId: string;
  agencyName?: string | null; // AGENCY 스코프 산정용(레거시)
};

async function getSessionOrThrow(req: Request): Promise<AdminSession> {
  const s = await readAdminSessionFromRequest(req);
  if (!s) throw new Error("UNAUTHORIZED");
  return {
    sub: String(s.sub),
    role: s.role,
    loginId: s.loginId,
    agencyName: s.agencyName ?? null,
  };
}

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function isDateOnly(s: string) {
  // YYYY-MM-DD
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s);
}

function isYearMonth(s: string) {
  // YYYY-MM
  return /^[0-9]{4}-[0-9]{2}$/.test(s);
}

async function resolveAgencyIdByNameOrThrow(agencyName: string): Promise<bigint> {
  const a = await prisma.agency.findUnique({
    where: { name: agencyName },
    select: { id: true },
  });
  if (!a) throw new Error("VALIDATION:agencyName");
  return a.id;
}

function asIso(d: any) {
  return d?.toISOString?.() ?? d ?? null;
}

function kstStart(dateStr: string) {
  // dateStr: YYYY-MM-DD
  return new Date(`${dateStr}T00:00:00.000+09:00`);
}
function kstEnd(dateStr: string) {
  return new Date(`${dateStr}T23:59:59.999+09:00`);
}

function toItem(r: any) {
  return {
    id: String(r.id),
    userId: String(r.userId),
    siteId: String(r.siteId),

    // 증빙(있으면)
    assignmentId: r.assignmentId != null ? String(r.assignmentId) : null,
    basePointId: r.basePointId != null ? String(r.basePointId) : null,

    workDate: r.workDate,

    startTime: asIso(r.startTime),
    startLocLat: r.startLocLat != null ? String(r.startLocLat) : null,
    startLocLon: r.startLocLon != null ? String(r.startLocLon) : null,

    endTime: asIso(r.endTime),
    endLocLat: r.endLocLat != null ? String(r.endLocLat) : null,
    endLocLon: r.endLocLon != null ? String(r.endLocLon) : null,

    startDistanceM: r.startDistanceM ?? null,
    endDistanceM: r.endDistanceM ?? null,
    withinRange: r.withinRange ?? null,
    rangeM: r.rangeM ?? null,

    isGpsModified: Boolean(r.isGpsModified),
    status: r.status,
    isFinalClosed: Boolean(r.isFinalClosed),
    finalizedAt: asIso(r.finalizedAt),

    site: r.site
      ? {
          id: String(r.site.id),
          companyName: r.site.companyName,
          address: r.site.address,
          agencyId: r.site.agencyId != null ? String(r.site.agencyId) : null,
        }
      : null,

    user: r.user
      ? {
          id: String(r.user.id),
          userName: r.user.userName,
          loginId: r.user.loginId,
          phoneNumber: r.user.phoneNumber,
          role: r.user.role,
          status: r.user.status,
        }
      : null,

    assignment: r.assignment
      ? {
          id: String(r.assignment.id),
          status: r.assignment.status,
          startDate: asIso(r.assignment.startDate),
          endDate: asIso(r.assignment.endDate),
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionOrThrow(req);

    // 현재 정책: GOV는 아직 막음 (요청대로 AGENCY 중심)
    if (session.role !== "AGENCY" && session.role !== "ADMIN") throw new Error("FORBIDDEN");

    const { searchParams } = new URL(req.url);

    const userIdStr = (searchParams.get("userId") || "").trim();
    const siteIdStr = (searchParams.get("siteId") || "").trim();

    const from = (searchParams.get("from") || "").trim();
    const to = (searchParams.get("to") || "").trim();
    const yearMonth = (searchParams.get("yearMonth") || "").trim(); // YYYY-MM

    const pageStr = (searchParams.get("page") || "1").trim();
    const pageSizeStr = (searchParams.get("pageSize") || "50").trim();

    if (!isValidNumericId(pageStr)) throw new Error("VALIDATION:page");
    if (!isValidNumericId(pageSizeStr)) throw new Error("VALIDATION:pageSize");

    const page = Math.max(1, Number(pageStr));
    const pageSize = Math.min(200, Math.max(1, Number(pageSizeStr)));
    const skip = (page - 1) * pageSize;

    let agencyId: bigint | undefined;
    if (session.role === "AGENCY") {
      if (!session.agencyName) throw new Error("FORBIDDEN");
      agencyId = await resolveAgencyIdByNameOrThrow(session.agencyName);
    }

    // 기간 파싱(assignment 오버랩 및 startTime 필터용)
    let fromDt: Date | null = null;
    let toDt: Date | null = null;

    // 우선순위: (from/to) > (yearMonth)
    if (from || to) {
      if (from && !isDateOnly(from)) throw new Error("VALIDATION:from");
      if (to && !isDateOnly(to)) throw new Error("VALIDATION:to");
      fromDt = from ? kstStart(from) : null;
      toDt = to ? kstEnd(to) : null;
    } else if (yearMonth) {
      if (!isYearMonth(yearMonth)) throw new Error("VALIDATION:yearMonth");
      const start = `${yearMonth}-01`;
      const end = `${yearMonth}-31`;
      fromDt = kstStart(start);
      toDt = kstEnd(end);
    }

    const where: Prisma.DailyAttendanceWhereInput = {};

    if (userIdStr) {
      if (!isValidNumericId(userIdStr)) throw new Error("VALIDATION:userId");
      where.userId = BigInt(userIdStr);
    }

    if (siteIdStr) {
      if (!isValidNumericId(siteIdStr)) throw new Error("VALIDATION:siteId");
      where.siteId = BigInt(siteIdStr);
    }

    // 날짜 필터: workDate가 "YYYY-MM-DD" 문자열이므로 문자열 범위로 필터
    if (from || to) {
      if (from && to) where.workDate = { gte: from, lte: to };
      else if (from) where.workDate = { gte: from };
      else if (to) where.workDate = { lte: to };
    } else if (yearMonth) {
      const start = `${yearMonth}-01`;
      const end = `${yearMonth}-31`;
      where.workDate = { gte: start, lte: end };
    }

    // ✅ AGENCY 스코프(assignment 기반 + 레거시 fallback)
    if (agencyId) {
      const assignmentOverlap: Prisma.SiteAssignmentWhereInput | undefined =
        fromDt || toDt
          ? {
              AND: [
                ...(toDt ? [{ startDate: { lte: toDt } }] : []),
                ...(fromDt ? [{ OR: [{ endDate: null }, { endDate: { gte: fromDt } }] }] : []),
              ],
            }
          : undefined;

      where.AND = [
        ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
        {
          OR: [
            // (A) 정식: assignmentId가 있을 때는 assignment.site.agencyId 기준
            {
              assignmentId: { not: null },
              assignment: {
                is: {
                  site: { is: { agencyId } },
                  ...(assignmentOverlap ? assignmentOverlap : {}),
                },
              },
            },
            // (B) 레거시: assignmentId가 null이면 site.agencyId로 fallback
            {
              assignmentId: null,
              site: { is: { agencyId } },
            },
          ],
        },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.dailyAttendance.count({ where }),
      prisma.dailyAttendance.findMany({
        where,
        orderBy: [{ workDate: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          siteId: true,

          assignmentId: true,
          basePointId: true,

          workDate: true,
          startTime: true,
          startLocLat: true,
          startLocLon: true,
          endTime: true,
          endLocLat: true,
          endLocLon: true,

          startDistanceM: true,
          endDistanceM: true,
          withinRange: true,
          rangeM: true,

          isGpsModified: true,
          status: true,
          isFinalClosed: true,
          finalizedAt: true,

          site: { select: { id: true, companyName: true, address: true, agencyId: true } },
          user: { select: { id: true, userName: true, loginId: true, phoneNumber: true, role: true, status: true } },
          assignment: { select: { id: true, status: true, startDate: true, endDate: true } },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      items: rows.map(toItem),
    });
  } catch (e: any) {
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
