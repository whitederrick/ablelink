export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const now  = new Date();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = prisma as any;
    if (body.id) {
      const idStr = String(body.id);
      if (!/^\d+$/.test(idStr))
        return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });
      await db.workerNotice.updateMany({
        where: { id: BigInt(idStr), workerId: BigInt(session.workerId), readAt: null },
        data: { readAt: now },
      });
    } else {
      await db.workerNotice.updateMany({
        where: { workerId: BigInt(session.workerId), readAt: null },
        data: { readAt: now },
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[worker/notices/read POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
