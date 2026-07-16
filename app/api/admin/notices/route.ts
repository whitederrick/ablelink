// POST /api/admin/notices — 직무지도원에게 반려/안내 알림 발송
// GET  /api/admin/notices — 발송 이력 조회
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { checkRateLimit } from "@/lib/rateLimit";
import { filterAgencyWorkers } from "@/lib/noticeTargets";

export async function GET(req: NextRequest) {
  try {
    // 듀얼: 운영자=전체 기관, 매니저=본인 기관
    const session  = await requireAdminOrManagerSession(req);
    const agencyId = session.kind === "manager" ? session.agencyId : undefined;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Number(searchParams.get("limit") ?? 50));

    // 직무지도원에게 보낸 알림만. 시스템 공지(kind=SYSTEM, 레거시 "[시스템 공지]" 제목)는
    // 별도 '시스템 공지사항' 화면에서만 노출하므로 여기서 제외한다.
    const notices = await prisma.workerNotice.findMany({
      where: {
        ...(agencyId ? { agencyId } : {}),
        kind: { not: "SYSTEM" },
        NOT: { title: { startsWith: "[시스템 공지]" } },
      },
      include: { user: { select: { id: true, workerName: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      notices: notices.map((n: any) => ({
        id:         n.id.toString(),
        workerId:     n.workerId.toString(),
        workerName:   n.user?.workerName ?? "",
        title:      n.title,
        body:       n.body,
        type:       n.type,
        yearMonth:  n.yearMonth,
        read:       n.readAt != null,
        createdAt:  n.createdAt?.toISOString() ?? "",
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/notices GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 듀얼: 운영자(admin)는 기관 무관 개별 발송, 매니저는 본인 기관 전체/그룹/개별
    const session  = await requireAdminOrManagerSession(req);
    const isAdmin  = session.kind === "admin";
    const agencyId = isAdmin ? undefined : session.agencyId;

    // 레이트리밋(알림 폭주 방지)
    const rl = await checkRateLimit(`notice-send:${isAdmin ? `admin:${session.adminId}` : session.managerId}`);
    if (!rl.allowed) return NextResponse.json({ success: false, message: "요청이 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 });

    const body = await req.json().catch(() => ({}));
    // audience: "ALL"(전체) | "GROUP"(현장 siteId 또는 커스텀 그룹 groupId) | "INDIVIDUAL"(개별)
    const { userIds, siteId, groupId, audience, title, body: msgBody, type = "INFO", yearMonth, link } = body;

    if (!title || !msgBody)
      return NextResponse.json({ success: false, message: "title, body 필수" }, { status: 400 });

    // 발송 범위 결정 — 명시적 audience 우선, 없으면 입력값으로 추론(하위호환).
    const mode: "ALL" | "GROUP" | "INDIVIDUAL" =
      audience === "ALL" || audience === "GROUP" || audience === "INDIVIDUAL"
        ? audience
        : Array.isArray(userIds) && userIds.length > 0 ? "INDIVIDUAL"
        : siteId ? "GROUP"
        : "ALL";

    // 운영자는 전체/그룹 일괄 발송을 막고 개별 발송만 허용(플랫폼 전체 오발송 방지)
    if (isAdmin && mode !== "INDIVIDUAL") {
      return NextResponse.json({ success: false, message: "운영자는 개별(특정 직무지도원) 발송만 지원합니다." }, { status: 400 });
    }

    const activeStatuses = ["ASSIGNED", "CONFIRMED", "ACTIVE"] as const;
    let targetIds: bigint[] = [];
    let kind: "NOTICE_ALL" | "NOTICE_GROUP" | "NOTICE_INDIVIDUAL" = "NOTICE_ALL";

    if (mode === "INDIVIDUAL") {
      kind = "NOTICE_INDIVIDUAL";
      // ✅ 크로스테넌트 방지: 요청된 워커 중 "내 위탁기관 소속"만 대상으로.
      //  운영자(admin)는 기관 스코프 없이 '활성 배정 보유' 검증만(종전 동작 보존 — agencyId=undefined 쿼리와 동일).
      if (isAdmin) {
        const requested = (Array.isArray(userIds) ? userIds : [])
          .map((id: unknown) => parseBigInt(id)).filter((id): id is bigint => id !== null);
        if (requested.length > 0) {
          const valid = await prisma.siteAssignment.findMany({
            where: { workerId: { in: requested }, status: { in: [...activeStatuses] } },
            select: { workerId: true },
          });
          targetIds = [...new Map(valid.map(a => [a.workerId.toString(), a.workerId])).values()];
        }
      } else {
        targetIds = await filterAgencyWorkers(agencyId!, userIds);
      }
    } else if (mode === "GROUP") {
      kind = "NOTICE_GROUP";
      const gid = parseBigInt(groupId);
      const sid = parseBigInt(siteId);
      if (gid) {
        // 커스텀 그룹: 내 기관 그룹만(404) + 멤버를 발송 시점 활성 배정으로 재필터(퇴사·이적 오발송 방지).
        const group = await prisma.noticeGroup.findFirst({
          where: { id: gid, agencyId }, select: { members: { select: { workerId: true } } },
        });
        if (!group) return NextResponse.json({ success: false, message: "그룹을 찾을 수 없습니다." }, { status: 404 });
        targetIds = await filterAgencyWorkers(agencyId!, group.members.map(m => m.workerId.toString()));
      } else if (sid) {
        const assignments = await prisma.siteAssignment.findMany({
          where: { agencyId, siteId: sid, status: { in: [...activeStatuses] } },
          select: { workerId: true },
        });
        targetIds = [...new Map(assignments.map(a => [a.workerId.toString(), a.workerId])).values()];
      } else {
        return NextResponse.json({ success: false, message: "siteId 또는 groupId가 필요합니다." }, { status: 400 });
      }
    } else {
      kind = "NOTICE_ALL";
      const assignments = await prisma.siteAssignment.findMany({
        where: { agencyId, status: { in: [...activeStatuses] } },
        select: { workerId: true },
      });
      targetIds = [...new Map(assignments.map(a => [a.workerId.toString(), a.workerId])).values()];
    }

    if (targetIds.length === 0)
      return NextResponse.json({ success: false, message: "대상 직무지도원이 없습니다." }, { status: 404 });

    const noticeType = ["INFO", "WARN", "REJECT"].includes(type) ? type : "INFO";

    // 운영자: WorkerNotice.agencyId가 필수라 대상 워커의 (최근 배정) 기관을 조회해 채움
    const agencyByWorker = new Map<string, bigint>();
    if (isAdmin) {
      const asg = await prisma.siteAssignment.findMany({
        where: { workerId: { in: targetIds } },
        select: { workerId: true, agencyId: true },
        orderBy: { startDate: "desc" },
      });
      for (const a of asg) {
        const k = a.workerId.toString();
        if (a.agencyId != null && !agencyByWorker.has(k)) agencyByWorker.set(k, a.agencyId);
      }
    }

    const rows = targetIds.map(uid => {
      const ag = isAdmin ? agencyByWorker.get(uid.toString()) : agencyId;
      if (!ag) return null;
      return {
        workerId: uid, agencyId: ag,
        title: String(title).slice(0, 100),
        body:  String(msgBody).slice(0, 1000),
        type:  noticeType,
        kind,
        yearMonth: yearMonth || null,
        link: typeof link === "string" && link ? link.slice(0, 300) : null,
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) return NextResponse.json({ success: false, message: "대상 직무지도원의 소속 기관을 확인할 수 없습니다." }, { status: 404 });

    const result = await prisma.workerNotice.createMany({ data: rows });
    return NextResponse.json({ success: true, sent: result.count });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/notices POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
