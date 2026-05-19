// app/api/admin/sites/[id]/trainees/route.ts
// 사이트별 배치(placement) 훈련생 목록 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const idStr = String(id ?? "").trim();
    if (!isValidNumericId(idStr)) throw new Error("VALIDATION:id");
    const siteId = BigInt(idStr);

    // ✅ AGENCY 스코프면 해당 site가 내 agency 소속인지 검증
    if (scope.role === "AGENCY") {
      const agencyId = requireAgencyScope(scope);
      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { id: true, agencyId: true },
      });
      if (!site) throw new Error("NOT_FOUND");
      if (site.agencyId == null || site.agencyId !== agencyId) throw new Error("FORBIDDEN");
    }

    const rows = await prisma.traineePlacement.findMany({
      where: { siteId },
      orderBy: { id: "desc" },
      select: {
        id: true,
        traineeId: true,
        siteId: true,
        startDate: true,
        endDate: true,
        status: true,
        trainee: {
          select: {
            id: true,
            name: true,
            birthDate: true,
            gender: true,
            phoneNumber: true,
            disabilityType: true,
            severity: true,
            status: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      items: rows.map((p) => ({
        id: String(p.id),
        traineeId: String(p.traineeId),
        siteId: String(p.siteId),
        startDate: p.startDate.toISOString(),
        endDate: p.endDate ? p.endDate.toISOString() : null,
        status: p.status,
        trainee: p.trainee
          ? {
              id: String(p.trainee.id),
              name: p.trainee.name,
              birthDate: p.trainee.birthDate ?? null,
              gender: p.trainee.gender,
              phoneNumber: p.trainee.phoneNumber ?? null,
              disabilityType: p.trainee.disabilityType,
              severity: p.trainee.severity,
              status: p.trainee.status,
            }
          : null,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
