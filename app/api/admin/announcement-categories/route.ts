// 공지 카테고리 — 시스템 운영자 전역 관리. GET은 운영자/매니저 공용(작성 시 선택), 변경은 운영자 전용.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

const TONES = ["sky", "amber", "rose", "emerald", "violet", "slate"];

function serialize(c: any) {
  return { id: c.id.toString(), name: c.name, tone: c.tone, sortOrder: c.sortOrder, isActive: c.isActive };
}

// GET: 카테고리 목록 (운영자=전체, 매니저=활성만 작성용)
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const onlyActive = session.kind === "manager";
    const rows = await prisma.announcementCategory.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ success: true, categories: rows.map(serialize) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// POST: 카테고리 추가 (운영자 전용)
export async function POST(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const b = await req.json().catch(() => ({}));
    const name = String(b?.name ?? "").trim();
    if (!name) return NextResponse.json({ success: false, message: "이름은 필수입니다." }, { status: 400 });
    const tone = TONES.includes(b?.tone) ? b.tone : "sky";
    const max = await prisma.announcementCategory.aggregate({ _max: { sortOrder: true } });
    const row = await prisma.announcementCategory.create({
      data: { name: name.slice(0, 30), tone, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    return NextResponse.json({ success: true, category: serialize(row) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
