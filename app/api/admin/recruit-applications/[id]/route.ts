// app/api/admin/recruit-applications/[id]/route.ts
// 신청 수락/반려 (공고 등록 주체만). 수락 = 매칭 성사 → 향후 worker 연계/배정의 트리거 지점.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { checkQuota } from "@/lib/planGuard";
import { findTimeConflict, OCCUPYING_STATUSES } from "@/lib/assignmentOverlap";
import { withWorkerAssignmentLock } from "@/lib/assignmentLock";

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

    // admin(운영자)은 모든 공고의 신청 처리 가능. manager는 본인/소속 공고만.
    const owned =
      session.kind === "manager"
        ? app.post.createdByManagerId === session.managerId || app.post.agencyId === session.agencyId
        : true;
    if (!owned) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (app.status !== "PENDING") {
      return NextResponse.json({ success: false, message: "이미 처리된 신청입니다." }, { status: 409 });
    }

    // 수락 시 → 운영 Site 생성/연계 + SiteAssignment 자동 생성(활성 worker 편입).
    // 단, "위탁기관 공고 + 좌표 보유"일 때만. 운영자(공단/플랫폼) 공고는 agencyId가 없어
    // 자동배정 대상이 아니고(운영 위탁기관 부재), ACCEPTED 표시 + 알림만 한다.
    let autoAssigned = false;
    const canAutoAssign =
      action === "accept" && app.post.agencyId != null && app.post.lat != null && app.post.lon != null;

    // 자동 배정 전제조건 검증(차단형·정적) — 통과 못 하면 수락 자체를 막아 신청은 PENDING 유지.
    //  (비활성 인력·구독 한도는 워커 배정 상태와 무관하므로 락 밖에서 검사. 시간겹침 재검사·생성은 락 안에서.)
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

    // ★워커 단위 advisory lock으로 "겹침 재검사 → 배정 생성"을 원자화(P1-5).
    await withWorkerAssignmentLock(app.workerId, async (tx) => {
      await tx.recruitApplication.update({
        where: { id: appId },
        data: { status: action === "accept" ? "ACCEPTED" : "REJECTED", decidedAt: new Date() },
      });

      if (!canAutoAssign) return;

      // ④ 시간겹침: 자동배정(FULL_DAY)이 다른 현장 진행중 배정과 겹치면 **자동배정만 건너뛴다**(수락 자체는 진행).
      //  E2: 과거엔 409로 하드블록 → 이미 배정된 워커의 마켓 수락이 영구 불가·신청 PENDING 고착.
      //   offers 경로와 동작 통일(soft-skip). E3: 겹침 스캔 status에 ACCEPTED 포함.
      //  ★후보 endDate는 '실제로 생성될 배정'과 동일하게 null(개방)로 둔다 — 생성은 endDate:null(M6)인데
      //   검사만 serviceEnd로 좁히면 serviceEnd 이후 겹침을 못 잡아 이중배정이 새어나간다(생성값=검사값 일치).
      const others = await tx.siteAssignment.findMany({
        where: { workerId: app.workerId, status: { in: [...OCCUPYING_STATUSES] }, ...(app.post.siteId != null ? { NOT: { siteId: app.post.siteId } } : {}) },
        select: { workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true, site: { select: { companyName: true } } },
      });
      const tc = findTimeConflict({ workType: "FULL_DAY", startDate: app.post.serviceStart ?? new Date(), endDate: null }, others);
      if (tc) return; // 시간겹침이면 수락만 기록, 자동배정은 매니저 수동 처리

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

      // ③ SiteAssignment 생성 — 파이프라인: 선정=ASSIGNED(계약 대기). 계약 서명→CONFIRMED, 연결+위치확정→ACTIVE.
      await tx.siteAssignment.create({
        data: {
          siteId,
          workerId: app.workerId,
          agencyId: app.post.agencyId,
          status: "ASSIGNED",
          isMainWorker: true,
          assignedAt: new Date(),
          // M6: 시작일을 공고 서비스 시작일로(과거엔 startDate:new Date()라 미래시작 공고가 '오늘'부터 잡혔음).
          //  ★endDate는 null(개방) 유지 — serviceEnd로 못박으면 M8 배정기간 가드와 겹쳐 서비스종료 후 연장근무 로그가
          //   막힌다. 실제 근무가 연장되면 배정은 열려 있어야 하고, 종료는 배정 종료 액션으로 처리한다.
          startDate: app.post.serviceStart ?? new Date(),
          endDate: null,
          assignedByManagerId: app.post.createdByManagerId, // RecruitPost 생성 매니저(Manager.id)
          statusReason: "마켓플레이스 매칭 수락 자동 배정",
          workType: "FULL_DAY",
          commuteGuidanceIncluded: false, // FULL_DAY는 출퇴근 지도 불가
        },
      });
      autoAssigned = true;
    });

    // 직무지도원에게 알림(매칭 결과) — WorkerNotice.agencyId 필수라 위탁기관 공고일 때만
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
