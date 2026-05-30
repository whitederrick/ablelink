// app/api/admin/assignments/route.ts
// SiteAssignment 생성/조회(간단 list) API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function toItem(r: any) {
  return {
    id: String(r.id),
    workerId: String(r.workerId),
    siteId: String(r.siteId),
    status: r.status,
    startDate: r.startDate?.toISOString?.() ?? r.startDate ?? null,
    endDate: r.endDate?.toISOString?.() ?? r.endDate ?? null,
    assignedAt: r.assignedAt?.toISOString?.() ?? r.assignedAt ?? null,
    confirmedAt: r.confirmedAt?.toISOString?.() ?? r.confirmedAt ?? null,
    rejectedAt: r.rejectedAt?.toISOString?.() ?? r.rejectedAt ?? null,
    droppedAt: r.droppedAt?.toISOString?.() ?? r.droppedAt ?? null,
    endedAt: r.endedAt?.toISOString?.() ?? r.endedAt ?? null,
    statusReason: r.statusReason ?? null,
    assignedByManagerId: r.assignedByManagerId != null ? String(r.assignedByManagerId) : null,
    workType: r.workType ?? "FULL_DAY",
    commuteGuidanceIncluded: r.commuteGuidanceIncluded ?? true,
    customWorkStart: r.customWorkStart ?? null,
    customWorkEnd: r.customWorkEnd ?? null,
    site: r.site
      ? {
          id: String(r.site.id),
          companyName: r.site.companyName,
          address: r.site.address,
          agencyId: r.site.agencyId != null ? String(r.site.agencyId) : null,
        }
      : null,
    user: r.user
      ? {
          id: String(r.user.id),
          workerName: r.user.workerName,
          loginId: r.user.loginId,
          phoneNumber: r.user.phoneNumber,
          role: r.user.role,
          status: r.user.status,
        }
      : null,
  };
}

// GET: 간단 조회(필요 최소)
// - 필터: siteId, workerId, status
export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { searchParams } = new URL(req.url);
    const siteIdStr = (searchParams.get("siteId") || "").trim();
    const userIdStr = (searchParams.get("workerId") || "").trim();
    const status = (searchParams.get("status") || "").trim();

    const where: any = {};
    if (siteIdStr) {
      if (!isValidNumericId(siteIdStr)) throw new Error("VALIDATION:siteId");
      where.siteId = BigInt(siteIdStr);
    }
    if (userIdStr) {
      if (!isValidNumericId(userIdStr)) throw new Error("VALIDATION:workerId");
      where.workerId = BigInt(userIdStr);
    }
    if (status) where.status = status;

    // 해당 agency의 site에 속한 assignment만
    where.site = { agencyId: scope.agencyId };

    const rows = await prisma.siteAssignment.findMany({
      where,
      orderBy: { id: "desc" },
      take: 50,
      select: {
        id: true,
        workerId: true,
        siteId: true,
        status: true,
        startDate: true,
        endDate: true,
        assignedAt: true,
        confirmedAt: true,
        rejectedAt: true,
        droppedAt: true,
        endedAt: true,
        statusReason: true,
        assignedByManagerId: true,
        site: { select: { id: true, companyName: true, address: true, agencyId: true } },
        user: {
          select: { id: true, workerName: true, loginId: true, phoneNumber: true, role: true, status: true },
        },
        workType: true,
        commuteGuidanceIncluded: true,
        customWorkStart: true,
        customWorkEnd: true,
      },
    });

    return NextResponse.json({ success: true, items: rows.map(toItem) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

// POST: 배정 생성 (ASSIGNED)
// body: { siteId, workerId, isMainWorker?, memo? }
export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const body = await req.json();
    const siteIdStr = String(body.siteId ?? "").trim();
    const userIdStr = String(body.workerId ?? "").trim();

    if (!isValidNumericId(siteIdStr)) throw new Error("VALIDATION:siteId");
    if (!isValidNumericId(userIdStr)) throw new Error("VALIDATION:workerId");

    const siteId = BigInt(siteIdStr);
    const workerId = BigInt(userIdStr);

    // 배정하려는 site가 내 agency 소속인지 검증
    const myAgencyId = scope.agencyId;
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { agencyId: true, isActive: true },
    });
    if (!site) throw new Error("NOT_FOUND");
    if (!site.isActive) throw new Error("VALIDATION:siteInactive");
    if (site.agencyId == null) throw new Error("FORBIDDEN");
    if (site.agencyId !== myAgencyId) throw new Error("FORBIDDEN");

    // 배정 대상 user 존재 확인
    const user = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { status: true },
    });
    if (!user) throw new Error("NOT_FOUND");
    if (String(user.status) !== "ACTIVE") throw new Error("VALIDATION:userInactive");

    // 동일 site/user에 “활성 배정”이 이미 있으면 중복 방지(정책)
    const dup = await prisma.siteAssignment.findFirst({
      where: { siteId, workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
      select: { id: true },
    });
    if (dup) throw new Error("VALIDATION:alreadyAssigned");

    const isMainWorker = body.isMainWorker === false ? false : true;
    const memo = body.memo != null ? String(body.memo).trim() : null;

    // 근무형태
    const rawWorkType = body.workType != null ? String(body.workType).trim() : null;
    const validWorkTypes = ["AM", "PM", "FULL_DAY", "CUSTOM"];
    const workType = validWorkTypes.includes(rawWorkType ?? "") ? rawWorkType : "FULL_DAY";
    // FULL_DAY는 법적 8시간 제한으로 출퇴근 지도 불가
    const commuteGuidanceIncluded = workType === "FULL_DAY" ? false : (body.commuteGuidanceIncluded !== false);
    const customWorkStart = workType === "CUSTOM" ? (body.customWorkStart ?? null) : null;
    const customWorkEnd   = workType === "CUSTOM" ? (body.customWorkEnd ?? null) : null;

    const assignedByManagerId = scope.managerId;

    const created = await prisma.siteAssignment.create({
      data: {
        siteId,
        workerId,
        agencyId: scope.agencyId, // 에이전시 스코프 쿼리(급여·CSV·근태inbox·휴무)에서 누락 방지
        status: "ASSIGNED",
        isMainWorker,
        assignedAt: new Date(),
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        endDate: body.endDate ? new Date(body.endDate) : null,
        assignedByManagerId,
        statusReason: memo,
        workType,
        commuteGuidanceIncluded,
        customWorkStart,
        customWorkEnd,
      },
      select: {
        id: true,
        workerId: true,
        siteId: true,
        status: true,
        startDate: true,
        endDate: true,
        assignedAt: true,
        confirmedAt: true,
        rejectedAt: true,
        droppedAt: true,
        endedAt: true,
        statusReason: true,
        assignedByManagerId: true,
        site: { select: { id: true, companyName: true, address: true, agencyId: true } },
        user: {
          select: { id: true, workerName: true, loginId: true, phoneNumber: true, role: true, status: true },
        },
      },
    });

    return NextResponse.json({ success: true, item: toItem(created) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
