// app/api/admin/managers/route.ts
// 기관 담당자(AgencyManager) 목록 조회/검색/페이지네이션 + 생성 API
//
// ✅ 중요: 이 경로는 동적 라우트가 아니므로 params 컨텍스트를 받으면 안 됩니다.
// export async function GET(req: NextRequest) 형태만 허용됩니다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAdminSessionFromRequest } from "@/lib/adminCookies";
import { Prisma } from "@prisma/client";

type AdminSession = {
  sub: string; // adminUserId
  role: "ADMIN" | "GOV" | "AGENCY";
  loginId: string;
  agencyName?: string | null;
};

async function getSessionOrThrow(req: Request): Promise<AdminSession> {
  const s = await readAdminSessionFromRequest(req);
  if (!s) throw new Error("UNAUTHORIZED");
  return {
    sub: String(s.sub),
    role: s.role,
    loginId: s.loginId,
    agencyName: s.agencyName ?? null,
  };
}

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

function isValidNumericId(id: string) {
  return /^\d+$/.test(id);
}

async function resolveAgencyIdByNameOrThrow(agencyName: string): Promise<bigint> {
  const a = await prisma.agency.findUnique({
    where: { name: agencyName },
    select: { id: true },
  });
  if (!a) throw new Error("VALIDATION:agencyName");
  return a.id;
}

function toRow(r: any) {
  return {
    id: String(r.id),
    agencyId: String(r.agencyId),
    agencyName: r.agency?.name ?? null,
    name: r.name,
    email: r.email, // schema상 필수
    phoneNumber: r.phoneNumber ?? null,
  };
}

// ✅ GET: 목록/검색/페이지네이션
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionOrThrow(req);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const page = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 20), 100);

    let agencyId: bigint | undefined;

    // AGENCY는 토큰 agencyName으로 강제 스코프
    if (session.role === "AGENCY") {
      if (!session.agencyName) throw new Error("FORBIDDEN");
      agencyId = await resolveAgencyIdByNameOrThrow(session.agencyName);
    } else {
      // ADMIN/GOV는 agencyId 또는 agencyName 필터 가능
      const agencyIdParam = (searchParams.get("agencyId") || "").trim();
      const agencyNameParam = (searchParams.get("agencyName") || "").trim();

      if (agencyIdParam) {
        if (!isValidNumericId(agencyIdParam)) throw new Error("VALIDATION:agencyId");
        agencyId = BigInt(agencyIdParam);
      } else if (agencyNameParam) {
        agencyId = await resolveAgencyIdByNameOrThrow(agencyNameParam);
      }
    }

    const where: Prisma.AgencyManagerWhereInput = {
      ...(agencyId ? { agencyId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phoneNumber: { contains: q, mode: "insensitive" } },
              { agency: { is: { name: { contains: q, mode: "insensitive" } } } },
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

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      items: rows.map(toRow),
    });
  } catch (e: any) {
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

// ✅ POST: 생성
// body: { agencyId? | agencyName?, name, email, phoneNumber? }
// - AGENCY는 agencyId/agencyName을 무시하고 토큰의 agencyName으로 강제
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionOrThrow(req);
    if (session.role !== "AGENCY" && session.role !== "ADMIN") throw new Error("FORBIDDEN");

    const body = await req.json();

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim();
    const phoneNumber = body?.phoneNumber == null ? null : String(body.phoneNumber).trim();

    if (!name) throw new Error("VALIDATION:name");
    if (!email) throw new Error("VALIDATION:email");

    let agencyId: bigint;

    if (session.role === "AGENCY") {
      if (!session.agencyName) throw new Error("FORBIDDEN");
      agencyId = await resolveAgencyIdByNameOrThrow(session.agencyName);
    } else {
      const agencyIdStr = String(body?.agencyId ?? "").trim();
      const agencyName = String(body?.agencyName ?? "").trim();

      if (agencyIdStr) {
        if (!isValidNumericId(agencyIdStr)) throw new Error("VALIDATION:agencyId");
        agencyId = BigInt(agencyIdStr);
      } else if (agencyName) {
        agencyId = await resolveAgencyIdByNameOrThrow(agencyName);
      } else {
        throw new Error("VALIDATION:agencyId");
      }
    }

    const created = await prisma.agencyManager.create({
      data: {
        name,
        email,
        phoneNumber,
        agency: { connect: { id: agencyId } }, // ✅ 스칼라 agencyId 직접 대입 대신 relation connect
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
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
