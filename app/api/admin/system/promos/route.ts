// app/api/admin/system/promos/route.ts
// 운영자: 대시보드 소식 티커·광고 콘텐츠 관리(목록/생성).
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

const KINDS = ["TICKER", "AD"] as const;

function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function serialize(r: any) {
  return {
    id: r.id.toString(),
    kind: r.kind,
    badge: r.badge,
    title: r.title,
    body: r.body,
    imageUrl: r.imageUrl,
    layout: r.layout,
    textColor: r.textColor,
    href: r.href,
    isActive: r.isActive,
    startAt: r.startAt ? r.startAt.toISOString() : null,
    endAt: r.endAt ? r.endAt.toISOString() : null,
    note: r.note,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const rows = await prisma.dashboardPromo.findMany({
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ success: true, data: rows.map(serialize) });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    return NextResponse.json({ success: false, message: "조회 실패" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminSession(req);
    const b = await req.json().catch(() => ({}));
    const kind = String(b.kind ?? "");
    const title = String(b.title ?? "").trim();
    if (!KINDS.includes(kind as any)) return NextResponse.json({ success: false, message: "kind는 TICKER/AD 중 하나여야 합니다." }, { status: 400 });
    if (!title) return NextResponse.json({ success: false, message: "제목(문구)을 입력하세요." }, { status: 400 });

    const created = await prisma.dashboardPromo.create({
      data: {
        kind: kind as any,
        badge: b.badge?.trim() || null,
        title,
        body: b.body?.trim() || null,
        imageUrl: b.imageUrl?.trim() || null,
        layout: ["TEXT", "IMAGE", "OVERLAY", "TITLE"].includes(b.layout) ? b.layout : "TEXT",
        textColor: b.textColor === "DARK" ? "DARK" : "LIGHT",
        href: b.href?.trim() || null,
        isActive: b.isActive === undefined ? true : !!b.isActive,
        startAt: parseDate(b.startAt),
        endAt: parseDate(b.endAt),
        note: b.note?.trim() || null,
        sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0,
      },
    });
    return NextResponse.json({ success: true, id: created.id.toString() });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    return NextResponse.json({ success: false, message: "생성 실패" }, { status: 500 });
  }
}
