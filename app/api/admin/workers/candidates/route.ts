// GET /api/admin/workers/candidates?siteId=123
// 배정 요청 후보 직무지도원 조회 + 이력 기반 추천.
// 위탁기관과 현재/과거 근로계약(EmploymentContract)이 있는 직무지도원 목록.
// siteId가 주어지면 각 후보의 근무 이력으로 ①이 현장 경험 ②유사 업종 경험 ③경험 건수를 계산하고,
// 추천 우선순위(이 현장>유사 업종>가용성[미배정>종료 임박>무기한]>이름)로 정렬한다.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { AssignStatus } from "@prisma/client";

const ENGAGED: AssignStatus[] = ["ASSIGNED", "CONFIRMED", "ACTIVE"];
// '근무 이력'으로 인정하는 상태(요청/거절/탈락 제외)
const HISTORY: AssignStatus[] = ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"];
const FAR = 8640000000000000;

export async function GET(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const agencyId = scope.agencyId;

    const { searchParams } = new URL(request.url);
    const siteIdRaw = (searchParams.get("siteId") || "").trim();
    const targetSiteId = /^\d+$/.test(siteIdRaw) ? siteIdRaw : null;

    // 대상 현장의 업종(유사 업종 경험 판정용)
    let targetBizType: string | null = null;
    let engagedAtSite = new Set<string>();
    if (targetSiteId) {
      const site = await prisma.site.findUnique({ where: { id: BigInt(targetSiteId) }, select: { businessType: true } });
      targetBizType = site?.businessType ?? null;
      // 그 현장에 이미 진행 중(요청/수락/계약대기/근무 중)이거나 이 현장 요청을 거절(REJECTED)한 워커는 후보에서 제외.
      // ※ 현장(siteId) 단위 판정 — 다른 현장 요청에는 영향 없음(거절은 해당 건만 막음).
      const eng = await prisma.siteAssignment.findMany({
        where: { siteId: BigInt(targetSiteId), agencyId, status: { in: ["REQUESTED", "ACCEPTED", "ASSIGNED", "CONFIRMED", "ACTIVE", "REJECTED"] } },
        select: { workerId: true },
      });
      engagedAtSite = new Set(eng.map(e => e.workerId.toString()));
    }

    // 이 위탁기관과 계약(현재/과거)이 있던 직무지도원 id
    const contracts = await prisma.employmentContract.findMany({
      where: { agencyId },
      select: { workerId: true },
      distinct: ["workerId"],
    });
    const workerIds = contracts.map((c) => c.workerId);
    if (workerIds.length === 0) return NextResponse.json({ success: true, items: [] });

    const candidateIds = engagedAtSite.size > 0 ? workerIds.filter(id => !engagedAtSite.has(id.toString())) : workerIds;
    const workers = await prisma.worker.findMany({
      where: { id: { in: candidateIds }, status: "ACTIVE" },
      select: {
        id: true,
        workerName: true,
        phoneNumber: true,
        // 근무 이력 전체(현장·업종 포함) — 이 현장/유사 업종 경험 계산용
        assignments: {
          where: { status: { in: HISTORY } },
          select: {
            siteId: true, agencyId: true, status: true, startDate: true, endDate: true,
            site: { select: { companyName: true, businessType: true } },
          },
          orderBy: { startDate: "desc" },
        },
      },
    });

    let items = workers.map((w) => {
      const all = w.assignments;
      // 현재 진행 중 배정(이 기관 한정 아님 — 가용성 판단용)
      const engagedAsgn = all.find((a) => ENGAGED.includes(a.status)) ?? null;
      const sameSite = targetSiteId ? all.some((a) => a.siteId.toString() === targetSiteId) : false;
      const sameBizType = targetBizType ? all.some((a) => a.site?.businessType === targetBizType) : false;
      return {
        id: String(w.id),
        name: w.workerName,
        phone: w.phoneNumber,
        engaged: !!engagedAsgn,
        currentStatus: engagedAsgn ? String(engagedAsgn.status) : null,
        // ★크로스테넌트 노출 방지: 진행 중 배정이 타 기관 것이면 고객사명(영업기밀)은 마스킹.
        //  가용성 판단(engaged·기간)은 유지 — 배정요청 가능 여부 표시는 그대로.
        currentSiteName: engagedAsgn
          ? (engagedAsgn.agencyId === agencyId ? engagedAsgn.site?.companyName ?? null : "타 기관 현장")
          : null,
        periodStart: engagedAsgn?.startDate ? engagedAsgn.startDate.toISOString() : null,
        periodEnd: engagedAsgn?.endDate ? engagedAsgn.endDate.toISOString() : null,
        // 이력 기반 추천
        experienceCount: all.length,
        sameSite,
        sameBizType,
      };
    });

    // 가용성 랭크(작을수록 우선): 미배정 0 < 종료일 있음 1 < 무기한 2
    const availRank = (c: typeof items[number]) => (!c.engaged ? 0 : c.periodEnd ? 1 : 2);
    const endMs = (c: typeof items[number]) => (c.periodEnd ? new Date(c.periodEnd).getTime() : FAR);

    items.sort((a, b) => {
      if (targetSiteId) {
        if (a.sameSite !== b.sameSite) return a.sameSite ? -1 : 1;
        if (a.sameBizType !== b.sameBizType) return a.sameBizType ? -1 : 1;
      }
      const ra = availRank(a), rb = availRank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 1) return endMs(a) - endMs(b); // 둘 다 종료일 있음 → 임박순
      return a.name.localeCompare(b.name, "ko");
    });

    return NextResponse.json({ success: true, items });
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error("[admin/workers/candidates]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
