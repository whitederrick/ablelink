// 에이전시 공지 게시판 — 매니저 작성/목록 (소속 직무지도원이 게시판으로 열람).
// 일반 공지는 알림 fan-out 없이 게시판 1행으로 관리. (개인 처리필요 알림은 /api/admin/notices 별도)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

function serialize(a: any) {
  return {
    id: a.id.toString(),
    title: a.title,
    body: a.body,
    type: a.type,
    pinned: a.pinned,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const rows = await prisma.agencyAnnouncement.findMany({
      where: { agencyId: scope.agencyId },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return NextResponse.json({ success: true, announcements: rows.map(serialize) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/agency-announcements GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const b = await req.json().catch(() => ({}));
    const title = String(b?.title ?? "").trim();
    const body = String(b?.body ?? "").trim();
    if (!title || !body) return NextResponse.json({ success: false, message: "제목과 내용은 필수입니다." }, { status: 400 });
    const type = ["INFO", "WARN", "URGENT"].includes(b?.type) ? b.type : "INFO";

    const row = await prisma.agencyAnnouncement.create({
      data: {
        agencyId: scope.agencyId,
        title: title.slice(0, 150),
        body: body.slice(0, 4000),
        type,
        pinned: b?.pinned === true,
        createdByManagerId: scope.managerId,
      },
    });

    // 공지를 직무지도원 통합 알림 피드(WorkerNotice)로 fan-out(kind=ANNOUNCEMENT).
    // 게시판 1행(AgencyAnnouncement)은 매니저 편집용으로 유지, 워커 수신은 알림 피드로 통일.
    try {
      const assignments = await prisma.siteAssignment.findMany({
        where: { agencyId: scope.agencyId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
        select: { workerId: true },
      });
      const targetIds = [...new Map(assignments.map(a => [a.workerId.toString(), a.workerId])).values()];
      if (targetIds.length > 0) {
        await (prisma as any).workerNotice.createMany({
          data: targetIds.map(uid => ({
            workerId: uid, agencyId: scope.agencyId,
            title: title.slice(0, 100),
            body: body.slice(0, 1000),
            type: type === "URGENT" ? "WARN" : "INFO",
            kind: "ANNOUNCEMENT",
          })),
        });
      }
    } catch (fanErr) {
      console.error("[agency-announcements fan-out]", fanErr);
    }

    return NextResponse.json({ success: true, id: row.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/agency-announcements POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
