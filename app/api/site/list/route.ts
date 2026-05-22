// app/api/admin/site/list/route.ts
// 관리자 사이트 목록 조회/검색/페이지네이션 API

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

type AdminSession = {
  sub: string;
  role: "ADMIN" | "GOV" | "AGENCY";
  loginId: string;
  agencyName?: string | null;
};

const COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE || "admlink_admin_session";

function getSecretKey() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

async function getSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const role = (payload as any)?.role;
    const sub = (payload as any)?.sub;
    const loginId = (payload as any)?.loginId;

    if (!role || !sub || !loginId) return null;
    if (!["ADMIN", "GOV", "AGENCY"].includes(String(role))) return null;

    return {
      sub: String(sub),
      role: role as AdminSession["role"],
      loginId: String(loginId),
      agencyName: (payload as any)?.agencyName ?? null,
    };
  } catch {
    return null;
  }
}

function toInt(v: string | null, def: number) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.floor(n);
}

function safeIso(v: any): string | null {
  if (!v) return null;
  try {
    return new Date(v).toISOString();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    // AGENCY는 agencyName이 필수(데이터 누수 방지)
    if (session.role === "AGENCY" && !session.agencyName) {
      return NextResponse.json(
        { success: false, message: "Forbidden: agencyName is required for AGENCY role" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const page = toInt(searchParams.get("page"), 1);
    const pageSize = Math.min(100, toInt(searchParams.get("pageSize"), 20));
    const skip = (page - 1) * pageSize;

    const where: any = { isActive: true };

    if (session.role === "AGENCY" && session.agencyName) {
      where.agencyName = session.agencyName;
    }

    if (q) {
      where.OR = [
        { companyName: { contains: q, mode: "insensitive" } },
        { address: { contains: q, mode: "insensitive" } },
        { detailAddress: { contains: q, mode: "insensitive" } },
        { agencyName: { contains: q, mode: "insensitive" } },
        { managerName: { contains: q, mode: "insensitive" } },
        { managerEmail: { contains: q, mode: "insensitive" } },
        { managerPhone: { contains: q, mode: "insensitive" } },
      ];
    }

    const siteModel: any = (prisma as any).site;

    const [total, rows] = await Promise.all([
      siteModel.count({ where }),
      siteModel.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          companyName: true,
          address: true,
          detailAddress: true,

          agencyName: true,
          managerName: true,
          managerEmail: true,
          managerPhone: true,

          basePointConfirmed: true,
          basePointAuthority: true,
          basePointApprovalStatus: true,
          basePointUpdatedAt: true,

          noPreTraining: true,
          noFieldTraining: true,
          preTrainingStart: true,
          preTrainingEnd: true,
          fieldTrainingStart: true,
          fieldTrainingEnd: true,

          createdAt: true,
          isActive: true,
          siteSourceType: true,
        },
      }),
    ]);

    const items = (rows || []).map((r: any) => ({
      id: String(r.id),
      companyName: r.companyName ?? "",
      address: r.address ?? "",
      detailAddress: r.detailAddress ?? null,

      agencyName: r.agencyName ?? null,
      managerName: r.managerName ?? null,
      managerEmail: typeof r.managerEmail === "string" ? r.managerEmail.trim() : (r.managerEmail ?? null),
      managerPhone: typeof r.managerPhone === "string" ? r.managerPhone.trim() : (r.managerPhone ?? null),

      basePointConfirmed: Boolean(r.basePointConfirmed),
      basePointAuthority: String(r.basePointAuthority ?? ""),
      basePointApprovalStatus: String(r.basePointApprovalStatus ?? ""),
      basePointUpdatedAt: safeIso(r.basePointUpdatedAt),

      noPreTraining: Boolean(r.noPreTraining),
      noFieldTraining: Boolean(r.noFieldTraining),
      preTrainingStart: safeIso(r.preTrainingStart),
      preTrainingEnd: safeIso(r.preTrainingEnd),
      fieldTrainingStart: safeIso(r.fieldTrainingStart),
      fieldTrainingEnd: safeIso(r.fieldTrainingEnd),

      createdAt: safeIso(r.createdAt) ?? new Date().toISOString(),
      isActive: Boolean(r.isActive),
      siteSourceType: r.siteSourceType ?? null,
    }));

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total: Number(total || 0),
      items,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
