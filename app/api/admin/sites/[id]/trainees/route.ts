// app/api/admin/sites/[id]/trainees/route.ts
// 사이트별 배치(placement) 훈련생 목록 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { logAccess } from "@/lib/accessLog";

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
    const scope = await requireManagerSession(req);

    const { id } = await params;
    const idStr = String(id ?? "").trim();
    if (!isValidNumericId(idStr)) throw new Error("VALIDATION:id");
    const siteId = BigInt(idStr);

    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, agencyId: true },
    });
    if (!site) throw new Error("NOT_FOUND");
    if (site.agencyId == null || site.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");

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

    // 접속기록(제8조): 훈련생 배치 목록도 생년월일·연락처·장애유형/정도(민감정보) 노출 → 열람 1건 집계 기록.
    if (rows.length > 0) {
      await logAccess(req, scope, {
        subjectType: "Trainee", subjectId: null, subjectLabel: `현장 훈련생 목록 ${rows.length}명`,
        resource: "disability", action: "view",
      });
    }

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
    const st = errToStatus(msg);
    return NextResponse.json({ success: false, message: st === 500 ? "서버 오류" : msg }, { status: st });
  }
}
