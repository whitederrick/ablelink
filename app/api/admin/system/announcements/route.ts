// 시스템 공지: 전체 직무지도원에게 공지 발송
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

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
        audience:  a.audience ?? "MANAGERS",
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

    const { title, body, type = "INFO", audience = "MANAGERS" } = await req.json();
    if (!title?.trim() || !body?.trim())
      return NextResponse.json({ success: false, message: "제목과 내용은 필수입니다." }, { status: 400 });

    const noticeType = ["INFO","MAINTENANCE","URGENT"].includes(type) ? type : "INFO";
    // 대상: MANAGERS=위탁기관 관리자만(기본, 직무지도원 미발송) | ALL=관리자+전체 직무지도원
    const toAll = audience === "ALL";

    // 전체 발송일 때만 활성 위탁기관 직무지도원에게 WorkerNotice 생성(중복 제거)
    let targets: { workerId: bigint; agencyId: bigint }[] = [];
    if (toAll) {
      const grouped = await prisma.siteAssignment.groupBy({
        by: ["workerId", "agencyId"],
        where: {
          status:   { in: ["ACTIVE", "ASSIGNED", "CONFIRMED"] },
          agency:   { isActive: true },
          agencyId: { not: null },
        },
      });
      targets = grouped
        .filter(r => r.agencyId != null)
        .map(r => ({ workerId: r.workerId, agencyId: r.agencyId as bigint }));
    }

    const announcement = await prisma.systemAnnouncement.create({
      data: {
        title: title.trim(),
        body:  body.trim(),
        type:  noticeType,
        adminId: scope.adminId,
        sentCount: targets.length, // 직무지도원 알림 발송 수(관리자만 발송 시 0)
        audience: toAll ? "ALL" : "MANAGERS",
      },
    });

    // 직무지도원 알림 fan-out (전체 발송일 때만)
    if (targets.length > 0) {
      await prisma.workerNotice.createMany({
        data: targets.map(t => ({
          workerId:    t.workerId,
          agencyId:  t.agencyId,
          title:     `[시스템 공지] ${title.trim()}`.slice(0, 100),
          body:      body.trim().slice(0, 500),
          type:      noticeType === "URGENT" ? "WARN" : "INFO",
          kind:      "SYSTEM", // 매니저 '알림 목록'에서 제외(시스템 공지사항 화면에서만 노출)
        })),
        skipDuplicates: true,
      });
    }

    // 위탁기관 관리자(담당자) 알림 fan-out — 전체(긴급) 발송 시에만 관리자 알림 벨에 실제 알림 생성.
    // (일반 MANAGERS 공지는 '시스템 공지사항' 화면에서만 조용히 열람 — 벨 알림 X)
    if (toAll) {
      const activeManagers = await prisma.manager.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      if (activeManagers.length > 0) {
        await prisma.managerNotice.createMany({
          data: activeManagers.map(m => ({
            managerId: m.id,
            title:     `[긴급 공지] ${title.trim()}`.slice(0, 100),
            body:      body.trim().slice(0, 500),
          })),
        });
      }
    }

    return NextResponse.json({
      success: true,
      id: announcement.id.toString(),
      audience: toAll ? "ALL" : "MANAGERS",
      sentCount: targets.length,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
