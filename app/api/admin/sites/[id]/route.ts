// app/api/admin/sites/[id]/route.ts
// 관리자 사이트 상세 조회/수정/삭제 API (schema.prisma Site 기준)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireManagerSession } from "@/lib/managerScope";

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

    managerId: r.managerId != null ? String(r.managerId) : null,
    managerName: r.agencyManager?.name ?? null,
    managerEmail: r.agencyManager?.email ?? null,
    managerPhone: r.agencyManager?.phoneNumber ?? null,

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
    const scope = await requireManagerSession(req);
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
        basePointConfirmed: true,
        basePointAuthority: true,
        basePointApprovalStatus: true,
        basePointUpdatedAt: true,
        isActive: true,
        createdAt: true,
        agency: { select: { id: true, name: true } },
        agencyManager: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
    if (!site) throw new Error("NOT_FOUND");

    assertAgencyAccess(scope.agencyId, site.agencyId);

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
    const scope = await requireManagerSession(req);
    const { id } = await params;

    const idStr = String(id ?? "").trim();
    if (!isValidNumericId(idStr)) throw new Error("VALIDATION:id");
    const siteId = BigInt(idStr);

    const existing = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, agencyId: true },
    });
    if (!existing) throw new Error("NOT_FOUND");

    assertAgencyAccess(scope.agencyId, existing.agencyId);

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

    const data: Prisma.SiteUpdateInput = {};

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
      if (m.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");
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
        basePointConfirmed: true,
        basePointAuthority: true,
        basePointApprovalStatus: true,
        basePointUpdatedAt: true,
        isActive: true,
        createdAt: true,
        agency: { select: { id: true, name: true } },
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
    const scope = await requireManagerSession(req);
    const { id } = await params;

    const idStr = String(id ?? "").trim();
    if (!isValidNumericId(idStr)) throw new Error("VALIDATION:id");
    const siteId = BigInt(idStr);

    const existing = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, agencyId: true },
    });
    if (!existing) throw new Error("NOT_FOUND");

    assertAgencyAccess(scope.agencyId, existing.agencyId);

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
