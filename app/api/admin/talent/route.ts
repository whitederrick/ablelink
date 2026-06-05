// app/api/admin/talent/route.ts
// 에이전시/공단 — 구직중(openToOffers) 후보자 풀 검색 (방향 B)
// 개인정보 보호: 검색 결과엔 연락처 비노출 (제안→수락 시 별도 연락)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);

    // 인재풀 검색·역제안은 PRO 전용. 에이전시(매니저)만 게이트, 운영자는 예외.
    if (session.kind === "manager") {
      const access = await checkAgencyPlanAccess(session.agencyId, "TALENT_SOURCING");
      if (!access.allowed) {
        return NextResponse.json({ success: false, message: access.message || "PRO 플랜에서 사용할 수 있는 기능입니다.", reason: access.reason }, { status: 403 });
      }
    }

    const { searchParams } = new URL(req.url);
    const region = (searchParams.get("region") || "").trim();
    const verifiedOnly = searchParams.get("verifiedOnly") === "1";

    // 매칭은 직무지도원 직종만 운영 — 서버에서 강제.
    const profWhere: any = { profession: "JOB_COACH" };
    if (verifiedOnly) profWhere.verifyStatus = "VERIFIED";

    const where: any = {
      openToOffers: true,
      status: "ACTIVE",
      professions: { some: profWhere },
    };
    if (region) where.residenceAddress = { contains: region, mode: "insensitive" };

    const workers = await prisma.worker.findMany({
      where,
      orderBy: [{ ratingAvg: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true, workerName: true, residenceAddress: true, bio: true, ratingAvg: true, ratingCount: true,
        professions: { select: { profession: true, experienceYears: true, isPrimary: true, verifyStatus: true } },
      },
    });

    return NextResponse.json({
      success: true,
      candidates: workers.map((w) => ({
        id: w.id.toString(),
        name: w.workerName,
        // 개인정보 보호: 전체 거주지 대신 시/군/구 수준만 노출 (제안 수락 전)
        region: w.residenceAddress ? w.residenceAddress.trim().split(/\s+/).slice(0, 2).join(" ") : null,
        bio: w.bio ?? null,
        ratingAvg: Number(w.ratingAvg),
        ratingCount: w.ratingCount,
        professions: w.professions.map((p) => ({ profession: p.profession, experienceYears: p.experienceYears, isPrimary: p.isPrimary, verifyStatus: p.verifyStatus })),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/talent GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
