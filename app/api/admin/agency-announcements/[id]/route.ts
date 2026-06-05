// 에이전시 공지 게시판 — 항목 삭제/고정 토글 (본인 에이전시만).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

async function ownOr404(agencyId: bigint, id: string) {
  if (!/^\d+$/.test(id)) return null;
  const row = await prisma.agencyAnnouncement.findUnique({ where: { id: BigInt(id) }, select: { id: true, agencyId: true, pinned: true } });
  if (!row || row.agencyId !== agencyId) return null;
  return row;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const row = await ownOr404(scope.agencyId, id);
    if (!row) return NextResponse.json({ success: false, message: "공지를 찾을 수 없습니다." }, { status: 404 });
    const b = await req.json().catch(() => ({}));
    await prisma.agencyAnnouncement.update({
      where: { id: row.id },
      data: { pinned: typeof b?.pinned === "boolean" ? b.pinned : !row.pinned },
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const row = await ownOr404(scope.agencyId, id);
    if (!row) return NextResponse.json({ success: false, message: "공지를 찾을 수 없습니다." }, { status: 404 });
    await prisma.agencyAnnouncement.delete({ where: { id: row.id } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
