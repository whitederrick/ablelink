// app/api/admin/system/announcements/[id]/route.ts
// 운영자: 시스템 공지 티커 노출 토글(및 삭제).
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession(req);
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) return NextResponse.json({ success: false, message: "잘못된 id" }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const data: any = {};
    if (b.showInTicker !== undefined) data.showInTicker = !!b.showInTicker;
    if (Object.keys(data).length === 0) return NextResponse.json({ success: false, message: "변경할 값이 없습니다." }, { status: 400 });
    await prisma.systemAnnouncement.update({ where: { id: BigInt(id) }, data });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    return NextResponse.json({ success: false, message: "수정 실패" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession(req);
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) return NextResponse.json({ success: false, message: "잘못된 id" }, { status: 400 });
    await prisma.systemAnnouncement.delete({ where: { id: BigInt(id) } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    return NextResponse.json({ success: false, message: "삭제 실패" }, { status: 500 });
  }
}
