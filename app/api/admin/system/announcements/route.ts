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
        showInTicker: a.showInTicker,
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

    const { title, body, type = "INFO", audience = "MANAGERS", showInTicker = false } = await req.json();
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
        showInTicker: !!showInTicker,
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

    // 위탁기관 관리자는 시스템 공지를 알림 벨의 '통합 피드'에서 직접 본다(manager/notices GET이
    // SystemAnnouncement + SystemAnnouncementRead 를 가상 병합). → 별도 ManagerNotice fan-out 불필요.
    //  (fan-out 하면 통합 피드에서 '[긴급 공지]'와 '[시스템 공지]'가 중복 노출됨)

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
