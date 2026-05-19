// app/api/app/assignments/route.ts
// 직무지도원(앱) - 내 배정 목록 조회
// GET /api/app/assignments?userId=123
// - 기본: ASSIGNED/CONFIRMED/ACTIVE만 반환
// - includePast=1 이면 과거 포함(단, status 파라미터가 있으면 그 값으로 제한)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function errToStatus(msg: string) {
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function asIso(d: any) {
  return d?.toISOString?.() ?? d ?? null;
}

function toItem(r: any) {
  return {
    id: String(r.id),
    userId: String(r.userId),
    siteId: String(r.siteId),
    status: r.status,

    startDate: asIso(r.startDate),
    endDate: asIso(r.endDate),

    assignedAt: asIso(r.assignedAt),
    confirmedAt: asIso(r.confirmedAt),
    rejectedAt: asIso(r.rejectedAt),
    droppedAt: asIso(r.droppedAt),
    endedAt: asIso(r.endedAt),

    isMainCoach: r.isMainCoach ?? true,
    statusReason: r.statusReason ?? null,

    site: r.site
      ? {
          id: String(r.site.id),
          companyName: r.site.companyName,
          address: r.site.address,
          detailAddress: r.site.detailAddress ?? null,
          gpsLat: r.site.gpsLat != null ? String(r.site.gpsLat) : null,
          gpsLon: r.site.gpsLon != null ? String(r.site.gpsLon) : null,
          allowanceRange: r.site.allowanceRange,
          currentBasePointId: r.site.currentBasePointId != null ? String(r.site.currentBasePointId) : null,
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const userIdStr = String(searchParams.get("userId") ?? "").trim();
    if (!isValidNumericId(userIdStr)) throw new Error("VALIDATION:userId");
    const userId = BigInt(userIdStr);

    const includePast = String(searchParams.get("includePast") ?? "").trim() === "1";

    // status 복수 허용: ?status=ASSIGNED&status=CONFIRMED ...
    const statusParams = searchParams
      .getAll("status")
      .map((s) => s.trim())
      .filter(Boolean);

    const defaultStatuses = ["ASSIGNED", "CONFIRMED", "ACTIVE"];
    const statuses = statusParams.length > 0 ? statusParams : defaultStatuses;

    const where: any = { userId };

    if (!includePast) {
      where.status = { in: statuses };
    } else {
      if (statusParams.length > 0) where.status = { in: statuses };
      // includePast=1 + status 미지정이면 전체 상태 반환
    }

    const rows = await prisma.siteAssignment.findMany({
      where,
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        userId: true,
        siteId: true,
        status: true,

        startDate: true,
        endDate: true,

        assignedAt: true,
        confirmedAt: true,
        rejectedAt: true,
        droppedAt: true,
        endedAt: true,

        isMainCoach: true,
        statusReason: true,

        site: {
          select: {
            id: true,
            companyName: true,
            address: true,
            detailAddress: true,
            gpsLat: true,
            gpsLon: true,
            allowanceRange: true,
            currentBasePointId: true,
          },
        },
      },
    });

    return NextResponse.json({ success: true, items: rows.map(toItem) });
  } catch (e: any) {
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
