// 시스템 공지: 전체 직무지도원에게 공지 발송
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);
    if (scope.role !== "ADMIN") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const announcements = await prisma.systemAnnouncement.findMany({
      include: { admin: { select: { loginId: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      announcements: announcements.map(a => ({
        id:        a.id.toString(),
        title:     a.title,
        body:      a.body,
        type:      a.type,
        sentCount: a.sentCount,
        adminLogin: a.admin?.loginId ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    if (scope.role !== "ADMIN") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const { title, body, type = "INFO" } = await req.json();
    if (!title?.trim() || !body?.trim())
      return NextResponse.json({ success: false, message: "제목과 내용은 필수입니다." }, { status: 400 });

    const noticeType = ["INFO","MAINTENANCE","URGENT"].includes(type) ? type : "INFO";

    // 활성 에이전시 내 모든 직무지도원에게 WorkerNotice 생성
    const assignments = await prisma.siteAssignment.findMany({
      where: {
        status: { in: ["ACTIVE","ASSIGNED","CONFIRMED"] },
        agency: { isActive: true } as any,
      },
      select: { userId: true, agencyId: true },
    });

    const uniqueUsers = new Map<string, { userId: bigint; agencyId: bigint }>();
    for (const a of assignments) {
      const key = a.userId.toString();
      if (!uniqueUsers.has(key) && a.agencyId != null)
        uniqueUsers.set(key, { userId: a.userId, agencyId: a.agencyId });
    }

    const targets = [...uniqueUsers.values()];

    const announcement = await prisma.systemAnnouncement.create({
      data: {
        title: title.trim(),
        body:  body.trim(),
        type:  noticeType,
        adminId: scope.userId,
        sentCount: targets.length,
      },
    });

    // WorkerNotice 일괄 생성
    if (targets.length > 0) {
      await (prisma as any).workerNotice.createMany({
        data: targets.map(t => ({
          userId:    t.userId,
          agencyId:  t.agencyId,
          title:     `[시스템 공지] ${title.trim()}`.slice(0, 100),
          body:      body.trim().slice(0, 500),
          type:      noticeType === "URGENT" ? "WARN" : "INFO",
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({ success: true, id: announcement.id.toString(), sentCount: targets.length });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
