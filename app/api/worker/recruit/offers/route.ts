// app/api/worker/recruit/offers/route.ts
// 후보자(워커)가 받은 제안 목록 + 수락/거절
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const offers = await prisma.talentOffer.findMany({
      where: { workerId },
      orderBy: { createdAt: "desc" },
      include: { agency: { select: { name: true } } },
    });
    return NextResponse.json({
      success: true,
      offers: offers.map((o) => ({
        id: o.id.toString(),
        agencyName: o.agency?.name ?? "(공단/플랫폼)",
        profession: o.profession,
        siteName: o.siteName ?? null,
        message: o.message ?? null,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        decidedAt: o.decidedAt?.toISOString() ?? null,
      })),
    });
  } catch (e: any) {
    console.error("[worker/recruit/offers GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const b = await req.json();
    const id = parseBigInt(b.id);
    const action = String(b.action ?? "");
    if (!id || !["accept", "decline"].includes(action))
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });

    const offer = await prisma.talentOffer.findUnique({ where: { id } });
    if (!offer || offer.workerId !== workerId) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (offer.status !== "PENDING") return NextResponse.json({ success: false, message: "이미 처리된 제안입니다." }, { status: 409 });

    await prisma.talentOffer.update({ where: { id }, data: { status: action === "accept" ? "ACCEPTED" : "DECLINED", decidedAt: new Date() } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[worker/recruit/offers PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
