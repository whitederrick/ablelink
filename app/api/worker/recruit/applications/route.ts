// app/api/worker/recruit/applications/route.ts
// GET: 내 신청 목록 / DELETE: 신청 취소(WITHDRAWN)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const apps = await prisma.recruitApplication.findMany({
      where: { workerId },
      orderBy: { createdAt: "desc" },
      include: { post: { select: { id: true, title: true, companyName: true, profession: true, region: true, status: true } } },
    });

    return NextResponse.json({
      success: true,
      applications: apps.map((a) => ({
        id: a.id.toString(),
        status: a.status,
        message: a.message ?? null,
        createdAt: a.createdAt.toISOString(),
        decidedAt: a.decidedAt?.toISOString() ?? null,
        post: {
          id: a.post.id.toString(),
          title: a.post.title,
          companyName: a.post.companyName,
          profession: a.post.profession,
          region: a.post.region ?? null,
          status: a.post.status,
        },
      })),
    });
  } catch (e: any) {
    console.error("[worker/recruit/applications GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const { searchParams } = new URL(req.url);
    const appId = parseBigInt(searchParams.get("id"));
    if (!appId) return NextResponse.json({ success: false, message: "신청 ID가 필요합니다." }, { status: 400 });

    const app = await prisma.recruitApplication.findUnique({ where: { id: appId } });
    if (!app || app.workerId !== workerId) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }
    if (app.status === "ACCEPTED") {
      return NextResponse.json({ success: false, message: "이미 수락된 신청은 취소할 수 없습니다." }, { status: 409 });
    }
    await prisma.recruitApplication.update({ where: { id: appId }, data: { status: "WITHDRAWN" } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[worker/recruit/applications DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
