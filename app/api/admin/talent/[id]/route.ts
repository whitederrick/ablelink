// app/api/admin/talent/[id]/route.ts
// 에이전시/공단 — 후보자 상세(경력 이력·후기 포함). 방향 B 인재풀 상세 조회.
// 개인정보 보호: 연락처/전체 주소 비노출(제안 수락 전). 후기는 평가 주체 익명화.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";

function ageOf(b: string | null): number | null {
  if (!b) return null;
  const d = new Date(b);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? a : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminOrManagerSession(req);

    // 인재풀 상세도 검색과 동일하게 PRO 전용(매니저만 게이트, 운영자 예외).
    if (session.kind === "manager") {
      const access = await checkAgencyPlanAccess(session.agencyId, "TALENT_SOURCING");
      if (!access.allowed) {
        return NextResponse.json({ success: false, message: access.message || "PRO 플랜에서 사용할 수 있는 기능입니다.", reason: access.reason }, { status: 403 });
      }
    }

    const { id } = await params;
    let workerId: bigint;
    try { workerId = BigInt(id); } catch { return NextResponse.json({ success: false, message: "잘못된 요청" }, { status: 400 }); }

    const worker = await prisma.worker.findFirst({
      where: { id: workerId, openToOffers: true, status: "ACTIVE" },
      select: {
        id: true, workerName: true, residenceAddress: true, bio: true,
        ratingAvg: true, ratingCount: true, birthDate: true,
        professions: {
          orderBy: [{ isPrimary: "desc" }, { experienceYears: "desc" }],
          select: { profession: true, experienceYears: true, isPrimary: true, verifyStatus: true, certifiedAt: true },
        },
        experiences: {
          orderBy: { startDate: "desc" },
          select: { profession: true, orgName: true, title: true, startDate: true, endDate: true, description: true },
        },
        reviews: {
          orderBy: { createdAt: "desc" },
          take: 30,
          select: { rating: true, comment: true, createdAt: true },
        },
      },
    });

    if (!worker) return NextResponse.json({ success: false, message: "후보자를 찾을 수 없습니다." }, { status: 404 });

    return NextResponse.json({
      success: true,
      candidate: {
        id: worker.id.toString(),
        name: worker.workerName,
        // 개인정보 보호: 시/군/구 수준만(제안 수락 전)
        region: worker.residenceAddress ? worker.residenceAddress.trim().split(/\s+/).slice(0, 2).join(" ") : null,
        bio: worker.bio ?? null,
        ratingAvg: Number(worker.ratingAvg),
        ratingCount: worker.ratingCount,
        age: ageOf(worker.birthDate ?? null),
        professions: worker.professions.map((p) => ({
          profession: p.profession, experienceYears: p.experienceYears,
          isPrimary: p.isPrimary, verifyStatus: p.verifyStatus,
          certifiedAt: p.certifiedAt ? p.certifiedAt.toISOString().slice(0, 10) : null,
        })),
        experiences: worker.experiences.map((e) => ({
          profession: e.profession, orgName: e.orgName, title: e.title ?? null,
          startDate: e.startDate.toISOString().slice(0, 10),
          endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
          description: e.description ?? null,
        })),
        // 후기: 평가 주체(에이전시/관리자) 익명화 — 평점·코멘트·작성월만
        reviews: worker.reviews.map((r) => ({
          rating: r.rating, comment: r.comment ?? null,
          createdAt: r.createdAt.toISOString().slice(0, 7),
        })),
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/talent/[id] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
