// app/api/admin/system/worker-search/route.ts
// 운영자(시스템): 전체 직무지도원 검색(계약 이력 기준, 에이전시 스코프 없음).
// free-form 평가 요청용 — 각 직무지도원의 에이전시 후보(소속 계약별)와 사업체 담당자 연락처 prefill 포함.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    if (q.length < 2 || q.length > 100) return NextResponse.json({ success: true, items: [] });

    const workers = await prisma.worker.findMany({
      where: {
        employmentContracts: { some: {} },
        OR: [
          { workerName: { contains: q, mode: "insensitive" } },
          { phoneNumber: { contains: q } },
        ],
      },
      select: {
        id: true, workerName: true, phoneNumber: true,
        employmentContracts: {
          orderBy: { contractEnd: "desc" },
          select: {
            id: true, agencyId: true, siteName: true, workerFilledSiteName: true,
            contractStart: true, contractEnd: true,
            agency: { select: { name: true } },
          },
        },
      },
      take: 20,
    });

    // 사업체 담당자 연락처 prefill: (agencyId, companyName) → businessContact 배치 조회
    const sitePairs = new Map<string, { agencyId: bigint; companyName: string }>();
    for (const w of workers) {
      for (const c of w.employmentContracts) {
        const sn = c.siteName || c.workerFilledSiteName;
        if (sn) sitePairs.set(`${c.agencyId}|${sn}`, { agencyId: c.agencyId, companyName: sn });
      }
    }
    const pairs = [...sitePairs.values()];
    const sites = pairs.length
      ? await prisma.site.findMany({
          where: { OR: pairs.map(p => ({ agencyId: p.agencyId, companyName: p.companyName })) },
          select: { agencyId: true, companyName: true, businessContactName: true, businessContactPhone: true },
        })
      : [];
    const siteMap = new Map(sites.map(s => [`${s.agencyId}|${s.companyName}`, s]));

    const items = workers.map(w => {
      // 에이전시별 최신 계약 1건씩 → 에이전시 후보
      const byAgency = new Map<string, (typeof w.employmentContracts)[number]>();
      for (const c of w.employmentContracts) {
        const key = String(c.agencyId);
        if (!byAgency.has(key)) byAgency.set(key, c); // 이미 contractEnd desc 정렬 → 첫 건이 최신
      }
      const agencies = [...byAgency.values()].map(c => {
        const siteName = c.siteName || c.workerFilledSiteName || null;
        const site = siteName ? siteMap.get(`${c.agencyId}|${siteName}`) : undefined;
        return {
          agencyId: String(c.agencyId),
          agencyName: c.agency?.name ?? "",
          latestContractId: String(c.id),
          siteName,
          contractEnd: c.contractEnd.toISOString().slice(0, 10),
          recipientName: site?.businessContactName ?? null,
          recipientPhone: site?.businessContactPhone ?? null,
        };
      });
      return { id: String(w.id), workerName: w.workerName, phoneNumber: w.phoneNumber, agencies };
    });

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/worker-search]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
