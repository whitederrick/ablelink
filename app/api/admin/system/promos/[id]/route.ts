// app/api/admin/system/promos/[id]/route.ts
// 운영자: 대시보드 소식/광고 수정(활성토글·기간·내용)·삭제.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession(req);
    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) return NextResponse.json({ success: false, message: "잘못된 id" }, { status: 400 });
    const b = await req.json().catch(() => ({}));

    const data: any = {};
    if (b.badge !== undefined)     data.badge     = b.badge?.trim() || null;
    if (b.title !== undefined)     data.title     = String(b.title).trim();
    if (b.body !== undefined)      data.body      = b.body?.trim() || null;
    if (b.imageUrl !== undefined)  data.imageUrl  = b.imageUrl?.trim() || null;
    if (b.href !== undefined)      data.href      = b.href?.trim() || null;
    if (b.isActive !== undefined)  data.isActive  = !!b.isActive;
    if (b.startAt !== undefined)   data.startAt   = parseDate(b.startAt);
    if (b.endAt !== undefined)     data.endAt     = parseDate(b.endAt);
    if (b.note !== undefined)      data.note      = b.note?.trim() || null;
    if (b.sortOrder !== undefined && Number.isFinite(Number(b.sortOrder))) data.sortOrder = Number(b.sortOrder);
    if (data.title === "") return NextResponse.json({ success: false, message: "제목(문구)을 입력하세요." }, { status: 400 });

    await prisma.dashboardPromo.update({ where: { id: BigInt(id) }, data });
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
    await prisma.dashboardPromo.delete({ where: { id: BigInt(id) } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    return NextResponse.json({ success: false, message: "삭제 실패" }, { status: 500 });
  }
}
