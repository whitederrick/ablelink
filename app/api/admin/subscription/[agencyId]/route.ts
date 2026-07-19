// app/api/admin/subscription/[agencyId]/route.ts
// 위탁기관 플랜 변경 API

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/planGuard";
import { requireManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agencyId: string }> }
) {
  try {
    const scope = await requireManagerSession(request);

    const { planType } = await request.json().catch(() => ({}));
    const { agencyId: agencyIdStr } = await params;

    // A(P1)+3차: 매니저 자기스코프 라우트는 무료 다운그레이드(FREE)만 허용.
    //  · 유료 티어 승격 = 반드시 결제 경로(/api/payments/billing, Toss 실결제 후에만 상향).
    //  · TRIAL 시작도 여기서 금지 — 트라이얼은 startTrialIfNeeded(FREE·미소진 1회 가드)만 부여한다.
    //    (여기서 TRIAL을 허용하면 매니저가 자기 기관 트라이얼을 무한 갱신해 무결제 PRO 남용 가능)
    if (planType !== "FREE") {
      return NextResponse.json(
        { success: false, message: "유료 플랜·트라이얼 변경은 결제/자동 트라이얼을 통해서만 가능합니다." },
        { status: 400 },
      );
    }

    // 비숫자 id의 BigInt() throw → 500으로 새지 않게 400 처리(P3 위생).
    const agencyId = parseBigInt(agencyIdStr);
    if (!agencyId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    if (scope.agencyId !== agencyId) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }
    const limits = PLAN_LIMITS.FREE || { maxWorkers: 0, maxSites: 0 };

    await prisma.agency.update({
      where: { id: agencyId },
      // ★10차#2: FREE 강등 시 협상가(customAmount) 소멸(1회성 딜) — 다른 강등경로(cancel·cron)와 정합.
      data: { planType: "FREE", customAmount: null, maxWorkers: limits.maxWorkers, maxSites: limits.maxSites },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("[admin/subscription/patch]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
