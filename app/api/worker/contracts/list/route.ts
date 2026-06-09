// app/api/worker/contracts/list/route.ts
// 직무지도원 본인의 근로계약서 목록 (히스토리)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const rows = await prisma.employmentContract.findMany({
      where: { workerId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { agency: { select: { name: true } } },
    });

    return NextResponse.json({
      success: true,
      items: rows.map(c => ({
        id: String(c.id),
        agencyName: c.agency?.name ?? "",
        status: c.status,
        contractStart: c.contractStart.toISOString().slice(0, 10),
        contractEnd: c.contractEnd.toISOString().slice(0, 10),
        workLocation: c.workLocation || c.siteName || c.workerFilledSiteName || "",
        workerSignedAt: c.workerSignedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        signToken: c.status === "PENDING" ? c.signToken : null,
      })),
    });
  } catch (e: any) {
    console.error("[worker/contracts/list]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
