// app/api/admin/contract-clauses/[id]/route.ts
// 특약 조항 수정/삭제

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

async function loadOwned(agencyId: bigint, idStr: string) {
  let id: bigint;
  try { id = BigInt(idStr); } catch { throw new Error("VALIDATION:잘못된 ID입니다."); }
  const row = await prisma.agencyContractClause.findUnique({ where: { id } });
  if (!row || row.agencyId !== agencyId) throw new Error("NOT_FOUND");
  return row;
}

// PATCH: 수정 (title/body/sortOrder/isActive)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const existing = await loadOwned(scope.agencyId, id);

    const body = await req.json();
    const data: any = {};
    if (typeof body.title === "string") {
      const t = body.title.trim();
      if (!t) throw new Error("VALIDATION:제목을 입력하세요.");
      if (t.length > 100) throw new Error("VALIDATION:제목이 너무 깁니다.");
      data.title = t;
    }
    if (typeof body.body === "string") {
      const b = body.body.trim();
      if (!b) throw new Error("VALIDATION:내용을 입력하세요.");
      if (b.length > 2000) throw new Error("VALIDATION:내용이 너무 깁니다.");
      data.body = b;
    }
    if (Number.isInteger(body.sortOrder)) data.sortOrder = body.sortOrder;
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;

    await prisma.agencyContractClause.update({ where: { id: existing.id }, data });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message ?? "UNKNOWN";
    const status = errToStatus(msg);
    if (status === 500) console.error("[contract-clauses PATCH]", e);
    return NextResponse.json({ success: false, message: status === 500 ? "서버 오류" : msg }, { status });
  }
}

// DELETE: 삭제 (스냅샷은 계약서에 보존되므로 하드 삭제 안전)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const existing = await loadOwned(scope.agencyId, id);
    await prisma.agencyContractClause.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message ?? "UNKNOWN";
    const status = errToStatus(msg);
    if (status === 500) console.error("[contract-clauses DELETE]", e);
    return NextResponse.json({ success: false, message: status === 500 ? "서버 오류" : msg }, { status });
  }
}
