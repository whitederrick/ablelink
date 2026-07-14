// app/api/admin/attendance-inbox/events/[eventId]/route.ts
// 운영 메모(타임라인 MEMO_UPDATED 이벤트) 수정/삭제. 메모 노트만 대상.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

type Params = { params: Promise<{ eventId: string }> };

// 이벤트 소유(스코프) 확인 + 메모 노트인지 검증
async function loadOwnedMemoEvent(eventId: bigint, agencyId: bigint) {
  const ev = await prisma.attendanceIssueEvent.findUnique({
    where: { id: eventId },
    // ★18차(P1): 소유권 = assignment.agencyId(실귀속·non-null), site.agencyId 아님(공유현장 크로스테넌트 방지).
    select: { id: true, type: true, issue: { select: { dailyAttendance: { select: { assignment: { select: { agencyId: true } } } } } } },
  });
  if (!ev) return { error: NextResponse.json({ success: false, message: "이벤트를 찾을 수 없습니다." }, { status: 404 }) };
  if (ev.issue?.dailyAttendance?.assignment?.agencyId !== agencyId)
    return { error: NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 }) };
  if (ev.type !== "MEMO_UPDATED")
    return { error: NextResponse.json({ success: false, message: "운영 메모만 수정/삭제할 수 있습니다." }, { status: 400 }) };
  return { ev };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const scope = await requireManagerSession(req);
    const { eventId } = await params;
    if (!/^\d+$/.test(eventId)) return NextResponse.json({ success: false, message: "INVALID_ID" }, { status: 400 });
    const { error } = await loadOwnedMemoEvent(BigInt(eventId), scope.agencyId);
    if (error) return error;
    const body = await req.json().catch(() => ({} as any));
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ success: false, message: "메모 내용을 입력하세요." }, { status: 400 });
    await prisma.attendanceIssueEvent.update({ where: { id: BigInt(eventId) }, data: { message } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[attendance-inbox/events PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const scope = await requireManagerSession(req);
    const { eventId } = await params;
    if (!/^\d+$/.test(eventId)) return NextResponse.json({ success: false, message: "INVALID_ID" }, { status: 400 });
    const { error } = await loadOwnedMemoEvent(BigInt(eventId), scope.agencyId);
    if (error) return error;
    await prisma.attendanceIssueEvent.delete({ where: { id: BigInt(eventId) } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[attendance-inbox/events DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
