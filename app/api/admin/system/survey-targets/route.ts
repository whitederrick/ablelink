// app/api/admin/system/survey-targets/route.ts
// 운영자(시스템): 직무지도원 평가 요청 '대상자' 현황.
// 계약이 종료된(또는 임박한) 직무지도원 × 평가요청 발송 여부를 한 곳에서 식별.
// 에이전시 매니저가 요청하지 않은 건을 운영자가 직접 확인·발송하기 위한 목록.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

const WINDOW_DAYS = 180; // 너무 오래된 계약은 제외(목록 경량화)

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);

    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // 1) 종료된(또는 임박: contractEnd<=now+7일) 계약 — 평가 요청 대상
    const grace = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const contracts = await prisma.employmentContract.findMany({
      where: {
        status: { in: ["SIGNED", "COMPLETED"] },
        contractEnd: { gte: windowStart, lte: grace },
      },
      orderBy: { contractEnd: "desc" },
      take: 500,
      select: {
        id: true, agencyId: true, workerId: true, siteName: true,
        workerFilledSiteName: true, contractStart: true, contractEnd: true,
        agency: { select: { name: true } },
        user: { select: { workerName: true } },
      },
    });

    if (contracts.length === 0) return NextResponse.json({ success: true, items: [] });

    const agencyIds = [...new Set(contracts.map(c => c.agencyId))];
    const workerIds = [...new Set(contracts.map(c => c.workerId))];

    // 2) 사업체 담당자 연락처(현장명 일치) 매핑
    const siteNames = [...new Set(contracts.map(c => c.siteName || c.workerFilledSiteName).filter((s): s is string => !!s))];
    const sites = siteNames.length
      ? await prisma.site.findMany({
          where: { agencyId: { in: agencyIds }, companyName: { in: siteNames } },
          select: { agencyId: true, companyName: true, businessContactName: true, businessContactPhone: true },
        })
      : [];
    const siteMap = new Map(sites.map(s => [`${s.agencyId}|${s.companyName}`, s]));

    // 3) 관련 평가요청(만족도) — 메모리 매칭(N+1 회피)
    const surveys = await prisma.satisfactionSurvey.findMany({
      where: { agencyId: { in: agencyIds }, workerId: { in: workerIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, agencyId: true, workerId: true, contractId: true, status: true,
        auto: true, createdByManagerId: true, overallScore: true, sharedWithAgency: true,
        sentAt: true, respondedAt: true, createdAt: true,
      },
    });

    const items = contracts.map(c => {
      const siteName = c.siteName || c.workerFilledSiteName || null;
      const site = siteName ? siteMap.get(`${c.agencyId}|${siteName}`) : undefined;

      // 매칭: ① contractId 일치 우선 ② 없으면 같은 에이전시·직무지도원 + 계약종료 이후 생성된 최신 요청
      let matched = surveys.find(s => s.contractId === c.id);
      if (!matched) {
        const buffer = new Date(c.contractEnd.getTime() - 24 * 60 * 60 * 1000);
        matched = surveys.find(s => s.agencyId === c.agencyId && s.workerId === c.workerId && s.contractId == null && s.createdAt >= buffer);
      }

      const requestedBy = matched
        ? (matched.auto ? "AUTO" : matched.createdByManagerId ? "MANAGER" : "OPERATOR")
        : null;

      return {
        contractId: String(c.id),
        agencyId: String(c.agencyId),
        agencyName: c.agency?.name ?? "",
        workerId: String(c.workerId),
        workerName: c.user?.workerName ?? "",
        siteName,
        recipientName: site?.businessContactName ?? null,
        recipientPhone: site?.businessContactPhone ?? null,
        hasContact: !!site?.businessContactPhone,
        contractStart: c.contractStart.toISOString().slice(0, 10),
        contractEnd: c.contractEnd.toISOString().slice(0, 10),
        ended: c.contractEnd <= now,
        // 요청 상태: NONE(미요청) | PENDING | RESPONDED | EXPIRED | CANCELLED
        requestStatus: matched?.status ?? "NONE",
        requestedBy, // AUTO | MANAGER | OPERATOR | null
        surveyId: matched ? String(matched.id) : null,
        overallScore: matched?.status === "RESPONDED" ? matched.overallScore : null,
        sharedWithAgency: matched?.sharedWithAgency ?? false,
        sentAt: matched?.sentAt?.toISOString() ?? null,
        respondedAt: matched?.respondedAt?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/survey-targets GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
