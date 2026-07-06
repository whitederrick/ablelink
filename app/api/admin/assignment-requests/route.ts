// app/api/admin/assignment-requests/route.ts
// 배정 요청 관리(위탁기관 담당자):
//  - GET  : 회신 대기/수락(REQUESTED/ACCEPTED) 후보를 현장별로 묶어 조회. 조회 시점에 기한 초과 REQUESTED는 EXPIRED 지연처리.
//  - POST : { action:"confirm"|"reject", assignmentId }
//      confirm → 해당 후보 ASSIGNED(계약 대기) 확정 + 같은 현장 경쟁 후보(REQUESTED/ACCEPTED) 전원 REJECTED(탈락)
//      reject  → 해당 후보만 REJECTED(탈락)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { findTimeConflict } from "@/lib/assignmentOverlap";

async function expirePastDeadline(agencyId: bigint) {
  await prisma.siteAssignment.updateMany({
    where: { agencyId, status: "REQUESTED", replyDeadline: { lt: new Date() } },
    data: { status: "EXPIRED", rejectedAt: new Date(), statusReason: "회신 기한 초과 자동 탈락" },
  });
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    await expirePastDeadline(agencyId);

    // 진행 중(요청/수락) + 최근 7일 내 탈락/기한초과(되돌리기 가능하도록 목록에 잠시 남김)
    const recentCut = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await prisma.siteAssignment.findMany({
      where: {
        agencyId,
        OR: [
          { status: { in: ["REQUESTED", "ACCEPTED"] } },
          // 워커 거절(REJECTED, 읽기전용) · 담당자 탈락(DROPPED, 되돌리기) · 기한초과(EXPIRED, 되돌리기) 최근분
          { status: { in: ["REJECTED", "DROPPED", "EXPIRED"] }, rejectedAt: { gte: recentCut } },
        ],
      },
      include: {
        site: { select: { id: true, companyName: true, address: true, amCapacity: true, pmCapacity: true, fullDayCapacity: true } },
        user: { select: { id: true, workerName: true, loginId: true, phoneNumber: true } },
      },
      orderBy: [{ siteId: "asc" }, { id: "asc" }],
    });

    const groupsMap = new Map<string, any>();
    for (const a of rows) {
      const key = a.siteId.toString();
      if (!groupsMap.has(key)) {
        const capAm = a.site?.amCapacity ?? 0, capPm = a.site?.pmCapacity ?? 0, capFull = a.site?.fullDayCapacity ?? 0;
        groupsMap.set(key, { siteId: key, siteName: a.site?.companyName ?? "현장", siteAddress: a.site?.address ?? "", capacity: capAm + capPm + capFull, capAm, capPm, capFull, candidates: [] });
      }
      groupsMap.get(key).candidates.push({
        assignmentId: a.id.toString(),
        workerId: a.workerId.toString(),
        workerName: a.user?.workerName ?? "",
        loginId: a.user?.loginId ?? "",
        phone: a.user?.phoneNumber ?? "",
        status: String(a.status), // REQUESTED(회신 대기) | ACCEPTED(수락)
        chosenWorkType: a.workType ?? null, // ACCEPTED면 후보가 선택한 근무형태
        requestedWorkTypes: (a.requestedWorkTypes ?? "").split(",").filter(Boolean),
        replyDeadline: a.replyDeadline ? a.replyDeadline.toISOString() : null,
        requestedAt: a.assignedAt ? a.assignedAt.toISOString() : null, // 요청 발송 시각(assignedAt = 요청 생성/재요청 시점)
      });
    }

    // 남은 모집 = 정원 − 이미 확정/근무 중(ASSIGNED/CONFIRMED/ACTIVE) 인원. 근무형태별로 차감.
    const siteIdList = Array.from(groupsMap.keys()).map(k => BigInt(k));
    if (siteIdList.length > 0) {
      const filled = await prisma.siteAssignment.groupBy({
        by: ["siteId", "workType"],
        where: { agencyId, siteId: { in: siteIdList }, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
        _count: { _all: true },
      });
      const filledMap = new Map<string, { AM: number; PM: number; FULL_DAY: number }>();
      for (const f of filled) {
        const k = f.siteId.toString();
        if (!filledMap.has(k)) filledMap.set(k, { AM: 0, PM: 0, FULL_DAY: 0 });
        const wt = String(f.workType ?? "");
        if (wt === "AM" || wt === "PM" || wt === "FULL_DAY") filledMap.get(k)![wt] += f._count._all;
      }
      for (const [k, g] of groupsMap) {
        const fm = filledMap.get(k) ?? { AM: 0, PM: 0, FULL_DAY: 0 };
        g.capAm = Math.max(0, g.capAm - fm.AM);
        g.capPm = Math.max(0, g.capPm - fm.PM);
        g.capFull = Math.max(0, g.capFull - fm.FULL_DAY);
        g.capacity = g.capAm + g.capPm + g.capFull;
      }
    }

    return NextResponse.json({ success: true, groups: Array.from(groupsMap.values()) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/assignment-requests][GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();
    // reject/restore는 assignmentId 필요. finalize는 siteId 사용(아래 분기에서 검증).
    const parseAid = () => {
      const aid = String(body?.assignmentId ?? "").trim();
      return /^\d+$/.test(aid) ? BigInt(aid) : null;
    };

    // 담당자 탈락: 수락(ACCEPTED) 후보를 DROPPED(되돌리기 가능). 워커 거절(REJECTED)은 담당자가 못 건드림.
    if (action === "reject") {
      const id = parseAid();
      if (id === null) return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
      const asgn = await prisma.siteAssignment.findFirst({
        where: { id, agencyId, status: "ACCEPTED" },
        select: { id: true },
      });
      if (!asgn) return NextResponse.json({ success: false, message: "수락한 후보만 탈락 처리할 수 있습니다." }, { status: 409 });
      await prisma.siteAssignment.updateMany({
        where: { id, status: "ACCEPTED" },
        data: { status: "DROPPED", rejectedAt: new Date(), statusReason: "담당자 탈락" },
      });
      return NextResponse.json({ success: true, status: "DROPPED" });
    }

    // 되돌리기: 담당자 탈락(DROPPED)·기한초과(EXPIRED)만. 워커 거절은 복원 불가.
    if (action === "restore") {
      const id = parseAid();
      if (id === null) return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
      const asgn = await prisma.siteAssignment.findFirst({
        where: { id, agencyId, status: { in: ["DROPPED", "EXPIRED"] } },
        select: { id: true, workType: true, replyDeadline: true },
      });
      if (!asgn) return NextResponse.json({ success: false, message: "되돌릴 대상을 찾을 수 없습니다." }, { status: 404 });
      const restoreTo = asgn.workType ? "ACCEPTED" : "REQUESTED";
      const data: any = { status: restoreTo, rejectedAt: null, statusReason: null };
      if (asgn.replyDeadline && asgn.replyDeadline < new Date()) data.replyDeadline = null;
      await prisma.siteAssignment.updateMany({ where: { id, status: { in: ["DROPPED", "EXPIRED"] } }, data });
      return NextResponse.json({ success: true, status: restoreTo });
    }

    // 최종 확정(현장 단위 일괄): 선정된 ACCEPTED → ASSIGNED, 나머지 REQUESTED/ACCEPTED → DROPPED.
    if (action === "finalize") {
      const siteIdStr = String(body?.siteId ?? "").trim();
      if (!/^\d+$/.test(siteIdStr)) return NextResponse.json({ success: false, message: "현장 정보가 올바르지 않습니다." }, { status: 400 });
      const siteId = BigInt(siteIdStr);
      const rawSel: any[] = Array.isArray(body?.selectedAssignmentIds) ? body.selectedAssignmentIds : [];
      const selectedIds = rawSel.filter(x => /^\d+$/.test(String(x))).map(x => BigInt(String(x)));
      if (selectedIds.length === 0) return NextResponse.json({ success: false, message: "선정된 후보가 없습니다." }, { status: 400 });

      const site = await prisma.site.findFirst({
        where: { id: siteId, agencyId },
        select: { companyName: true, amCapacity: true, pmCapacity: true, fullDayCapacity: true },
      });
      if (!site) return NextResponse.json({ success: false, message: "현장을 찾을 수 없습니다." }, { status: 404 });
      const cap = (site.amCapacity ?? 0) + (site.pmCapacity ?? 0) + (site.fullDayCapacity ?? 0);
      // 이미 채워진(계약대기/연결/근무 중) 인원 → 남은 모집
      const filledCnt = await prisma.siteAssignment.count({ where: { agencyId, siteId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } } });
      const remaining = Math.max(0, cap - filledCnt);

      // 선정 대상 = 이 현장의 수락(ACCEPTED) 또는 제외(DROPPED) 후보. (제외 후보 재선정 허용)
      // 기한 초과(EXPIRED)·거절(REJECTED)·회신 대기(REQUESTED)는 선정 불가.
      const eligible = await prisma.siteAssignment.findMany({ where: { agencyId, siteId, status: { in: ["ACCEPTED", "DROPPED"] } }, select: { id: true, workerId: true } });
      const eligibleIds = new Set(eligible.map(a => a.id.toString()));
      for (const sid of selectedIds) {
        if (!eligibleIds.has(sid.toString())) return NextResponse.json({ success: false, message: "선정 대상이 올바르지 않습니다." }, { status: 400 });
      }
      // 초과 가드: 선정 수 > 남은 모집.
      //  M7: 조건을 `cap > 0`로 — 과거 `remaining > 0`은 정원이 이미 꽉 찬(remaining=0) 상태에서 초과선정을 통과시켰다.
      //   cap=0(정원 미설정=무제한)일 때만 가드를 건너뛰고, 정원이 있으면 remaining=0에서도 1명 이상 선정을 막는다.
      if (cap > 0 && selectedIds.length > remaining) {
        return NextResponse.json({ success: false, code: "OVER_CAPACITY", message: `선정 인원이 모집 인원을 초과하였습니다. 최종 선정을 재확인해주십시오. (선정 ${selectedIds.length}명 / 모집 ${remaining}명)` }, { status: 409 });
      }
      const isFull = filledCnt + selectedIds.length >= cap; // 이번 확정으로 정원이 다 차는가

      // E3: ASSIGNED 승격 전 시간겹침 검사 — 선정자가 다른 현장 진행중 배정과 같은 날 슬롯이 겹치면 이중배정.
      //  (finalize·restore가 겹침가드 없이 상태를 올려 respond/PATCH의 409를 우회하던 경로 차단.)
      const selDetails = await prisma.siteAssignment.findMany({
        where: { id: { in: selectedIds } },
        select: { id: true, workerId: true, workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true },
      });
      for (const s of selDetails) {
        const others = await prisma.siteAssignment.findMany({
          where: { workerId: s.workerId, agencyId, status: { in: ["ACCEPTED", "ASSIGNED", "CONFIRMED", "ACTIVE"] }, NOT: { id: s.id }, siteId: { not: siteId } },
          select: { workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true, site: { select: { companyName: true } } },
        });
        const c = findTimeConflict(s, others);
        if (c) {
          const w = await prisma.worker.findUnique({ where: { id: s.workerId }, select: { workerName: true } });
          return NextResponse.json({ success: false, code: "TIME_CONFLICT", message: `${w?.workerName ?? "직무지도원"}님이 다른 현장(${(c as any).site?.companyName ?? "-"}) 배정과 같은 날 근무시간이 겹칩니다. 근무형태를 조정한 뒤 확정해주세요.` }, { status: 409 });
        }
      }

      // 선정 → ASSIGNED(계약 대기). 선정하지 않은 수락/제외 후보 → DROPPED('제외', 부분 재요청 시 복원 가능).
      // 회신 대기(REQUESTED)는 건드리지 않음(여전히 응답 대기). '제외 상태 저장'은 이 확정 시점에 일괄 반영.
      await prisma.$transaction([
        prisma.siteAssignment.updateMany({ where: { agencyId, siteId, id: { in: selectedIds }, status: { in: ["ACCEPTED", "DROPPED"] } }, data: { status: "ASSIGNED", rejectedAt: null, statusReason: null } }),
        prisma.siteAssignment.updateMany({ where: { agencyId, siteId, id: { notIn: selectedIds }, status: { in: ["ACCEPTED", "DROPPED"] } }, data: { status: "DROPPED", rejectedAt: new Date(), statusReason: "제외" } }),
      ]);

      // 선정자에게 앱 내 알림(무료)
      const selectedSet = new Set(selectedIds.map(s => s.toString()));
      for (const a of eligible) {
        if (!selectedSet.has(a.id.toString())) continue;
        try {
          await prisma.workerNotice.create({
            data: { workerId: a.workerId, agencyId, title: "[배정] 배정이 확정되었습니다", body: `${site.companyName ?? "현장"} 배정이 확정되었습니다. 계약서 작성을 기다려주세요.`, type: "INFO", link: "/worker/home" },
          });
        } catch { /* 알림 실패 무시 */ }
      }
      return NextResponse.json({ success: true, assigned: selectedIds.length, full: isFull });
    }

    return NextResponse.json({ success: false, message: "잘못된 동작입니다." }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/assignment-requests][POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
