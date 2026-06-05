// app/api/worker/attendance/issues/[id]/reason/route.ts
// 워커가 매니저의 사유 등록 요청에 대해 사유를 제출 → 이슈 REPLIED 전환.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });
    const issueId = BigInt(id);

    const body = await req.json().catch(() => ({} as any));
    const reason = String(body?.reason ?? "").trim();
    if (!reason) return NextResponse.json({ success: false, message: "사유를 입력해주세요." }, { status: 400 });

    // 본인 근태의 이슈인지 + 요청(REQUESTED) 또는 이미 답변(REPLIED, 재작성 허용) 상태인지 검증
    const issue = await prisma.attendanceIssue.findFirst({
      where: { id: issueId, dailyAttendance: { workerId }, status: { in: ["REQUESTED", "REPLIED"] } },
      select: { id: true },
    });
    if (!issue) return NextResponse.json({ success: false, message: "사유를 입력할 수 있는 요청이 아닙니다." }, { status: 404 });

    await prisma.attendanceIssue.update({
      where: { id: issueId },
      data: {
        workerReasonText: reason.slice(0, 1000),
        status: "REPLIED",
        repliedAt: new Date(),
        events: {
          create: [{
            type: "REASON_REPLIED",
            actorRole: "WORKER",
            actorWorkerId: workerId,
            message: reason.slice(0, 200),
          }],
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[worker/attendance/issues/[id]/reason POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
