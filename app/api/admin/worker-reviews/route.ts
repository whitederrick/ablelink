// app/api/admin/worker-reviews/route.ts
// 에이전시/공단 — 매칭된 인력(직무지도원 등) 평점·후기. 매칭(수락된 신청/제안) 이력이 있어야 평가 가능.
// 평가 주체별 1건(upsert) + Worker.ratingAvg/ratingCount 집계 갱신.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

// 평가 주체가 이 worker와 매칭 이력(수락)이 있는지
async function hasEngagement(session: any, workerId: bigint): Promise<boolean> {
  if (session.kind === "manager") {
    const app = await prisma.recruitApplication.findFirst({
      where: { workerId, status: "ACCEPTED", post: { OR: [{ createdByManagerId: session.managerId }, { agencyId: session.agencyId }] } },
      select: { id: true },
    });
    if (app) return true;
    const offer = await prisma.talentOffer.findFirst({ where: { workerId, status: "ACCEPTED", agencyId: session.agencyId }, select: { id: true } });
    if (offer) return true;
    const asg = await prisma.siteAssignment.findFirst({ where: { workerId, agencyId: session.agencyId }, select: { id: true } });
    return !!asg;
  } else {
    const app = await prisma.recruitApplication.findFirst({ where: { workerId, status: "ACCEPTED", post: { createdByAdminId: session.adminId } }, select: { id: true } });
    if (app) return true;
    const offer = await prisma.talentOffer.findFirst({ where: { workerId, status: "ACCEPTED", createdByAdminId: session.adminId }, select: { id: true } });
    return !!offer;
  }
}

async function recomputeAggregate(workerId: bigint) {
  const agg = await prisma.workerReview.aggregate({ where: { workerId }, _avg: { rating: true }, _count: true });
  await prisma.worker.update({
    where: { id: workerId },
    data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count },
  });
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminOrManagerSession(req);
    const { searchParams } = new URL(req.url);
    const workerId = parseBigInt(searchParams.get("workerId"));
    if (!workerId) return NextResponse.json({ success: false, message: "workerId 필요" }, { status: 400 });

    const reviews = await prisma.workerReview.findMany({
      where: { workerId },
      orderBy: { createdAt: "desc" },
      include: { agency: { select: { name: true } } },
    });
    const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { ratingAvg: true, ratingCount: true } });
    return NextResponse.json({
      success: true,
      ratingAvg: Number(worker?.ratingAvg ?? 0),
      ratingCount: worker?.ratingCount ?? 0,
      reviews: reviews.map((r) => ({
        id: r.id.toString(),
        rating: r.rating,
        comment: r.comment ?? null,
        by: r.agency?.name ?? "(공단/플랫폼)",
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/worker-reviews GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const b = await req.json();
    const workerId = parseBigInt(b.workerId);
    const rating = Math.round(Number(b.rating));
    if (!workerId || !(rating >= 1 && rating <= 5))
      return NextResponse.json({ success: false, message: "평점(1~5)과 대상이 필요합니다." }, { status: 400 });
    const comment = b.comment != null ? String(b.comment).trim().slice(0, 1000) || null : null;

    if (!(await hasEngagement(session, workerId)))
      return NextResponse.json({ success: false, message: "매칭(수락) 이력이 있는 인력만 평가할 수 있습니다." }, { status: 403 });

    // 평가 주체별 1건 upsert
    const mine = session.kind === "manager"
      ? { agencyId: session.agencyId }
      : { createdByAdminId: session.adminId };
    const existing = await prisma.workerReview.findFirst({ where: { workerId, ...mine } });
    if (existing) {
      await prisma.workerReview.update({ where: { id: existing.id }, data: { rating, comment } });
    } else {
      await prisma.workerReview.create({
        data: {
          workerId, rating, comment,
          agencyId: session.kind === "manager" ? session.agencyId : null,
          managerId: session.kind === "manager" ? session.managerId : null,
          createdByAdminId: session.kind === "admin" ? session.adminId : null,
        },
      });
    }
    await recomputeAggregate(workerId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/worker-reviews POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
