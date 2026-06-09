// app/api/admin/system/surveys/route.ts
// 운영자(시스템): 모든 만족도 조사 결과 조회 + 에이전시 전달 토글

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const rows = await prisma.satisfactionSurvey.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        worker: { select: { workerName: true } },
        agency: { select: { name: true } },
      },
    });
    return NextResponse.json({
      success: true,
      items: rows.map(r => ({
        id: String(r.id),
        agencyName: r.agency?.name ?? "",
        workerName: r.worker?.workerName ?? "",
        recipientName: r.recipientName,
        recipientPhone: r.recipientPhone,
        siteName: r.siteName,
        status: r.status,
        auto: r.auto,
        scores: r.scores ?? null,
        overallScore: r.overallScore,
        comment: r.comment,
        sharedWithAgency: r.sharedWithAgency,
        sentAt: r.sentAt?.toISOString() ?? null,
        respondedAt: r.respondedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/surveys GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// PATCH: 결과를 에이전시에 전달(공유) 토글
export async function PATCH(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const body = await req.json();
    let id: bigint;
    try { id = BigInt(body.id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }
    await prisma.satisfactionSurvey.update({
      where: { id },
      data: { sharedWithAgency: body.sharedWithAgency === true },
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/surveys PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
