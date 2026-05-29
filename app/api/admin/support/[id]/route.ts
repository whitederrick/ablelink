// 지원 요청 상세 조회 + 운영자 회신
// GET   — ADMIN / AGENCY(본인 에이전시만)
// PATCH — ADMIN: reply / AGENCY: close(본인 티켓)
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope, parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { id } = await params;
    const ticketId = parseBigInt(id);
    if (!ticketId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        agency:  { select: { name: true } },
        admin:   { select: { loginId: true, displayName: true } },
        replier: { select: { loginId: true, displayName: true } },
      },
    });

    if (!ticket) return NextResponse.json({ success: false, message: "티켓을 찾을 수 없습니다." }, { status: 404 });

    if (scope.role === "AGENCY") {
      const agencyId = requireAgencyScope(scope);
      if (ticket.agencyId !== agencyId)
        return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      ticket: {
        id:           ticket.id.toString(),
        agencyId:     ticket.agencyId.toString(),
        agencyName:   ticket.agency?.name ?? null,
        adminLogin:   ticket.admin?.loginId ?? null,
        adminName:    ticket.admin?.displayName ?? null,
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
    const scope = await requireAdminSession(req);
    const { id } = await params;
    const ticketId = parseBigInt(id);
    if (!ticketId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return NextResponse.json({ success: false, message: "티켓을 찾을 수 없습니다." }, { status: 404 });

    const body = await req.json();

    // ADMIN: 회신
    if (scope.role === "ADMIN") {
      const { reply } = body;
      if (!reply?.trim())
        return NextResponse.json({ success: false, message: "회신 내용을 입력해주세요." }, { status: 400 });

      const updated = await prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          reply:     reply.trim(),
          status:    "REPLIED",
          repliedBy: scope.userId,
          repliedAt: new Date(),
        },
      });

      // 에이전시 관리자에게 알림 (WorkerNotice 불가 — AdminUser 대상이므로 별도 처리 없음)
      // 향후: AdminNotice 모델 도입 시 추가

      return NextResponse.json({ success: true, id: updated.id.toString() });
    }

    // AGENCY: 티켓 닫기
    if (scope.role === "AGENCY") {
      const agencyId = requireAgencyScope(scope);
      if (ticket.agencyId !== agencyId)
        return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

      const { action } = body;
      if (action !== "close")
        return NextResponse.json({ success: false, message: "지원하지 않는 액션입니다." }, { status: 400 });

      await prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: "CLOSED" },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
