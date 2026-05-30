// app/api/admin/recruit-posts/[id]/route.ts
// 공고 수정(마감 등)·삭제 — 본인(에이전시/운영자) 소유만
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

async function ownOrThrow(req: NextRequest, id: string) {
  const session = await requireAdminOrManagerSession(req);
  const postId = parseBigInt(id);
  if (!postId) throw NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });
  const post = await prisma.recruitPost.findUnique({ where: { id: postId } });
  if (!post) throw NextResponse.json({ success: false, message: "공고를 찾을 수 없습니다." }, { status: 404 });
  const owned =
    session.kind === "manager"
      ? post.createdByManagerId === session.managerId || post.agencyId === session.agencyId
      : post.createdByAdminId === session.adminId;
  if (!owned) throw NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
  return { postId, post };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { postId } = await ownOrThrow(req, id);
    const b = await req.json();

    const data: Record<string, any> = {};
    if (b.status && ["OPEN", "CLOSED"].includes(b.status)) data.status = b.status;
    for (const f of ["title", "companyName", "taskName", "address", "detailAddress", "region", "workHours", "workDays", "payInfo", "description", "contactName", "contactPhone"]) {
      if (b[f] !== undefined) data[f] = b[f] === null ? null : String(b[f]).trim() || null;
    }
    if (b.headcount !== undefined) data.headcount = Math.max(1, Math.min(999, parseInt(String(b.headcount), 10) || 1));
    if (b.profession && ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"].includes(b.profession)) data.profession = b.profession;
    if (b.lat !== undefined) data.lat = b.lat != null && b.lat !== "" ? Number(b.lat) : null;
    if (b.lon !== undefined) data.lon = b.lon != null && b.lon !== "" ? Number(b.lon) : null;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, message: "변경할 내용이 없습니다." }, { status: 400 });
    }
    await prisma.recruitPost.update({ where: { id: postId }, data });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/recruit-posts/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { postId } = await ownOrThrow(req, id);
    await prisma.recruitPost.delete({ where: { id: postId } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/recruit-posts/[id] DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
