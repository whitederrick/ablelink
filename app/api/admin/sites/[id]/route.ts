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

    // ✅ 사업체 담당자(현장 연락 담당자)
    businessContactName: r.businessContactName ?? null,
    businessContactPhone: r.businessContactPhone ?? null,
    businessContactEmail: r.businessContactEmail ?? null,

    requiredProfession: r.requiredProfession ?? null,

    allowanceRange: r.allowanceRange ?? 100,
    lateThresholdMin: r.lateThresholdMin ?? null,
    amCapacity: r.amCapacity ?? 0,
    pmCapacity: r.pmCapacity ?? 0,
    fullDayCapacity: r.fullDayCapacity ?? 0,

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
        lateThresholdMin: true,
        amCapacity: true,
        pmCapacity: true,
        fullDayCapacity: true,
        gpsLon: true,
        agencyId: true,
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
    const allowanceRange =
      body.allowanceRange == null ? undefined : Number(body.allowanceRange);
    const parseCap = (v: any) => (v == null ? undefined : Math.max(0, Math.min(99, Math.floor(Number(v)) || 0)));
    const amCapacity = parseCap(body.amCapacity);
    const pmCapacity = parseCap(body.pmCapacity);
    const fullDayCapacity = parseCap(body.fullDayCapacity);
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

    // 지각 인정 기준(분). null/빈값 = 위탁기관 기본값 상속(컬럼 null로 저장).
    if (body.lateThresholdMin !== undefined) {
      const v = body.lateThresholdMin === null || body.lateThresholdMin === "" ? null : Number(body.lateThresholdMin);
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 180)) {
        throw new Error("VALIDATION:lateThresholdMin (0~180)");
      }
      (data as any).lateThresholdMin = v;
    }

    if (amCapacity !== undefined) data.amCapacity = amCapacity;
    if (pmCapacity !== undefined) data.pmCapacity = pmCapacity;
    if (fullDayCapacity !== undefined) data.fullDayCapacity = fullDayCapacity;

    // 활성/비활성 전환(재활성화 포함)
    if (body.isActive !== undefined) {
      data.isActive = body.isActive === true || body.isActive === "true";
    }

    // ✅ 담당 관리자(Manager 로그인) 지정/이관/해제
    //    null/빈값 = 미지정(공용)으로 해제, 값 있으면 같은 위탁기관 관리자로 지정/이관
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
        allowanceRange: true,
        lateThresholdMin: true,
        amCapacity: true,
        pmCapacity: true,
        fullDayCapacity: true,
        agencyId: true,
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

    // 하드 삭제 대신 비활성화(소프트 삭제) — 배정·문서 등 연관 데이터가 있어도 안전.
    await prisma.site.update({ where: { id: siteId }, data: { isActive: false } });
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
