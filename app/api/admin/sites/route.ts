// app/api/admin/sites/route.ts
// 관리자 사이트 목록 조회/검색/페이지네이션 및 등록 API
// (schema.prisma: Site는 agencyId/managerId relation 기반)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";
import { checkQuota } from "@/lib/planGuard";

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

async function resolveManagerIdOrThrow(managerId: bigint, agencyId?: bigint | null) {
  const m = await prisma.agencyManager.findUnique({
    where: { id: managerId },
    select: { id: true, agencyId: true },
  });
  if (!m) throw new Error("VALIDATION:managerId");
  if (agencyId != null && m.agencyId !== agencyId) throw new Error("VALIDATION:managerId");
  return m.id;
}

function toRow(r: any) {
  return {
    id: String(r.id),
    companyName: r.companyName,
    address: r.address,
    detailAddress: r.detailAddress ?? null,
    gpsLat: r.gpsLat?.toString?.() ?? String(r.gpsLat),
    gpsLon: r.gpsLon?.toString?.() ?? String(r.gpsLon),

    agencyId: r.agencyId != null ? String(r.agencyId) : null,
    agencyName: r.agency?.name ?? null,

    managerId: r.managerId != null ? String(r.managerId) : null,
    managerName: r.agencyManager?.name ?? null,
    managerEmail: r.agencyManager?.email ?? null,
    managerPhone: r.agencyManager?.phoneNumber ?? null,

    basePointConfirmed: r.basePointConfirmed,
    basePointAuthority: r.basePointAuthority,
    basePointApprovalStatus: r.basePointApprovalStatus,
    basePointUpdatedAt: r.basePointUpdatedAt ? r.basePointUpdatedAt.toISOString() : null,

    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") || "").trim();
    const page = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 20), 100);

    const isActiveParam = searchParams.get("isActive");
    const isActive =
      isActiveParam == null ? true : isActiveParam === "true" || isActiveParam === "1";

    let agencyId: bigint | undefined;

    // ✅ AGENCY는 내 스코프로 고정
    if (scope.role === "AGENCY") {
      agencyId = requireAgencyScope(scope);
    } else {
      // ADMIN은 agencyId 파라미터로 선택 필터
      const agencyIdStr = (searchParams.get("agencyId") || "").trim();
      if (agencyIdStr) {
        try {
          agencyId = BigInt(agencyIdStr);
        } catch {
          throw new Error("VALIDATION:agencyId");
        }
      }
    }

    const where: Prisma.SiteWhereInput = {
      ...(typeof isActive === "boolean" ? { isActive } : {}),
      ...(agencyId ? { agencyId } : {}),
      ...(q
        ? {
            OR: [
              { companyName: { contains: q, mode: "insensitive" } },
              { address: { contains: q, mode: "insensitive" } },
              { agencyManager: { is: { name: { contains: q, mode: "insensitive" } } } },
              { agencyManager: { is: { email: { contains: q, mode: "insensitive" } } } },
              { agencyManager: { is: { phoneNumber: { contains: q, mode: "insensitive" } } } },
              { agency: { is: { name: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.site.count({ where }),
      prisma.site.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          companyName: true,
          address: true,
          detailAddress: true,
          gpsLat: true,
          gpsLon: true,

          agencyId: true,
          managerId: true,

          agency: { select: { id: true, name: true } },
          agencyManager: { select: { id: true, name: true, email: true, phoneNumber: true } },

          basePointConfirmed: true,
          basePointAuthority: true,
          basePointApprovalStatus: true,
          basePointUpdatedAt: true,

          isActive: true,
          createdAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      items: rows.map(toRow),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);

    const body = await req.json();

    const companyName = String(body.companyName || "").trim();
    const address = String(body.address || "").trim();
    const detailAddress = body.detailAddress == null ? null : String(body.detailAddress).trim();

    const gpsLatRaw = body.gpsLat;
    const gpsLonRaw = body.gpsLon;

    const managerIdRaw = body.managerId;

    if (!companyName) throw new Error("VALIDATION:companyName");
    if (!address) throw new Error("VALIDATION:address");

    const latStr = String(gpsLatRaw ?? "").trim();
    const lonStr = String(gpsLonRaw ?? "").trim();
    if (!latStr || !lonStr) throw new Error("VALIDATION:gpsLatLon");

    // ✅ agencyId 결정: AGENCY는 고정, ADMIN은 body.agencyId 필수
    let agencyId: bigint;
    if (scope.role === "AGENCY") {
      agencyId = requireAgencyScope(scope);
    } else {
      const agencyIdInput = String(body.agencyId ?? "").trim();
      if (!agencyIdInput) throw new Error("VALIDATION:agencyId");
      try {
        agencyId = BigInt(agencyIdInput);
      } catch {
        throw new Error("VALIDATION:agencyId");
      }
    }

    const quotaCheck = await checkQuota(agencyId, "sites");
    if (!quotaCheck.allowed) {
      return NextResponse.json({
        success: false,
        message: `사업장 한도(${quotaCheck.max}개)에 도달했습니다. 플랜을 업그레이드해주세요.`,
        reason: "QUOTA_EXCEEDED",
      }, { status: 403 });
    }

    if (managerIdRaw == null || String(managerIdRaw).trim() === "") {
      throw new Error("VALIDATION:managerId");
    }
    let managerId: bigint;
    try {
      managerId = BigInt(String(managerIdRaw));
    } catch {
      throw new Error("VALIDATION:managerId");
    }
    await resolveManagerIdOrThrow(managerId, agencyId);

    const created = await prisma.site.create({
      data: {
        companyName,
        address,
        detailAddress,
        gpsLat: new Prisma.Decimal(latStr),
        gpsLon: new Prisma.Decimal(lonStr),
        agencyId,
        managerId,
      },
      select: {
        id: true,
        companyName: true,
        address: true,
        detailAddress: true,
        gpsLat: true,
        gpsLon: true,
        agencyId: true,
        managerId: true,
        agency: { select: { id: true, name: true } },
        agencyManager: { select: { id: true, name: true, email: true, phoneNumber: true } },
        basePointConfirmed: true,
        basePointAuthority: true,
        basePointApprovalStatus: true,
        basePointUpdatedAt: true,
        isActive: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, item: toRow(created) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
