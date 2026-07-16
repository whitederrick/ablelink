// app/api/admin/notice-groups/route.ts
// 알림 커스텀 수신 그룹 목록(GET)/생성(POST) — 매니저 전용(기관 스코프).
// 멤버 저장 시 '내 기관 활성 배정 워커'만 인정(크로스테넌트 방지, /api/admin/notices INDIVIDUAL과 동일 규칙).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit } from "@/lib/audit";
import { filterAgencyWorkers } from "@/lib/noticeTargets";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const groups = await prisma.noticeGroup.findMany({
      where: { agencyId: scope.agencyId },
      orderBy: [{ name: "asc" }],
      select: {
        id: true, name: true, updatedAt: true,
        members: { select: { workerId: true, worker: { select: { workerName: true } } } },
      },
    });
    return NextResponse.json({
      success: true,
      groups: groups.map(g => ({
        id: g.id.toString(),
        name: g.name,
        updatedAt: g.updatedAt.toISOString().slice(0, 10),
        memberCount: g.members.length,
        members: g.members.map(m => ({ workerId: m.workerId.toString(), workerName: m.worker?.workerName ?? "-" })),
      })),
    });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/notice-groups GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// POST { name, workerIds: string[] }
export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim().slice(0, 50);
    if (!name) return NextResponse.json({ success: false, message: "그룹 이름을 입력해주세요." }, { status: 400 });

    const workerIds = await filterAgencyWorkers(scope.agencyId, body?.workerIds);
    if (workerIds.length === 0) {
      return NextResponse.json({ success: false, message: "그룹에 넣을 직무지도원을 선택해주세요." }, { status: 400 });
    }

    let created;
    try {
      created = await prisma.noticeGroup.create({
        data: {
          agencyId: scope.agencyId, name, createdByManagerId: scope.managerId,
          members: { createMany: { data: workerIds.map(w => ({ workerId: w })) } },
        },
        select: { id: true },
      });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "P2002") {
        return NextResponse.json({ success: false, message: "같은 이름의 그룹이 이미 있습니다." }, { status: 409 });
      }
      throw e;
    }
    await audit(scope, {
      entityType: "NoticeGroup", entityId: created.id.toString(), action: "create",
      summary: `알림 그룹 생성 '${name}' (${workerIds.length}명)`,
      payload: { name, memberCount: workerIds.length },
    });
    return NextResponse.json({ success: true, id: created.id.toString() });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/notice-groups POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
