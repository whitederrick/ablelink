// app/api/admin/contract-clauses/route.ts
// 에이전시별 근로계약서 특약 조항 마스터 — 목록/생성

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

// GET: 에이전시 특약 조항 목록(활성/비활성 모두)
export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const rows = await prisma.agencyContractClause.findMany({
      where: { agencyId: scope.agencyId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({
      success: true,
      items: rows.map(r => ({
        id: String(r.id),
        title: r.title,
        body: r.body,
        sortOrder: r.sortOrder,
        isActive: r.isActive,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message ?? "UNKNOWN";
    const status = errToStatus(msg);
    if (status === 500) console.error("[contract-clauses GET]", e);
    return NextResponse.json({ success: false, message: status === 500 ? "서버 오류" : msg }, { status });
  }
}

// POST: 특약 조항 생성
export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const planCheck = await checkAgencyPlanAccess(scope.agencyId, "CONTRACT_ONLINE");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
    }

    const body = await req.json();
    const title = (body.title ?? "").trim();
    const text = (body.body ?? "").trim();
    if (!title) throw new Error("VALIDATION:조항 제목을 입력하세요.");
    if (!text) throw new Error("VALIDATION:조항 내용을 입력하세요.");
    if (title.length > 100) throw new Error("VALIDATION:제목이 너무 깁니다.(100자 이내)");
    if (text.length > 2000) throw new Error("VALIDATION:내용이 너무 깁니다.(2000자 이내)");

    const count = await prisma.agencyContractClause.count({ where: { agencyId: scope.agencyId } });
    if (count >= 50) throw new Error("VALIDATION:특약 조항은 최대 50개까지 등록할 수 있습니다.");

    const created = await prisma.agencyContractClause.create({
      data: {
        agencyId: scope.agencyId,
        title,
        body: text,
        sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : count,
        isActive: body.isActive !== false,
      },
    });
    return NextResponse.json({
      success: true,
      id: String(created.id),
      item: {
        id: String(created.id),
        title: created.title,
        body: created.body,
        sortOrder: created.sortOrder,
        isActive: created.isActive,
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message ?? "UNKNOWN";
    const status = errToStatus(msg);
    if (status === 500) console.error("[contract-clauses POST]", e);
    return NextResponse.json({ success: false, message: status === 500 ? "서버 오류" : msg }, { status });
  }
}
