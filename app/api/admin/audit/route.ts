// 시스템 운영자 전용: 감사 이벤트(AuditEvent) 조회 — 읽기 전용
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

const ACTOR_TYPES = ["ADMIN", "MANAGER", "WORKER", "SYSTEM"] as const;
const PAGE_SIZES = [10, 20, 50];

function toDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const rawSize = parseInt(searchParams.get("pageSize") ?? "20", 10) || 20;
    const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : 20;

    const actorType = searchParams.get("actorType")?.trim() ?? "";
    const entityType = searchParams.get("entityType")?.trim() ?? "";
    const action = searchParams.get("action")?.trim() ?? "";
    const agencyId = searchParams.get("agencyId")?.trim() ?? "";
    const q = searchParams.get("q")?.trim() ?? "";
    const from = toDate(searchParams.get("from"));
    const to = toDate(searchParams.get("to"));

    const where: Prisma.AuditEventWhereInput = {};
    if (actorType && (ACTOR_TYPES as readonly string[]).includes(actorType)) {
      where.actorType = actorType as (typeof ACTOR_TYPES)[number];
    }
    if (entityType) where.entityType = { contains: entityType };
    if (action) where.action = action;
    if (agencyId && /^\d+$/.test(agencyId)) {
      try { where.agencyId = BigInt(agencyId); } catch { /* ignore */ }
    }
    if (q) {
      where.OR = [
        { actorLabel: { contains: q } },
        { entityType: { contains: q } },
        { entityId: { contains: q } },
      ];
    }
    if (from || to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (from) createdAt.gte = from;
      if (to) {
        // to는 해당 날짜의 끝까지 포함(23:59:59.999)
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }

    const [items, total, entityTypesRaw, actionsRaw] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({ select: { entityType: true }, distinct: ["entityType"], orderBy: { entityType: "asc" }, take: 200 }),
      prisma.auditEvent.findMany({ select: { action: true }, distinct: ["action"], orderBy: { action: "asc" }, take: 100 }),
    ]);

    return NextResponse.json({
      success: true,
      total,
      page,
      pageSize,
      entityTypeOptions: entityTypesRaw.map(e => e.entityType).filter(Boolean),
      actionOptions: actionsRaw.map(a => a.action).filter(Boolean),
      items: items.map(e => ({
        id: e.id.toString(),
        agencyId: e.agencyId?.toString() ?? null,
        actorType: e.actorType,
        actorId: e.actorId?.toString() ?? null,
        actorLabel: e.actorLabel ?? null,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        action: e.action,
        summary: e.summary ?? null,
        payload: e.payload ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
