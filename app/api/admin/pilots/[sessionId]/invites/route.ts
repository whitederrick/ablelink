// POST /api/admin/pilots/[sessionId]/invites — 시스템 운영자 전용 파일럿 초대 발급
//
// ★일반 초대 API(/api/admin/workers/invite)의 권한 구조를 확장하지 않는다. 그쪽은
//  requireManagerSession 전용이며 기존 보안 모델을 건드리지 않는 편이 안전하다.
//  파일럿에는 위탁기관 담당자(Manager) 계정이 없으므로 운영자가 발급하는 별도 경로를 둔다.
//
// 이 라우트는 인증·입력 변환·HTTP 응답만 담당한다.
// 트랜잭션·원자성 규칙은 lib/pilot/issueInvite.ts 한 곳에 있다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { issuePilotInvite } from "@/lib/pilot/issueInvite";
import { audit } from "@/lib/audit";

const PHONE_RE = /^01[016789]\d{7,8}$/;

export async function POST(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { sessionId: rawSessionId } = await ctx.params;
    const sessionId = parseBigInt(rawSessionId);
    if (!sessionId) {
      return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const participantId = parseBigInt(body?.participantId);
    const phoneNumber = String(body?.phoneNumber ?? "").replace(/-/g, "").trim();
    const workerName = String(body?.workerName ?? "").trim() || null;

    if (!participantId) {
      return NextResponse.json({ success: false, message: "참여자를 지정해주세요." }, { status: 400 });
    }
    if (!PHONE_RE.test(phoneNumber)) {
      return NextResponse.json({ success: false, message: "올바른 휴대전화번호를 입력해주세요." }, { status: 400 });
    }

    const result = await issuePilotInvite({
      sessionId,
      participantId,
      phoneNumber,
      workerName,
      createdByAdminId: scope.adminId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: result.message, reason: result.code },
        { status: result.status },
      );
    }

    await audit(scope, {
      entityType: "WorkerInvite",
      entityId: result.invite.id,
      action: "create",
      after: {
        pilotSessionId: sessionId.toString(),
        participantId: participantId.toString(),
        phoneNumber,
      },
    });

    return NextResponse.json({
      success: true,
      invite: {
        id: result.invite.id.toString(),
        code: result.invite.code,
        phoneNumber: result.invite.phoneNumber,
        expiresAt: result.invite.expiresAt.toISOString(),
        assignmentId: result.invite.assignmentId?.toString() ?? null,
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/[sessionId]/invites]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
