export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const unconfirm = body?.unconfirm === true;

    const log = await prisma.traineeLog.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, writerId: true, isCompleted: true },
    });

    if (!log) return NextResponse.json({ success: false, message: "일지를 찾을 수 없습니다." }, { status: 404 });
    if (log.writerId.toString() !== session.workerId)
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });

    if (unconfirm) {
      await prisma.traineeLog.update({ where: { id: log.id }, data: { isCompleted: false } });
      await audit(session, { entityType: "TraineeLog", entityId: log.id, action: "update", summary: "일지 완료 취소" });
      return NextResponse.json({ success: true, action: "unconfirmed" });
    }

    if (log.isCompleted)
      return NextResponse.json({ success: false, message: "이미 확정된 일지입니다." }, { status: 409 });

    await prisma.traineeLog.update({ where: { id: log.id }, data: { isCompleted: true } });
    await audit(session, { entityType: "TraineeLog", entityId: log.id, action: "update", summary: "일지 완료" });
    return NextResponse.json({ success: true, action: "confirmed" });
  } catch (e: any) {
    console.error("[logs/[id]/confirm]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
