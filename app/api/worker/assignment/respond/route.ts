// app/api/worker/assignment/respond/route.ts
// 직무지도원이 배정 요청(REQUESTED)에 회신: 수락(희망 근무형태 선택) / 거절.
//  - 단일 후보(같은 현장에 경쟁 후보 없음) 수락 → 바로 ASSIGNED(계약 대기, 근무형태 확정).
//  - 복수 후보 수락 → ACCEPTED(위탁기관 담당자 최종확정 대기).
//  - 거절 → REJECTED.
// 회신 기한 초과 건은 수락 불가(EXPIRED 처리).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { audit } from "@/lib/audit";
import { findTimeConflict, OCCUPYING_STATUSES } from "@/lib/assignmentOverlap";

const VALID_WT = ["AM", "PM", "FULL_DAY", "CUSTOM"];

export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }
    const workerId = BigInt(session.workerId);

    const body = await req.json().catch(() => ({}));
    const assignmentId = String(body?.assignmentId ?? "").trim();
    const action = String(body?.action ?? "").trim(); // "accept" | "decline"
    const workType = body?.workType != null ? String(body.workType).trim() : "";

    if (!/^\d+$/.test(assignmentId)) {
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
    }

    const asgn = await prisma.siteAssignment.findFirst({
      where: { id: BigInt(assignmentId), workerId, status: "REQUESTED" },
      select: { id: true, siteId: true, startDate: true, endDate: true, replyDeadline: true, requestedWorkTypes: true, site: { select: { companyName: true, ownerManagerId: true, agencyId: true } } },
    });
    if (!asgn) {
      return NextResponse.json({ success: false, message: "회신할 배정 요청을 찾을 수 없습니다." }, { status: 404 });
    }

    // 배정 회신(수락/거절)을 담당 매니저(없으면 기관 전체 활성 매니저)에게 알림 — 비대칭 해소.
    async function notifyManagers(statusText: string) {
      try {
        const site = asgn!.site;
        let managerIds: bigint[] = [];
        if (site?.ownerManagerId) managerIds = [site.ownerManagerId];
        else if (site?.agencyId) {
          const mgrs = await prisma.manager.findMany({ where: { agencyId: site.agencyId, isActive: true }, select: { id: true } });
          managerIds = mgrs.map(m => m.id);
        }
        if (managerIds.length === 0) return;
        const w = await prisma.worker.findUnique({ where: { id: workerId }, select: { workerName: true } });
        const name = w?.workerName ?? "직무지도원";
        await prisma.managerNotice.createMany({
          data: managerIds.map(mid => ({
            managerId: mid,
            title: `[배정 회신] ${name} — ${statusText}`,
            body: `${name} 직무지도원이 '${site?.companyName ?? "현장"}' 배정 요청에 ${statusText}했습니다.`,
            link: "/manager/workers",
          })),
        });
      } catch (e) { console.warn("[assignment/respond] 매니저 알림 실패:", e); }
    }

    // 회신 기한 초과 → 자동 탈락(EXPIRED)
    if (asgn.replyDeadline && new Date() > asgn.replyDeadline) {
      await prisma.siteAssignment.updateMany({
        where: { id: asgn.id, status: "REQUESTED" },
        data: { status: "EXPIRED", rejectedAt: new Date(), statusReason: "회신 기한 초과 자동 탈락" },
      });
      return NextResponse.json({ success: false, message: "회신 기한이 지나 자동 탈락되었습니다." }, { status: 410 });
    }

    if (action === "decline") {
      await prisma.siteAssignment.updateMany({
        where: { id: asgn.id, status: "REQUESTED" },
        data: { status: "REJECTED", rejectedAt: new Date(), statusReason: "후보 거절" },
      });
      await audit(session, { entityType: "SiteAssignment", entityId: asgn.id, action: "update", summary: "배정 응답(거절)" });
      await notifyManagers("거절");
      return NextResponse.json({ success: true, status: "REJECTED", message: "배정 요청을 거절했습니다." });
    }

    if (action !== "accept") {
      return NextResponse.json({ success: false, message: "잘못된 회신입니다." }, { status: 400 });
    }

    // 수락: 희망 근무형태가 요청 근무형태 목록에 포함돼야 함
    const offered = (asgn.requestedWorkTypes ?? "").split(",").filter(Boolean);
    if (!VALID_WT.includes(workType) || (offered.length > 0 && !offered.includes(workType))) {
      return NextResponse.json({ success: false, message: "요청된 근무형태 중 하나를 선택해주세요." }, { status: 400 });
    }
    const commuteGuidanceIncluded = workType === "FULL_DAY" ? false : true;

    // ★멀티현장 시간겹침 방지: 선택한 근무형태가 같은 워커의 다른 현장 진행중 배정과
    //   같은 날 반나절 슬롯(AM/PM)이 겹치면 수락 차단(예: 다른 현장 오전 + 이 요청 종일).
    {
      const others = await prisma.siteAssignment.findMany({
        where: { workerId, status: { in: [...OCCUPYING_STATUSES] }, NOT: { id: asgn.id } },
        select: { workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true, site: { select: { companyName: true } } },
      });
      const conflict = findTimeConflict(
        { workType, startDate: asgn.startDate, endDate: asgn.endDate },
        others,
      );
      if (conflict) {
        return NextResponse.json(
          { success: false, message: `다른 현장(${(conflict as any).site?.companyName ?? "-"}) 배정과 같은 날 근무시간이 겹칩니다. 겹치지 않는 근무형태(오전/오후)를 선택하거나 담당자에게 문의해주세요.` },
          { status: 409 },
        );
      }
    }

    // 같은 현장에 경쟁 후보(요청 중 또는 이미 수락) 존재 여부 → 단일/복수 판정
    const others = await prisma.siteAssignment.count({
      where: {
        siteId: asgn.siteId,
        id: { not: asgn.id },
        status: { in: ["REQUESTED", "ACCEPTED"] },
      },
    });

    if (others === 0) {
      // 단일 후보 → 바로 계약 대기(ASSIGNED). 본인 계정에서 수락했으므로 연결(connectedAt)까지 처리.
      await prisma.siteAssignment.updateMany({
        where: { id: asgn.id, status: "REQUESTED" },
        data: { status: "ASSIGNED", workType, commuteGuidanceIncluded, connectedAt: new Date() },
      });
      await audit(session, { entityType: "SiteAssignment", entityId: asgn.id, action: "update", summary: "배정 응답(수락·계약 대기)" });
      await notifyManagers("수락(계약 대기)");
      return NextResponse.json({
        success: true, status: "ASSIGNED",
        message: "배정 요청을 수락했습니다. 계약서 작성을 기다려주세요.",
        siteName: asgn.site?.companyName ?? null,
      });
    }

    // 복수 후보 → 수락(ACCEPTED). 담당자 최종확정 대기.
    await prisma.siteAssignment.updateMany({
      where: { id: asgn.id, status: "REQUESTED" },
      data: { status: "ACCEPTED", workType, commuteGuidanceIncluded, connectedAt: new Date() },
    });
    await audit(session, { entityType: "SiteAssignment", entityId: asgn.id, action: "update", summary: "배정 응답(수락·확정 대기)" });
    await notifyManagers("수락(확정 대기)");
    return NextResponse.json({
      success: true, status: "ACCEPTED",
      message: "배정 요청을 수락했습니다. 담당자 확정을 기다려주세요.",
      siteName: asgn.site?.companyName ?? null,
    });
  } catch (err) {
    console.error("[worker/assignment/respond]", err);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
