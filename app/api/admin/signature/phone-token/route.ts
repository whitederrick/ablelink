// app/api/admin/signature/phone-token/route.ts
// 매니저(에이전시 관리자)가 PC에서 발급 → 스마트폰에서 본인 서명을 입력하기 위한 일회용 토큰.
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";
import { createSelfSignToken } from "@/lib/selfSignToken";

export async function POST(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const manager = await prisma.manager.findUnique({
      where: { id: scope.managerId },
      select: { displayName: true },
    });

    const token = await createSelfSignToken({
      scope: "manager",
      id: scope.managerId.toString(),
      name: manager?.displayName ?? undefined,
    });

    const origin = new URL(request.url).origin;
    return NextResponse.json({
      success: true,
      token,
      url: `${origin}/sign-self/${token}`,
      expiresInSec: 600,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
