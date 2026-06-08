// app/api/admin/sites/route.ts
// 관리자 사이트 목록 조회/검색/페이지네이션 및 등록 API
// (schema.prisma: Site는 agencyId/managerId relation 기반)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAdminOrManagerSession, resolveScopeAgencyId } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { checkQuota } from "@/lib/planGuard";

const PROFESSIONS = ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"] as const;

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

    // 레거시(에이전시측 연락처). 신규 화면은 businessContact* 사용.
    managerId: r.managerId != null ? String(r.managerId) : null,
    managerName: r.agencyManager?.name ?? null,
    managerEmail: r.agencyManager?.email ?? null,
    managerPhone: r.agencyManager?.phoneNumber ?? null,

    // ✅ 사업체 담당자(현장 연락 담당자)
    businessContactName: r.businessContactName ?? null,
    businessContactPhone: r.businessContactPhone ?? null,

    requiredProfession: r.requiredProfession ?? null,

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
    const session = await requireAdminOrManagerSession(req);
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") || "").trim();
    const page = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 20), 100);

    const isActiveParam = searchParams.get("isActive");
    const isActive =
      isActiveParam == null ? true : isActiveParam === "true" || isActiveParam === "1";

    // manager: 본인 agency 강제 / admin(운영자): ?agencyId 선택(없으면 전체)
    let agencyId: bigint | undefined;
    if (session.kind === "manager") agencyId = session.agencyId;
    else {
      const a = searchParams.get("agencyId");
      agencyId = a ? (parseBigInt(a) ?? undefined) : undefined;
    }

    const where: Prisma.SiteWhereInput = {
      ...(typeof isActive === "boolean" ? { isActive } : {}),
      ...(agencyId ? { agencyId } : {}),
      ...(q
        ? {
            OR: [
              { companyName: { contains: q, mode: "insensitive" } },
              { address: { contains: q, mode: "insensitive" } },
              { businessContactName: { contains: q, mode: "insensitive" } },
              { businessContactPhone: { contains: q, mode: "insensitive" } },
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
          businessContactName: true,
          businessContactPhone: true,
          requiredProfession: true,

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
    const session = await requireAdminOrManagerSession(req);

    const body = await req.json();

    const companyName = String(body.companyName || "").trim();
    const address = String(body.address || "").trim();
    const detailAddress = body.detailAddress == null ? null : String(body.detailAddress).trim();

    const gpsLatRaw = body.gpsLat;
    const gpsLonRaw = body.gpsLon;

    const managerIdRaw = body.managerId;
    // 직종(카테고리) — 선택
    const requiredProfession = PROFESSIONS.includes(body.requiredProfession) ? body.requiredProfession : null;

    // ✅ 사업체 담당자(현장 연락 담당자) — 필수
    const businessContactName = String(body.businessContactName ?? "").trim();
    const businessContactPhone = String(body.businessContactPhone ?? "").trim();

    if (!companyName) throw new Error("VALIDATION:companyName");
    if (!address) throw new Error("VALIDATION:address");
    if (!businessContactName) throw new Error("VALIDATION:businessContactName");
    if (!businessContactPhone) throw new Error("VALIDATION:businessContactPhone");

    const latStr = String(gpsLatRaw ?? "").trim();
    const lonStr = String(gpsLonRaw ?? "").trim();
    if (!latStr || !lonStr) throw new Error("VALIDATION:gpsLatLon");

    // manager: 본인 agency / admin(운영자): body.agencyId 지정 필수
    const agencyId = resolveScopeAgencyId(session, body.agencyId);

    const quotaCheck = await checkQuota(agencyId, "sites");
    if (!quotaCheck.allowed) {
      return NextResponse.json({
        success: false,
        message: `사업장 한도(${quotaCheck.max}개)에 도달했습니다. 플랜을 업그레이드해주세요.`,
        reason: "QUOTA_EXCEEDED",
      }, { status: 403 });
    }

    // 레거시 에이전시측 연락처(AgencyManager) — 선택. 보내면 검증, 없으면 null.
    let managerId: bigint | null = null;
    if (managerIdRaw != null && String(managerIdRaw).trim() !== "") {
      try {
        managerId = BigInt(String(managerIdRaw));
      } catch {
        throw new Error("VALIDATION:managerId");
      }
      await resolveManagerIdOrThrow(managerId, agencyId);
    }

    const created = await prisma.site.create({
      data: {
        companyName,
        address,
        detailAddress,
        gpsLat: new Prisma.Decimal(latStr),
        gpsLon: new Prisma.Decimal(lonStr),
        agencyId,
        managerId,
        businessContactName,
        businessContactPhone,
        requiredProfession,
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
        businessContactName: true,
        businessContactPhone: true,
        requiredProfession: true,
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
