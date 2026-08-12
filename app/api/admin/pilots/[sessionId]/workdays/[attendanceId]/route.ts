// PATCH  /api/admin/pilots/[sessionId]/workdays/[attendanceId] — 근무일 시각 정정
// DELETE /api/admin/pilots/[sessionId]/workdays/[attendanceId] — 근무일 삭제
//
// 시스템 운영자 전용. v1.8 §10·§12 8단계.
// ★삭제는 일지가 붙어 있으면 기본 차단(409)이고, 화면이 건수를 보여준 뒤 ?force=1로만 진행한다
//  (TraineeLog.attendanceId가 Cascade라 일지가 조용히 함께 사라진다).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { updatePilotWorkday, deletePilotWorkday } from "@/lib/pilot/workday";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ sessionId: string; attendanceId: string }> };

async function ids(ctx: Ctx): Promise<{ pilotSessionId: bigint; attendanceId: bigint } | null> {
  const { sessionId, attendanceId } = await ctx.params;
  const s = parseBigInt(sessionId);
  const a = parseBigInt(attendanceId);
  if (!s || !a) return null;
  return { pilotSessionId: s, attendanceId: a };
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const scope = await requireAdminSession(req);
    const parsed = await ids(ctx);
    if (!parsed) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const r = await updatePilotWorkday({
      ...parsed,
      start: String(body?.start ?? "").trim(),
      end: String(body?.end ?? "").trim(),
    });
    if (!r.ok) {
      return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
    }

    await audit(scope, {
      entityType: "DailyAttendance", entityId: parsed.attendanceId, action: "update",
      after: { start: String(body?.start ?? ""), end: String(body?.end ?? "") },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/workdays PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const scope = await requireAdminSession(req);
    const parsed = await ids(ctx);
    if (!parsed) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const force = new URL(req.url).searchParams.get("force") === "1";
    const r = await deletePilotWorkday({ ...parsed, force });
    if (!r.ok) {
      return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
    }

    await audit(scope, {
      entityType: "DailyAttendance", entityId: parsed.attendanceId, action: "delete",
      summary: `파일럿 근무일 삭제(일지 ${r.value.deletedLogs}건 동반)`,
    });
    return NextResponse.json({ success: true, deletedLogs: r.value.deletedLogs });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/workdays DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
