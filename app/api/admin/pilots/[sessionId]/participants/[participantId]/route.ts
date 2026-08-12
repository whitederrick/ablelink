// DELETE /api/admin/pilots/[sessionId]/participants/[participantId] — 참여 취소
//
// 취소는 삭제가 아니다. 상태를 CANCELLED로 바꾸고 연결된 초대를 즉시 무효화한다
// (감사 근거와 참여 이력을 남긴다).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { cancelPilotParticipant } from "@/lib/pilot/participant";
import { audit } from "@/lib/audit";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string; participantId: string }> },
) {
  try {
    const scope = await requireAdminSession(req);
    const { sessionId: rawSession, participantId: rawParticipant } = await ctx.params;
    const sessionId = parseBigInt(rawSession);
    const participantId = parseBigInt(rawParticipant);
    if (!sessionId || !participantId) {
      return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    }

    // 경로의 회차와 참여자가 실제로 연결돼 있는지 확인(경로 위조 방지).
    const owned = await prisma.pilotParticipant.findFirst({
      where: { id: participantId, pilotSessionId: sessionId },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ success: false, message: "이 회차의 참여자가 아닙니다." }, { status: 404 });
    }

    const r = await cancelPilotParticipant(participantId);
    if (!r.ok) {
      return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
    }

    await audit(scope, {
      entityType: "PilotParticipant", entityId: participantId, action: "update",
      summary: r.value.invalidatedInvite ? "파일럿 참여 취소(초대 무효화)" : "파일럿 참여 취소",
    });

    return NextResponse.json({ success: true, invalidatedInvite: r.value.invalidatedInvite });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/participants DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
