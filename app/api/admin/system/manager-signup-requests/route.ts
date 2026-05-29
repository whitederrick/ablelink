// app/api/admin/system/manager-signup-requests/route.ts
// 시스템 운영자 전용: 관리자 가입 신청 목록 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { Prisma, ManagerSignupStatus } from "@prisma/client";

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toRow(r: any) {
  return {
    id:                 String(r.id),
    agencyName:         r.agencyName,
    businessNumber:     r.businessNumber,
    businessNumberType: r.businessNumberType,
    loginId:            r.loginId,
    displayName:        r.displayName ?? null,
    phoneNumber:        r.phoneNumber ?? null,
    documentUrl:        r.documentUrl ?? null,
    status:             r.status,
    ntsVerified:        r.ntsVerified,
    ntsBusinessName:    r.ntsBusinessName ?? null,
    reviewNote:         r.reviewNote ?? null,
    reviewedAt:         r.reviewedAt?.toISOString() ?? null,
    agencyId:           r.agencyId != null ? String(r.agencyId) : null,
    managerId:          r.managerId != null ? String(r.managerId) : null,
    createdAt:          r.createdAt.toISOString(),
    updatedAt:          r.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const page     = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 20), 100);

    const where: Prisma.ManagerSignupRequestWhereInput = {};
    if (statusParam && ["PENDING", "APPROVED", "REJECTED"].includes(statusParam)) {
      where.status = statusParam as ManagerSignupStatus;
    }

    const [total, items] = await Promise.all([
      prisma.managerSignupRequest.count({ where }),
      prisma.managerSignupRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id:                 true,
          agencyName:         true,
          businessNumber:     true,
          businessNumberType: true,
          loginId:            true,
          displayName:        true,
          phoneNumber:        true,
          documentUrl:        true,
          status:             true,
          ntsVerified:        true,
          ntsBusinessName:    true,
          reviewNote:         true,
          reviewedAt:         true,
          agencyId:           true,
          managerId:          true,
          createdAt:          true,
          updatedAt:          true,
        },
      }),
    ]);

    return NextResponse.json({
      success:  true,
      page,
      pageSize,
      total,
      items:    items.map(toRow),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/manager-signup-requests GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
