export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { id } = await params;
    const ev = await prisma.traineeEvaluation.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, writerId: true, isConfirmed: true },
    });

    if (!ev) return NextResponse.json({ success: false, message: "평가를 찾을 수 없습니다." }, { status: 404 });
    if (ev.writerId.toString() !== session.userId)
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (ev.isConfirmed)
      return NextResponse.json({ success: false, message: "이미 확정된 평가입니다." }, { status: 409 });

    await prisma.traineeEvaluation.update({
      where: { id: ev.id },
      data: { isConfirmed: true, confirmedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[evaluation/[id]/confirm]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
