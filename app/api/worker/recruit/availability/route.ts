// app/api/worker/recruit/availability/route.ts
// 후보자(워커) 구직중 공개 여부 (에이전시 컨택 허용)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const w = await prisma.worker.findUnique({ where: { id: BigInt(session.workerId) }, select: { openToOffers: true } });
    return NextResponse.json({ success: true, openToOffers: !!w?.openToOffers });
  } catch (e: any) {
    console.error("[worker/recruit/availability GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const b = await req.json();
    const openToOffers = b.openToOffers === true;
    await prisma.worker.update({ where: { id: BigInt(session.workerId) }, data: { openToOffers } });
    return NextResponse.json({ success: true, openToOffers });
  } catch (e: any) {
    console.error("[worker/recruit/availability PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
