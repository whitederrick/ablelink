// app/api/worker/recruit/offers/route.ts
// 후보자(워커)가 받은 제안 목록 + 수락/거절
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { parseBigInt } from "@/lib/adminScope";
import { checkQuota } from "@/lib/planGuard";
import { findTimeConflict, OCCUPYING_STATUSES } from "@/lib/assignmentOverlap";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const offers = await prisma.talentOffer.findMany({
      where: { workerId },
      orderBy: { createdAt: "desc" },
      include: { agency: { select: { name: true } } },
    });
    return NextResponse.json({
      success: true,
      offers: offers.map((o) => ({
        id: o.id.toString(),
        agencyName: o.agency?.name ?? "Able-Link",
        profession: o.profession,
        siteName: o.siteName ?? null,
        message: o.message ?? null,
        serviceStart: o.serviceStart ? o.serviceStart.toISOString().slice(0, 10) : null,
        serviceEnd: o.serviceEnd ? o.serviceEnd.toISOString().slice(0, 10) : null,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        decidedAt: o.decidedAt?.toISOString() ?? null,
      })),
    });
  } catch (e: any) {
    console.error("[worker/recruit/offers GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const b = await req.json();
    const id = parseBigInt(b.id);
    const action = String(b.action ?? "");
    if (!id || !["accept", "decline"].includes(action))
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });

    const offer = await prisma.talentOffer.findUnique({ where: { id } });
    if (!offer || offer.workerId !== workerId) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (offer.status !== "PENDING") return NextResponse.json({ success: false, message: "이미 처리된 제안입니다." }, { status: 409 });

    // 수락 + 제안에 현장이 연결돼 있으면 → 해당 현장으로 자동 배정(방향 B). 좌표/agencyId는 site에서.
    // 가드(비활성 인력·구독 한도·중복)는 미충족 시 배정만 건너뛰고 수락 자체는 진행(위탁기관가 수동 처리).
    let autoAssigned = false;
    let assignSiteId: bigint | null = null;
    let assignAgencyId: bigint | null = null;
    if (action === "accept" && offer.siteId != null) {
      // 독립 조회 병렬화(현장·워커 상태).
      const [site, w] = await Promise.all([
        prisma.site.findUnique({ where: { id: offer.siteId }, select: { id: true, agencyId: true, isActive: true } }),
        prisma.worker.findUnique({ where: { id: workerId }, select: { status: true } }),
      ]);
      if (site && site.isActive && site.agencyId != null && w && String(w.status) === "ACTIVE") {
        const wq = await checkQuota(site.agencyId, "workers");
        const dup = await prisma.siteAssignment.findFirst({
          where: { siteId: site.id, workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
          select: { id: true },
        });
        // 시간겹침: 다른 현장 진행중 배정과 같은 날 반나절 슬롯이 겹치면 자동배정 스킵(수락 자체는 진행).
        //  제안 자동배정은 FULL_DAY라 기존 활성 배정과 기간이 겹치면 무조건 충돌.
        const others = await prisma.siteAssignment.findMany({
          // E3: ACCEPTED(최종확정 대기)도 점유로 포함(respond/PATCH 경로와 통일).
          where: { workerId, status: { in: [...OCCUPYING_STATUSES] }, NOT: { siteId: site.id } },
          select: { workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true },
        });
        const timeConflict = findTimeConflict(
          { workType: "FULL_DAY", startDate: offer.serviceStart ?? new Date(), endDate: offer.serviceEnd ?? null },
          others,
        );
        if (wq.allowed && !dup && !timeConflict) { assignSiteId = site.id; assignAgencyId = site.agencyId; }
      }
    }

    let claimed = true;
    await prisma.$transaction(async (tx) => {
      // 원자적 claim — PENDING일 때만 상태 전이. 더블탭(동시 요청) 중 하나만 성공, 나머지는 count=0.
      const c = await tx.talentOffer.updateMany({
        where: { id, status: "PENDING" },
        data: { status: action === "accept" ? "ACCEPTED" : "DECLINED", decidedAt: new Date() },
      });
      if (c.count === 0) { claimed = false; return; }
      if (assignSiteId && assignAgencyId) {
        await tx.siteAssignment.create({
          data: {
            siteId: assignSiteId,
            workerId,
            agencyId: assignAgencyId,
            // 파이프라인: 제안 수락=ASSIGNED(계약 대기). 계약 서명→CONFIRMED, 연결+위치확정→ACTIVE.
            status: "ASSIGNED",
            isMainWorker: true,
            assignedAt: new Date(),
            // 제안에 명시된 직무지도 기간을 배정 기간으로 승계(없으면 오늘 시작)
            startDate: offer.serviceStart ?? new Date(),
            endDate: offer.serviceEnd ?? null,
            assignedByManagerId: offer.createdByManagerId,
            statusReason: "마켓플레이스 제안 수락 자동 배정",
            workType: "FULL_DAY",
            commuteGuidanceIncluded: false,
          },
        });
        autoAssigned = true;
      }
    });
    if (!claimed) return NextResponse.json({ success: false, message: "이미 처리된 제안입니다." }, { status: 409 });

    // 수락 결과 알림(WorkerNotice.agencyId 필수 → 위탁기관 연계일 때만, 무료 채널)
    const noticeAgencyId = assignAgencyId ?? offer.agencyId;
    if (action === "accept" && noticeAgencyId) {
      try {
        await prisma.workerNotice.create({
          data: {
            workerId,
            agencyId: noticeAgencyId,
            title: "[직무지도 매칭] 제안을 수락했습니다",
            body: autoAssigned
              ? `제안을 수락하여 '${offer.siteName ?? "현장"}'에 배정되었습니다. 앱에서 출퇴근·일지 작성을 시작할 수 있습니다.`
              : "제안을 수락했습니다. 담당자 연락 또는 배정 절차가 진행됩니다.",
            type: "INFO",
          },
        });
      } catch { /* 비치명적 */ }
    }

    return NextResponse.json({ success: true, autoAssigned });
  } catch (e: any) {
    console.error("[worker/recruit/offers PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
