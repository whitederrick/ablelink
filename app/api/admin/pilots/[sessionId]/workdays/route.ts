// GET  /api/admin/pilots/[sessionId]/workdays — 회차 근무일 목록
// POST /api/admin/pilots/[sessionId]/workdays — 근무일 1건 등록
//
// 시스템 운영자 전용. 파일럿 배정(pilotSessionId 보유)만 대상이며, 기존 근태 경로
// (worker/attendance/**)는 건드리지 않는다. v1.8 §10·§12 8단계.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { listPilotWorkdays, createPilotWorkday } from "@/lib/pilot/workday";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    await requireAdminSession(req);
    const { sessionId: raw } = await ctx.params;
    const pilotSessionId = parseBigInt(raw);
    if (!pilotSessionId) {
      return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });
    }
    return NextResponse.json({ success: true, workdays: await listPilotWorkdays(pilotSessionId) });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/[sessionId]/workdays GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { sessionId: raw } = await ctx.params;
    const pilotSessionId = parseBigInt(raw);
    if (!pilotSessionId) {
      return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const assignmentId = parseBigInt(body?.assignmentId);
    if (!assignmentId) {
      return NextResponse.json({ success: false, message: "배정을 선택해주세요." }, { status: 400 });
    }

    const r = await createPilotWorkday({
      pilotSessionId,
      assignmentId,
      workDate: String(body?.workDate ?? "").trim(),
      start: body?.start != null ? String(body.start).trim() : null,
      end: body?.end != null ? String(body.end).trim() : null,
    });
    if (!r.ok) {
      return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
    }

    await audit(scope, {
      entityType: "DailyAttendance", entityId: BigInt(r.value.id), action: "create",
      summary: `파일럿 근무일 등록 ${String(body?.workDate ?? "")}`,
    });
    return NextResponse.json({ success: true, id: r.value.id });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/[sessionId]/workdays POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
