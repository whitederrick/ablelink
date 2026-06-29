// app/api/admin/review/remind/route.ts
// 월별 진척도 — 운영자(또는 매니저)가 해당 위탁기관 담당자에게 마감 독려 알림(ManagerNotice) 발송.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const body = await req.json().catch(() => ({}));

    const agencyId = parseBigInt(body?.agencyId);
    if (!agencyId) return NextResponse.json({ success: false, message: "agencyId가 필요합니다." }, { status: 400 });
    if (session.kind === "manager" && agencyId !== session.agencyId) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const yearMonth = String(body?.yearMonth ?? "").trim();
    const message = String(body?.message ?? "").trim();

    const managers = await prisma.manager.findMany({
      where: { agencyId, isActive: true },
      select: { id: true },
    });
    if (managers.length === 0) {
      return NextResponse.json({ success: false, message: "해당 위탁기관에 활성 담당자가 없습니다." }, { status: 404 });
    }

    const title = `[마감 독려]${yearMonth ? ` ${yearMonth}` : ""} 종료 직무지도원 서류 확인 요청`;
    const defaultBody =
      `${yearMonth ? `${yearMonth} ` : ""}근무가 종료되는 직무지도원의 출근부·일지 중 미확정 건이 있습니다.\n` +
      `공단 제출·정산 전에 출근부 확정 및 일지 작성을 마무리해 주세요.`;

    await prisma.managerNotice.createMany({
      data: managers.map(mg => ({
        managerId: mg.id,
        title,
        body: message || defaultBody,
        link: "/manager/documents",
      })),
    });

    return NextResponse.json({ success: true, sent: managers.length });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/review/remind]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
