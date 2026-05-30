// app/api/admin/recruit-posts/[id]/applications/route.ts
// 공고에 들어온 신청자 목록 (등록 주체만)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;
    const postId = parseBigInt(id);
    if (!postId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const post = await prisma.recruitPost.findUnique({ where: { id: postId } });
    if (!post) return NextResponse.json({ success: false, message: "공고를 찾을 수 없습니다." }, { status: 404 });
    const owned =
      session.kind === "manager"
        ? post.createdByManagerId === session.managerId || post.agencyId === session.agencyId
        : post.createdByAdminId === session.adminId;
    if (!owned) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });

    const apps = await prisma.recruitApplication.findMany({
      where: { recruitPostId: postId },
      orderBy: { createdAt: "asc" },
      include: {
        worker: {
          select: {
            id: true, workerName: true, phoneNumber: true, bio: true,
            residenceAddress: true, ratingAvg: true, ratingCount: true,
            professions: { select: { profession: true, experienceYears: true, isPrimary: true } },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      post: { id: post.id.toString(), title: post.title, companyName: post.companyName, status: post.status, headcount: post.headcount },
      applications: apps.map((a) => ({
        id: a.id.toString(),
        status: a.status,
        message: a.message ?? null,
        createdAt: a.createdAt.toISOString(),
        decidedAt: a.decidedAt?.toISOString() ?? null,
        worker: {
          id: a.worker.id.toString(),
          name: a.worker.workerName,
          phoneNumber: a.worker.phoneNumber,
          bio: a.worker.bio ?? null,
          residenceAddress: a.worker.residenceAddress ?? null,
          ratingAvg: Number(a.worker.ratingAvg),
          ratingCount: a.worker.ratingCount,
          professions: a.worker.professions.map((p) => ({ profession: p.profession, experienceYears: p.experienceYears, isPrimary: p.isPrimary })),
        },
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[recruit-posts/[id]/applications GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
