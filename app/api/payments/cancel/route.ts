// app/api/payments/cancel/route.ts
// 구독 해지 API

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const { agencyId } = await request.json();

    if (!agencyId) {
      return NextResponse.json({ success: false, message: "agencyId가 필요합니다." }, { status: 400 });
    }

    // 구독 해지: 빌링키 제거, 다음 결제일 제거, FREE로 변경
    await prisma.agency.update({
      where: { id: BigInt(agencyId) },
      data: {
        planType: "FREE",
        tossBillingKey: null,
        tossCustomerKey: null,
        nextBillingAt: null,
        subscriptionId: null,
      },
    });

    return NextResponse.json({ success: true, message: "구독이 해지되었습니다." });
  } catch (error: any) {
    console.error("[payments/cancel]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
