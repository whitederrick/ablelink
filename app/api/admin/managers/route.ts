// app/api/admin/managers/route.ts
// 기관 담당자(AgencyManager) 목록 조회/검색/페이지네이션 + 생성 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { Prisma } from "@prisma/client";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toRow(r: any) {
  return {
    id: String(r.id),
    agencyId: String(r.agencyId),
    agencyName: r.agency?.name ?? null,
    name: r.name,
    email: r.email,
    phoneNumber: r.phoneNumber ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const page = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 20), 100);

    const where: Prisma.AgencyManagerWhereInput = {
      agencyId: scope.agencyId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phoneNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.agencyManager.count({ where }),
      prisma.agencyManager.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          agencyId: true,
          name: true,
          email: true,
          phoneNumber: true,
          agency: { select: { name: true } },
        },
      }),
    ]);

    return NextResponse.json({ success: true, page, pageSize, total, items: rows.map(toRow) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim();
    const phoneNumber = body?.phoneNumber == null ? null : String(body.phoneNumber).trim();

    if (!name) throw new Error("VALIDATION:name");
    if (!email) throw new Error("VALIDATION:email");

    const created = await prisma.agencyManager.create({
      data: {
        name,
        email,
        phoneNumber,
        agency: { connect: { id: scope.agencyId } },
      },
      select: {
        id: true,
        agencyId: true,
        name: true,
        email: true,
        phoneNumber: true,
        agency: { select: { name: true } },
      },
    });

    return NextResponse.json({ success: true, item: toRow(created) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
