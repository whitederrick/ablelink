// app/api/admin/leave/route.ts
// 연차 관리 목록(매니저) — 본 기관과 계약 이력이 있는 직무지도원별 연차 발생/사용/잔여 요약.
// 원장 상세·사용/조정 등록은 /api/admin/leave/[workerId].

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") || "").trim().toLowerCase();
    const page = Math.max(1, Number(sp.get("page") || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(sp.get("pageSize") || 10) || 10));

    // 연차 = 근로계약 단위 권리 → 계약 이력 있는 워커가 대상(후보 화면과 동일 모집단).
    const contracts = await prisma.employmentContract.findMany({
      where: { agencyId },
      orderBy: { contractStart: "asc" },
      select: { workerId: true, contractStart: true },
    });
    const hireByWorker = new Map<string, Date>(); // asc 정렬 첫 행 = 입사일(계속근로 기준, computeRun 정합)
    for (const c of contracts) {
      const k = c.workerId.toString();
      if (!hireByWorker.has(k)) hireByWorker.set(k, c.contractStart);
    }
    const workerIds = [...hireByWorker.keys()].map((s) => BigInt(s));
    if (workerIds.length === 0) return NextResponse.json({ success: true, items: [], total: 0 });

    const [workers, sums] = await Promise.all([
      prisma.worker.findMany({
        where: { id: { in: workerIds } },
        select: { id: true, workerName: true, loginId: true, phoneNumber: true, status: true },
      }),
      prisma.annualLeaveEntry.groupBy({
        by: ["workerId", "kind"],
        where: { agencyId, workerId: { in: workerIds } },
        _sum: { days: true },
      }),
    ]);
    const sumOf = new Map<string, Record<string, number>>();
    for (const s of sums) {
      const k = s.workerId.toString();
      const m = sumOf.get(k) ?? {};
      m[s.kind] = Number(s._sum.days ?? 0);
      sumOf.set(k, m);
    }

    let items = workers.map((w) => {
      const k = w.id.toString();
      const m = sumOf.get(k) ?? {};
      const accrued = (m.ACCRUAL_MONTHLY ?? 0) + (m.ACCRUAL_ANNUAL ?? 0) + Math.max(0, m.ADJUST ?? 0);
      const used = -(m.USE ?? 0);
      const expired = -(m.EXPIRE ?? 0);
      const paidOut = -(m.PAYOUT ?? 0);
      const balance = Object.values(m).reduce((t, v) => t + v, 0);
      return {
        workerId: k,
        workerName: w.workerName,
        loginId: w.loginId,
        phoneNumber: w.phoneNumber,
        workerStatus: String(w.status),
        hireDate: hireByWorker.get(k)!.toISOString().slice(0, 10),
        accrued: round2(accrued), used: round2(used), expired: round2(expired), paidOut: round2(paidOut),
        balance: round2(balance),
      };
    });
    if (q) items = items.filter((it) => it.workerName.toLowerCase().includes(q) || it.loginId.toLowerCase().includes(q));
    // 잔여 많은 순 → 이름(관리 우선순위: 정산 대상이 위로)
    items.sort((a, b) => b.balance - a.balance || a.workerName.localeCompare(b.workerName, "ko"));

    const total = items.length;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({ success: true, items: paged, total });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/leave GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
