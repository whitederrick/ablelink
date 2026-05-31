// app/api/admin/recruit-applications/[id]/route.ts
// 신청 수락/반려 (공고 등록 주체만). 수락 = 매칭 성사 → 향후 worker 연계/배정의 트리거 지점.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { checkQuota } from "@/lib/planGuard";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;
    const appId = parseBigInt(id);
    if (!appId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const b = await req.json();
    const action = String(b.action ?? "");
    if (!["accept", "reject"].includes(action)) {
      return NextResponse.json({ success: false, message: "action은 accept 또는 reject여야 합니다." }, { status: 400 });
    }

    const app = await prisma.recruitApplication.findUnique({
      where: { id: appId },
      include: { post: true },
    });
    if (!app) return NextResponse.json({ success: false, message: "신청을 찾을 수 없습니다." }, { status: 404 });

    const owned =
      session.kind === "manager"
        ? app.post.createdByManagerId === session.managerId || app.post.agencyId === session.agencyId
        : app.post.createdByAdminId === session.adminId;
    if (!owned) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (app.status !== "PENDING") {
      return NextResponse.json({ success: false, message: "이미 처리된 신청입니다." }, { status: 409 });
    }

    // 수락 시 → 운영 Site 생성/연계 + SiteAssignment 자동 생성(활성 worker 편입).
    // 단, "에이전시 공고 + 좌표 보유"일 때만. 운영자(공단/플랫폼) 공고는 agencyId가 없어
    // 자동배정 대상이 아니고(운영 에이전시 부재), ACCEPTED 표시 + 알림만 한다.
    let autoAssigned = false;
    const canAutoAssign =
      action === "accept" && app.post.agencyId != null && app.post.lat != null && app.post.lon != null;

    // 자동 배정 전제조건 검증(차단형) — 통과 못 하면 수락 자체를 막아 신청은 PENDING 유지.
    if (canAutoAssign) {
      // ① 비활성 인력은 배정 불가 (수동 배정과 동일 가드)
      const w = await prisma.worker.findUnique({ where: { id: app.workerId }, select: { status: true } });
      if (!w || String(w.status) !== "ACTIVE") {
        return NextResponse.json({ success: false, message: "비활성 상태의 인력은 배정할 수 없습니다." }, { status: 409 });
      }
      // ② 구독 한도 — Site 신규 생성이 필요할 때만 sites 한도 체크(재사용은 미소모)
      if (app.post.siteId == null) {
        const sq = await checkQuota(app.post.agencyId!, "sites");
        if (!sq.allowed) {
          return NextResponse.json({ success: false, message: `사업장 한도(${sq.current}/${sq.max})를 초과했습니다. 플랜을 업그레이드해주세요.` }, { status: 409 });
        }
      }
      // ③ 인력(ACTIVE 배정) 한도
      const wq = await checkQuota(app.post.agencyId!, "workers");
      if (!wq.allowed) {
        return NextResponse.json({ success: false, message: `인력 한도(${wq.current}/${wq.max})를 초과했습니다. 플랜을 업그레이드해주세요.` }, { status: 409 });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.recruitApplication.update({
        where: { id: appId },
        data: { status: action === "accept" ? "ACCEPTED" : "REJECTED", decidedAt: new Date() },
      });

      if (!canAutoAssign) return;

      // ① Site find-or-create (첫 수락 시 공고 정보로 생성, 이후 재사용 — headcount>1)
      let siteId = app.post.siteId;
      if (!siteId) {
        const site = await tx.site.create({
          data: {
            companyName: app.post.companyName,
            address: app.post.address,
            detailAddress: app.post.detailAddress,
            gpsLat: app.post.lat!,
            gpsLon: app.post.lon!,
            agencyId: app.post.agencyId,            // 실귀속 = agency
            siteSourceType: "AGENCY",
            requiredProfession: app.post.profession,
            isVerified: true,
            isActive: true,
          },
          select: { id: true },
        });
        siteId = site.id;
        await tx.recruitPost.update({ where: { id: app.post.id }, data: { siteId } });
      }

      // ② 동일 site/worker 활성 배정 중복 방지
      const dup = await tx.siteAssignment.findFirst({
        where: { siteId, workerId: app.workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
        select: { id: true },
      });
      if (dup) return;

      // ③ SiteAssignment 생성 (초대·셀프등록과 동일하게 ACTIVE로 — 급여·근태·구독 인원 집계 누락 방지)
      await tx.siteAssignment.create({
        data: {
          siteId,
          workerId: app.workerId,
          agencyId: app.post.agencyId,
          status: "ACTIVE",
          isMainWorker: true,
          assignedAt: new Date(),
          startDate: new Date(),
          assignedByManagerId: app.post.createdByManagerId, // RecruitPost 생성 매니저(Manager.id)
          statusReason: "마켓플레이스 매칭 수락 자동 배정",
          workType: "FULL_DAY",
          commuteGuidanceIncluded: false, // FULL_DAY는 출퇴근 지도 불가
        },
      });
      autoAssigned = true;
    });

    // 직무지도원에게 알림(매칭 결과) — WorkerNotice.agencyId 필수라 에이전시 공고일 때만
    if (app.post.agencyId) {
      try {
        await prisma.workerNotice.create({
          data: {
            workerId: app.workerId,
            agencyId: app.post.agencyId,
            title: action === "accept" ? "[직무지도 매칭] 신청이 수락되었습니다" : "[직무지도 매칭] 신청 결과 안내",
            body:
              action === "accept"
                ? autoAssigned
                  ? `'${app.post.companyName}' 직무지도 신청이 수락되어 현장에 배정되었습니다. 앱에서 출퇴근·일지 작성을 시작할 수 있습니다.`
                  : `'${app.post.companyName}' 직무지도 신청이 수락되었습니다. 담당자 연락 또는 배정 절차가 진행됩니다.`
                : `'${app.post.companyName}' 직무지도 신청이 이번에는 반영되지 않았습니다.`,
            type: "INFO",
          },
        });
      } catch { /* 알림 실패는 비치명적 */ }
    }

    return NextResponse.json({ success: true, autoAssigned });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[recruit-applications/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
