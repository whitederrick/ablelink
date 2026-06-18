// app/api/admin/support/[id]/attachment/route.ts
// 문의 첨부파일 다운로드 — 접근 권한(운영자 또는 본인 위탁기관 매니저) 검증 후
// 비공개 버킷의 signed URL로 302 리다이렉트. ?i=<첨부 인덱스>

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { normalizeAttachments, resolveSupportUrl } from "@/lib/supportStorage";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;
    const ticketId = parseBigInt(id);
    if (!ticketId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const ticket: any = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { agencyId: true, attachments: true, replyAttachments: true } as any,
    });
    if (!ticket) return NextResponse.json({ success: false, message: "티켓을 찾을 수 없습니다." }, { status: 404 });
    if (session.kind === "manager" && ticket.agencyId !== session.agencyId) {
      return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    }

    const sp = new URL(req.url).searchParams;
    const which = sp.get("which") === "reply" ? "reply" : "ticket";
    const idx = Number(sp.get("i"));
    const list = normalizeAttachments(which === "reply" ? ticket.replyAttachments : ticket.attachments);
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) {
      return NextResponse.json({ success: false, message: "첨부파일을 찾을 수 없습니다." }, { status: 404 });
    }

    const url = await resolveSupportUrl(list[idx].path);
    if (!url) return NextResponse.json({ success: false, message: "첨부파일을 불러올 수 없습니다." }, { status: 500 });
    return NextResponse.redirect(url);
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/support/attachment]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
