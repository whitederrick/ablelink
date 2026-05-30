// app/api/recruit/posts/[id]/route.ts
// 공고 상세 (워커/user) + 본인 신청 여부
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const { id } = await params;
    const postId = parseBigInt(id);
    if (!postId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const p = await prisma.recruitPost.findUnique({
      where: { id: postId },
      include: {
        applications: { where: { workerId }, select: { id: true, status: true } },
        agency: { select: { name: true } },
      },
    });
    if (!p) return NextResponse.json({ success: false, message: "공고를 찾을 수 없습니다." }, { status: 404 });

    return NextResponse.json({
      success: true,
      post: {
        id: p.id.toString(),
        title: p.title,
        companyName: p.companyName,
        profession: p.profession,
        taskName: p.taskName ?? null,
        address: p.address,
        detailAddress: p.detailAddress ?? null,
        lat: p.lat != null ? Number(p.lat) : null,
        lon: p.lon != null ? Number(p.lon) : null,
        region: p.region ?? null,
        workHours: p.workHours ?? null,
        workDays: p.workDays ?? null,
        payInfo: p.payInfo ?? null,
        headcount: p.headcount,
        description: p.description ?? null,
        status: p.status,
        agencyName: p.agency?.name ?? null,
        contactName: p.contactName ?? null,
        contactPhone: p.contactPhone ?? null,
        createdAt: p.createdAt.toISOString(),
        myApplication: p.applications[0] ? { id: p.applications[0].id.toString(), status: p.applications[0].status } : null,
      },
    });
  } catch (e: any) {
    console.error("[recruit/posts/[id] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
