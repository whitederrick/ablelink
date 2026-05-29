// 지원 요청 채널
// GET  — ADMIN: 전체 목록 | MANAGER: 자기 에이전시 목록
// POST — MANAGER 전용: 티켓 생성
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { requireManagerSession } from "@/lib/managerScope";

const VALID_CATEGORIES = ["GENERAL", "DATA_FIX", "BILLING", "OTHER"];

function ticketToJson(t: any) {
  return {
    id:           t.id.toString(),
    agencyId:     t.agencyId.toString(),
    agencyName:   t.agency?.name ?? null,
    managerLogin: t.manager?.loginId ?? null,
    category:     t.category,
    title:        t.title,
    body:         t.body,
    status:       t.status,
    reply:        t.reply ?? null,
    replierLogin: t.replier?.loginId ?? null,
    repliedAt:    t.repliedAt?.toISOString() ?? null,
    createdAt:    t.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "";

    const where: any = {};
    if (status && ["OPEN","REPLIED","CLOSED"].includes(status)) where.status = status;
    // MANAGER는 자기 에이전시 티켓만, ADMIN은 전체
    if (session.kind === "manager") where.agencyId = session.agencyId;

    const tickets = await prisma.supportTicket.findMany({
      where,
      include: {
        agency:   { select: { name: true } },
        manager:  { select: { loginId: true } },
        replier:  { select: { loginId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ success: true, tickets: tickets.map(ticketToJson) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { title, body, category = "GENERAL" } = await req.json();
    if (!title?.trim() || !body?.trim())
      return NextResponse.json({ success: false, message: "제목과 내용은 필수입니다." }, { status: 400 });

    const cat = VALID_CATEGORIES.includes(category) ? category : "GENERAL";

    const ticket = await prisma.supportTicket.create({
      data: {
        agencyId:  scope.agencyId,
        managerId: scope.managerId,
        title:     title.trim(),
        body:      body.trim(),
        category:  cat,
      },
    });

    return NextResponse.json({ success: true, id: ticket.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
