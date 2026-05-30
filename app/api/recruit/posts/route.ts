// app/api/recruit/posts/route.ts
// 직무지도 매칭 마켓플레이스 — 공급측(워커/user) 공고 검색·조회
// 로그인한 worker 세션 기준. 본인의 신청 여부도 함께 반환.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const profession = searchParams.get("profession") || "";
    const region = (searchParams.get("region") || "").trim();

    const where: any = { status: "OPEN" };
    if (["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"].includes(profession)) where.profession = profession;
    if (region) where.region = { contains: region, mode: "insensitive" };
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { companyName: { contains: q, mode: "insensitive" } },
        { taskName: { contains: q, mode: "insensitive" } },
        { address: { contains: q, mode: "insensitive" } },
      ];
    }

    const posts = await prisma.recruitPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        applications: { where: { workerId }, select: { id: true, status: true } },
        _count: { select: { applications: true } },
      },
    });

    return NextResponse.json({
      success: true,
      posts: posts.map((p) => ({
        id: p.id.toString(),
        title: p.title,
        companyName: p.companyName,
        profession: p.profession,
        taskName: p.taskName ?? null,
        address: p.address,
        region: p.region ?? null,
        workHours: p.workHours ?? null,
        workDays: p.workDays ?? null,
        payInfo: p.payInfo ?? null,
        headcount: p.headcount,
        createdAt: p.createdAt.toISOString(),
        applicationCount: p._count.applications,
        myApplication: p.applications[0] ? { id: p.applications[0].id.toString(), status: p.applications[0].status } : null,
      })),
    });
  } catch (e: any) {
    console.error("[recruit/posts GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
