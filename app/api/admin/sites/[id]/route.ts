// app/api/admin/sites/[id]/route.ts
// 관리자 사이트 상세 조회/수정/삭제 API (schema.prisma Site 기준)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

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

    // ✅ 담당 관리자(Manager 로그인). null = 미지정(공용)
    ownerManagerId: r.ownerManagerId != null ? String(r.ownerManagerId) : null,
    ownerManagerName: r.ownerManager?.displayName ?? r.ownerManager?.loginId ?? null,

    // 레거시(에이전시측 연락처)
    managerId: r.managerId != null ? String(r.managerId) : null,
    managerName: r.agencyManager?.name ?? null,
    managerEmail: r.agencyManager?.email ?? null,
    managerPhone: r.agencyManager?.phoneNumber ?? null,

    // ✅ 사업체 담당자(현장 연락 담당자)
    businessContactName: r.businessContactName ?? null,
    businessContactPhone: r.businessContactPhone ?? null,
    businessContactEmail: r.businessContactEmail ?? null,

    requiredProfession: r.requiredProfession ?? null,

    allowanceRange: r.allowanceRange ?? 100,

    basePointConfirmed: r.basePointConfirmed,
    basePointAuthority: r.basePointAuthority,
    basePointApprovalStatus: r.basePointApprovalStatus,
    basePointUpdatedAt: r.basePointUpdatedAt ? r.basePointUpdatedAt.toISOString() : null,

    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

