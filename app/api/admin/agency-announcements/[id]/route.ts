// 위탁기관 공지 게시판 — 항목 삭제/고정 토글 (본인 위탁기관만).
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
    const data: any = {};
    // pinned만 보내면 토글, 본문 수정 필드가 오면 함께 반영
    if (typeof b?.title === "string" && b.title.trim()) data.title = b.title.trim();
    if (typeof b?.body === "string" && b.body.trim()) data.body = b.body.trim();
    if (typeof b?.type === "string" && ["INFO", "WARN", "URGENT"].includes(b.type)) data.type = b.type;
    // 카테고리 변경(우선). null이면 카테고리 해제 후 type 폴백.
    if (b?.categoryId !== undefined) {
      if (b.categoryId === null || b.categoryId === "") {
        data.categoryId = null;
      } else if (/^\d+$/.test(String(b.categoryId))) {
        const cat = await prisma.announcementCategory.findUnique({ where: { id: BigInt(String(b.categoryId)) }, select: { id: true, tone: true } });
        if (cat) {
          data.categoryId = cat.id;
          data.type = cat.tone === "rose" ? "URGENT" : cat.tone === "amber" ? "WARN" : "INFO";
        }
      }
    }
    if (typeof b?.pinned === "boolean") data.pinned = b.pinned;
    // 아무 필드도 없으면 기존처럼 고정 토글
    if (Object.keys(data).length === 0) data.pinned = !row.pinned;
    await prisma.agencyAnnouncement.update({ where: { id: row.id }, data });
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
