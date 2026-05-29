// 지원 요청 채널
// GET  — ADMIN: 전체 목록 | AGENCY: 자기 에이전시 목록
// POST — AGENCY: 티켓 생성
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";

const VALID_CATEGORIES = ["GENERAL", "DATA_FIX", "BILLING", "OTHER"];

function ticketToJson(t: any) {
  return {
    id:          t.id.toString(),
    agencyId:    t.agencyId.toString(),
    agencyName:  t.agency?.name ?? null,
    adminLogin:  t.admin?.loginId ?? null,
    category:    t.category,
    title:       t.title,
    body:        t.body,
    status:      t.status,
    reply:       t.reply ?? null,
    replierLogin:t.replier?.loginId ?? null,
    repliedAt:   t.repliedAt?.toISOString() ?? null,
    createdAt:   t.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "";

    const where: any = {};
    if (status && ["OPEN","REPLIED","CLOSED"].includes(status)) where.status = status;
    if (scope.role === "AGENCY") where.agencyId = requireAgencyScope(scope);

    const tickets = await prisma.supportTicket.findMany({
      where,
      include: {
        agency:  { select: { name: true } },
        admin:   { select: { loginId: true } },
        replier: { select: { loginId: true } },
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
    const scope = await requireAdminSession(req);
    if (scope.role !== "AGENCY") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    const agencyId = requireAgencyScope(scope);

    const { title, body, category = "GENERAL" } = await req.json();
    if (!title?.trim() || !body?.trim())
      return NextResponse.json({ success: false, message: "제목과 내용은 필수입니다." }, { status: 400 });

    const cat = VALID_CATEGORIES.includes(category) ? category : "GENERAL";

    const ticket = await prisma.supportTicket.create({
      data: {
        agencyId,
        adminId: scope.userId,
        title:   title.trim(),
        body:    body.trim(),
        category: cat,
      },
    });

    return NextResponse.json({ success: true, id: ticket.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