function assertAgencyAccess(agencyId: bigint, siteAgencyId: bigint | null) {
  if (siteAgencyId == null || siteAgencyId !== agencyId) throw new Error("FORBIDDEN");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;

    const idStr = String(id ?? "").trim();
    if (!isValidNumericId(idStr)) throw new Error("VALIDATION:id");
    const siteId = BigInt(idStr);

    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: {
        id: true,
        companyName: true,
        address: true,
        detailAddress: true,
        gpsLat: true,
        allowanceRange: true,
        gpsLon: true,
        agencyId: true,
        managerId: true,
        ownerManagerId: true,
        businessContactName: true,
        businessContactPhone: true,
        businessContactEmail: true,
        requiredProfession: true,
        basePointConfirmed: true,
        basePointAuthority: true,
        basePointApprovalStatus: true,
        basePointUpdatedAt: true,
        isActive: true,
        createdAt: true,
        agency: { select: { id: true, name: true } },
        ownerManager: { select: { id: true, displayName: true, loginId: true } },
        agencyManager: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
    if (!site) throw new Error("NOT_FOUND");

    // manager는 본인 agency 사이트만, admin(운영자)은 전체 접근
    if (session.kind === "manager") assertAgencyAccess(session.agencyId, site.agencyId);

    return NextResponse.json({ success: true, item: toRow(site) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json(
      { success: false, message: msg },
      { status: errToStatus(msg) }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;

    const idStr = String(id ?? "").trim();
    if (!isValidNumericId(idStr)) throw new Error("VALIDATION:id");
    const siteId = BigInt(idStr);

    const existing = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, agencyId: true },
    });
    if (!existing) throw new Error("NOT_FOUND");

    if (session.kind === "manager") assertAgencyAccess(session.agencyId, existing.agencyId);

    const body = await req.json();

    // ✅ 정책에 따라 수정 가능한 필드만 선택적으로 허용
    const companyName =
      body.companyName == null ? undefined : String(body.companyName).trim();
    const address = body.address == null ? undefined : String(body.address).trim();
    const detailAddress =
      body.detailAddress == null ? undefined : String(body.detailAddress).trim();
    const gpsLat = body.gpsLat == null ? undefined : String(body.gpsLat).trim();
    const gpsLon = body.gpsLon == null ? undefined : String(body.gpsLon).trim();
    const managerIdRaw =
      body.managerId == null ? undefined : String(body.managerId).trim();
    const allowanceRange =
      body.allowanceRange == null ? undefined : Number(body.allowanceRange);
    const businessContactName =
      body.businessContactName == null ? undefined : String(body.businessContactName).trim();
    const businessContactPhone =
      body.businessContactPhone == null ? undefined : String(body.businessContactPhone).trim();
    const businessContactEmail =
      body.businessContactEmail == null ? undefined : String(body.businessContactEmail).trim();

    const data: Prisma.SiteUpdateInput = {};

    if (businessContactName !== undefined) {
      if (!businessContactName) throw new Error("VALIDATION:businessContactName");
      data.businessContactName = businessContactName;
    }
    if (businessContactPhone !== undefined) {
      if (!businessContactPhone) throw new Error("VALIDATION:businessContactPhone");
      data.businessContactPhone = businessContactPhone;
    }
    if (businessContactEmail !== undefined) {
      data.businessContactEmail = businessContactEmail || null;
    }

    if (companyName !== undefined) {
      if (!companyName) throw new Error("VALIDATION:companyName");
      data.companyName = companyName;
    }

    if (address !== undefined) {
      if (!address) throw new Error("VALIDATION:address");
      data.address = address;
    }

    if (detailAddress !== undefined) {
      data.detailAddress = detailAddress || null;
    }

    if (gpsLat !== undefined || gpsLon !== undefined) {
      if (!gpsLat || !gpsLon) throw new Error("VALIDATION:gpsLatLon");
      data.gpsLat = new Prisma.Decimal(gpsLat);
      data.gpsLon = new Prisma.Decimal(gpsLon);
    }

    if (allowanceRange !== undefined) {
      if (isNaN(allowanceRange) || allowanceRange < 50 || allowanceRange > 1000) {
        throw new Error("VALIDATION:allowanceRange (50~1000m)");
      }
      data.allowanceRange = allowanceRange;
    }

    // ✅ managerId 빨간줄(스코프 문제) 해결: 파싱/검증/할당을 if 블록 내부에서 처리
    if (managerIdRaw !== undefined) {
      if (!managerIdRaw) throw new Error("VALIDATION:managerId");

      let managerId: bigint;
      try {
        managerId = BigInt(managerIdRaw);
      } catch {
        throw new Error("VALIDATION:managerId");
      }

      data.agencyManager = { connect: { id: managerId } };

      const m = await prisma.agencyManager.findUnique({
        where: { id: managerId },
        select: { agencyId: true },
      });
      if (!m) throw new Error("VALIDATION:managerId");
      // 담당자는 사이트 귀속 에이전시 소속이어야 함(manager는 본인 agency = 사이트 agency)
      const requiredAgencyId = session.kind === "manager" ? session.agencyId : existing.agencyId;
      if (m.agencyId !== requiredAgencyId) throw new Error("FORBIDDEN");
    }

    // ✅ 담당 관리자(Manager 로그인) 지정/이관/해제
    //    null/빈값 = 미지정(공용)으로 해제, 값 있으면 같은 에이전시 관리자로 지정/이관
    if (body.ownerManagerId !== undefined) {
      const raw = body.ownerManagerId;
      if (raw === null || String(raw).trim() === "") {
        data.ownerManager = { disconnect: true };
      } else if (String(raw).trim() === "self" && session.kind === "manager") {
        // 목록에서 "내 담당으로 지정" — 요청 관리자 본인으로 지정
        data.ownerManager = { connect: { id: session.managerId } };
      } else {
        let oid: bigint;
        try { oid = BigInt(String(raw)); } catch { throw new Error("VALIDATION:ownerManagerId"); }
        const m = await prisma.manager.findUnique({ where: { id: oid }, select: { agencyId: true } });
        const requiredAgencyId = session.kind === "manager" ? session.agencyId : existing.agencyId;
        if (!m || m.agencyId !== requiredAgencyId) throw new Error("VALIDATION:ownerManagerId");
        data.ownerManager = { connect: { id: oid } };
      }
    }

    const updated = await prisma.site.update({
      where: { id: siteId },
      data,
      select: {
        id: true,
        companyName: true,
        address: true,
        detailAddress: true,
        gpsLat: true,
        gpsLon: true,
        agencyId: true,
        managerId: true,
        ownerManagerId: true,
        businessContactName: true,
        businessContactPhone: true,
        businessContactEmail: true,
        basePointConfirmed: true,
        basePointAuthority: true,
        basePointApprovalStatus: true,
        basePointUpdatedAt: true,
        isActive: true,
        createdAt: true,
        agency: { select: { id: true, name: true } },
        ownerManager: { select: { id: true, displayName: true, loginId: true } },
        agencyManager: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });

    return NextResponse.json({ success: true, item: toRow(updated) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json(
      { success: false, message: msg },
      { status: errToStatus(msg) }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;

    const idStr = String(id ?? "").trim();
    if (!isValidNumericId(idStr)) throw new Error("VALIDATION:id");
    const siteId = BigInt(idStr);

    const existing = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, agencyId: true },
    });
    if (!existing) throw new Error("NOT_FOUND");

    if (session.kind === "manager") assertAgencyAccess(session.agencyId, existing.agencyId);

    await prisma.site.delete({ where: { id: siteId } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json(
      { success: false, message: msg },
      { status: errToStatus(msg) }
    );
  }
}
