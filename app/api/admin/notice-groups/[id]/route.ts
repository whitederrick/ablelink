// app/api/admin/notice-groups/[id]/route.ts
// 알림 커스텀 그룹 수정(PATCH: 이름/멤버 교체)·삭제(DELETE) — 매니저 전용(기관 스코프).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { filterAgencyWorkers } from "@/lib/noticeTargets";

// PATCH { name?, workerIds? } — workerIds가 오면 멤버 전체 교체.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id: raw } = await params;
    const id = parseBigInt(raw);
    if (!id) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const group = await prisma.noticeGroup.findFirst({ where: { id, agencyId: scope.agencyId }, select: { id: true, name: true } });
    if (!group) return NextResponse.json({ success: false, message: "그룹을 찾을 수 없습니다." }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 50) : null;
    const hasMembers = Object.prototype.hasOwnProperty.call(body ?? {}, "workerIds");
    if (name === "") return NextResponse.json({ success: false, message: "그룹 이름을 입력해주세요." }, { status: 400 });

    let workerIds: bigint[] | null = null;
    if (hasMembers) {
      workerIds = await filterAgencyWorkers(scope.agencyId, body?.workerIds);
      if (workerIds.length === 0) {
        return NextResponse.json({ success: false, message: "그룹에 넣을 직무지도원을 선택해주세요." }, { status: 400 });
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (name) await tx.noticeGroup.update({ where: { id: group.id }, data: { name } });
        if (workerIds) {
          await tx.noticeGroupMember.deleteMany({ where: { groupId: group.id } });
          await tx.noticeGroupMember.createMany({ data: workerIds.map(w => ({ groupId: group.id, workerId: w })) });
          // 멤버만 바뀌어도 updatedAt 갱신
          if (!name) await tx.noticeGroup.update({ where: { id: group.id }, data: { updatedAt: new Date() } });
        }
      });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "P2002") {
        return NextResponse.json({ success: false, message: "같은 이름의 그룹이 이미 있습니다." }, { status: 409 });
      }
      throw e;
    }
    await audit(scope, {
      entityType: "NoticeGroup", entityId: group.id.toString(), action: "update",
      summary: `알림 그룹 수정 '${name ?? group.name}'${workerIds ? ` (멤버 ${workerIds.length}명 교체)` : ""}`,
      payload: { name: name ?? group.name, ...(workerIds ? { memberCount: workerIds.length } : {}) },
    });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/notice-groups PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id: raw } = await params;
    const id = parseBigInt(raw);
    if (!id) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const group = await prisma.noticeGroup.findFirst({ where: { id, agencyId: scope.agencyId }, select: { id: true, name: true } });
    if (!group) return NextResponse.json({ success: false, message: "그룹을 찾을 수 없습니다." }, { status: 404 });

    await prisma.noticeGroup.delete({ where: { id: group.id } }); // 멤버는 FK cascade
    await audit(scope, {
      entityType: "NoticeGroup", entityId: group.id.toString(), action: "delete",
      summary: `알림 그룹 삭제 '${group.name}'`,
      before: { name: group.name },
    });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/notice-groups DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
