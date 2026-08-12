// GET  /api/admin/pilots/[sessionId]/purge — 폐기 미리보기(무엇이 지워지고 무엇이 남는가)
// POST /api/admin/pilots/[sessionId]/purge — 폐기 실행
//
// 시스템 운영자 전용. v1.8 §11·§12 9단계.
// ★상태 전이 API(PATCH /api/admin/pilots/[id])에서 PURGED를 화이트리스트에서 뺀 이유가 이것이다.
//  폐기는 상태만 바꾸는 일이 아니라 데이터를 지우는 일이라 전용 경로에서만 일어난다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { previewPilotPurge, purgePilotSession } from "@/lib/pilot/purge";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    await requireAdminSession(req);
    const { sessionId: raw } = await ctx.params;
    const id = parseBigInt(raw);
    if (!id) return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });

    const r = await previewPilotPurge(id);
    if (!r.ok) return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
    return NextResponse.json({ success: true, counts: r.value });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/purge GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { sessionId: raw } = await ctx.params;
    const id = parseBigInt(raw);
    if (!id) return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });

    const r = await purgePilotSession(id);
    if (!r.ok) return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });

    await audit(scope, {
      entityType: "PilotSession", entityId: id, action: "update",
      summary: "파일럿 데이터 폐기", after: { status: "PURGED", counts: r.value },
    });
    return NextResponse.json({ success: true, counts: r.value });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/purge POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
