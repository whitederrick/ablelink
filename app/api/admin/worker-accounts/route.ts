// app/api/admin/worker-accounts/route.ts
// 직무지도원 관리(인적 관리) 목록 — 본 위탁기관와 현재/과거 계약(배정) 이력이 있는 직무지도원.
// 배정 관리(/api/admin/workers)와 달리 '활성 배정'으로 한정하지 않고 과거 이력자까지 포함한다.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { AssignStatus, WorkerRole, Prisma } from "@prisma/client";
import { CONSENTED_ASSIGN_STATUSES } from "@/lib/worker/agencyScope";

// '진행 중' 판정 기준 — 현재 유효한 배정 상태(미종료 계약/배정)
const ACTIVE_ASSIGN: AssignStatus[] = [AssignStatus.ACTIVE, AssignStatus.ASSIGNED, AssignStatus.CONFIRMED];

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const page = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 10), 100);
    const engagement = (searchParams.get("engagement") || "all").trim(); // all | active | ended

    // 본 위탁기관 현장에 '수락/근무한' 배정 이력이 있는 직무지도원(현재/과거 무관).
    // ★16차: status 필터(CONSENTED) 필수 — 없으면 매니저가 전화로 보낸 미동의 REQUESTED나 거절(REJECTED)·
    //  만료(EXPIRED)행만 있어도 미소속 워커가 목록에 노출돼 계정 메타(loginId·전화·hasBankAccount·lastLoginAt)가
    //  샌다(worker-accounts/[id] 상세는 workerBelongsToAgency로 이미 403). 상세와 동일 불변식으로 통일.
    const siteScope: Prisma.SiteAssignmentWhereInput = { site: { agencyId } };
    const consented: Prisma.SiteAssignmentWhereInput = { site: { agencyId }, status: { in: [...CONSENTED_ASSIGN_STATUSES] } };
    let assignmentsFilter: Prisma.WorkerWhereInput["assignments"];
    if (engagement === "active") {
      assignmentsFilter = { some: { ...siteScope, status: { in: ACTIVE_ASSIGN } } };
    } else if (engagement === "ended") {
      // 소속(수락/근무한 이력)은 있으나(some) 현재 유효한 배정이 없는(none) 자 = 계약 종료
      assignmentsFilter = { some: consented, none: { ...siteScope, status: { in: ACTIVE_ASSIGN } } };
    } else {
      assignmentsFilter = { some: consented };
    }

    const where: Prisma.WorkerWhereInput = {
      role: WorkerRole.WORKER,
      assignments: assignmentsFilter,
      ...(q
        ? {
            OR: [
              { workerName: { contains: q, mode: "insensitive" } },
              { loginId: { contains: q, mode: "insensitive" } },
              { phoneNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.worker.count({ where }),
      prisma.worker.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          loginId: true,
          workerName: true,
          phoneNumber: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          bankName: true,
          accountNumber: true,
          // 진행 중 판정용 — 본 위탁기관 배정의 상태만
          assignments: { where: siteScope, select: { status: true } },
        },
      }),
    ]);

    // 활동(휴면) 판정: 진행 중 배정·계약 보유 OR 최근 3개월 내 로그인 = 활성, 아니면 휴면(자동, 로그인 시 자동 활성)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      items: rows.map((w) => {
        const hasActive = w.assignments.some((a) => ACTIVE_ASSIGN.includes(a.status));
        const recentLogin = !!w.lastLoginAt && w.lastLoginAt >= threeMonthsAgo;
        return {
          id: String(w.id),
          loginId: w.loginId,
          workerName: w.workerName,
          phoneNumber: w.phoneNumber,
          status: String(w.status),
          createdAt: w.createdAt.toISOString(),
          lastLoginAt: w.lastLoginAt ? w.lastLoginAt.toISOString() : null,
          hasBankAccount: !!(w.bankName && w.accountNumber),
          engagement: hasActive ? "ACTIVE" : "ENDED", // 진행 중 | 종료
          activity: hasActive || recentLogin ? "ACTIVE" : "DORMANT", // 활성 | 휴면(자동)
        };
      }),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    const st = errToStatus(msg);
    if (st === 500) console.error("[worker-accounts GET]", e);
    return NextResponse.json({ success: false, message: st === 500 ? "서버 오류" : msg }, { status: st });
  }
}
