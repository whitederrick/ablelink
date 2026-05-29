// app/api/admin/managers/[id]/route.ts
// 기관 담당자(AgencyManager) 개별 조회/수정/삭제

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const mgr = await prisma.agencyManager.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, agencyId: true, name: true, email: true, phoneNumber: true, agency: { select: { name: true } } },
    });
    if (!mgr) throw new Error("NOT_FOUND");
    if (mgr.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");
    return NextResponse.json({ success: true, item: toRow(mgr) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;

    const existing = await prisma.agencyManager.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, agencyId: true },
    });
    if (!existing) throw new Error("NOT_FOUND");
    if (existing.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");

    const body = await req.json();
    const data: any = {};
    if (body.name != null) data.name = String(body.name).trim();
    if (body.email != null) data.email = String(body.email).trim();
    if (body.phoneNumber !== undefined) data.phoneNumber = body.phoneNumber ? String(body.phoneNumber).trim() : null;

    const updated = await prisma.agencyManager.update({
      where: { id: BigInt(id) },
      data,
      select: { id: true, agencyId: true, name: true, email: true, phoneNumber: true, agency: { select: { name: true } } },
    });

    return NextResponse.json({ success: true, item: toRow(updated) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;

    const existing = await prisma.agencyManager.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, agencyId: true },
    });
    if (!existing) throw new Error("NOT_FOUND");
    if (existing.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");

    await prisma.agencyManager.delete({ where: { id: BigInt(id) } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
