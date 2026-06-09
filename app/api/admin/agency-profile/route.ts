// app/api/admin/agency-profile/route.ts
// 매니저 소속 에이전시 기본 정보 (계약서 사업주 자동채움 등)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const a = await prisma.agency.findUnique({
      where: { id: scope.agencyId },
      select: { name: true, phoneNumber: true, address: true, businessNumber: true },
    });
    if (!a) return NextResponse.json({ success: false, message: "에이전시를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({
      success: true,
      data: { name: a.name, phoneNumber: a.phoneNumber, address: a.address, businessNumber: a.businessNumber },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[agency-profile GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
