// 공지 카테고리 항목 — 수정/삭제 (운영자 전용)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";

const TONES = ["sky", "amber", "rose", "emerald", "violet", "slate"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession(req);
    const { id } = await params;
    const cid = parseBigInt(id);
    if (!cid) return NextResponse.json({ success: false, message: "잘못된 요청" }, { status: 400 });
    const b = await req.json().catch(() => ({}));
    const data: any = {};
    if (typeof b?.name === "string" && b.name.trim()) data.name = b.name.trim().slice(0, 30);
    if (typeof b?.tone === "string" && TONES.includes(b.tone)) data.tone = b.tone;
    if (typeof b?.isActive === "boolean") data.isActive = b.isActive;
    if (typeof b?.sortOrder === "number" && Number.isFinite(b.sortOrder)) data.sortOrder = Math.trunc(b.sortOrder);
    if (Object.keys(data).length === 0) return NextResponse.json({ success: false, message: "변경할 내용이 없습니다." }, { status: 400 });
    await prisma.announcementCategory.update({ where: { id: cid }, data });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession(req);
    const { id } = await params;
    const cid = parseBigInt(id);
    if (!cid) return NextResponse.json({ success: false, message: "잘못된 요청" }, { status: 400 });
    // 연결된 공지의 categoryId는 FK onDelete: SetNull → type 폴백으로 안전하게 표시됨
    await prisma.announcementCategory.delete({ where: { id: cid } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
