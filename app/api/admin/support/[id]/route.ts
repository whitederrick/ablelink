// 지원 요청 상세 조회 + 회신
// GET   — ADMIN / MANAGER(본인 에이전시만)
// PATCH — ADMIN: reply | MANAGER: close(본인 티켓)
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session  = await requireAdminOrManagerSession(req);
    const { id }   = await params;
    const ticketId = parseBigInt(id);
    if (!ticketId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        agency:  { select: { name: true } },
        manager: { select: { loginId: true, displayName: true } },
        replier: { select: { loginId: true, displayName: true } },
      },
    });

    if (!ticket) return NextResponse.json({ success: false, message: "티켓을 찾을 수 없습니다." }, { status: 404 });

    if (session.kind === "manager" && ticket.agencyId !== session.agencyId)
      return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    return NextResponse.json({
      success: true,
      ticket: {
        id:           ticket.id.toString(),
        agencyId:     ticket.agencyId.toString(),
        agencyName:   ticket.agency?.name ?? null,
        managerLogin: ticket.manager?.loginId ?? null,
        managerName:  ticket.manager?.displayName ?? null,
        category:     ticket.category,
        title:        ticket.title,
        body:         ticket.body,
        status:       ticket.status,
        reply:        ticket.reply ?? null,
        replierLogin: ticket.replier?.loginId ?? null,
        repliedAt:    ticket.repliedAt?.toISOString() ?? null,
        createdAt:    ticket.createdAt.toISOString(),
        updatedAt:    ticket.updatedAt.toISOString(),
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session  = await requireAdminOrManagerSession(req);
    const { id }   = await params;
    const ticketId = parseBigInt(id);
    if (!ticketId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return NextResponse.json({ success: false, message: "티켓을 찾을 수 없습니다." }, { status: 404 });

    const body = await req.json();

    // ADMIN: 회신
    if (session.kind === "admin") {
      const { reply } = body;
      if (!reply?.trim())
        return NextResponse.json({ success: false, message: "회신 내용을 입력해주세요." }, { status: 400 });

      const updated = await prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          reply:     reply.trim(),
          status:    "REPLIED",
          repliedBy: session.adminId,
          repliedAt: new Date(),
        },
      });
      return NextResponse.json({ success: true, id: updated.id.toString() });
    }

    // MANAGER: 티켓 종료
    if (ticket.agencyId !== session.agencyId)
      return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const { action } = body;
    if (action !== "close")
      return NextResponse.json({ success: false, message: "지원하지 않는 액션입니다." }, { status: 400 });

    await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: "CLOSED" } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
