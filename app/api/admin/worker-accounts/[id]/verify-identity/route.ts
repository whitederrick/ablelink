// app/api/admin/worker-accounts/[id]/verify-identity/route.ts
// 직무지도원 본인 확인(신원). 신분증 이미지·주민번호 비보관 — 결과값만 저장.
//  - mode=inperson : 매니저 대면 확인(무비용·수동). 즉시 사용 가능.
//  - mode=digital  : 휴대폰/카카오 본인인증 토큰 검증(벤더·PRO). 키 미설정 시 503.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { verifyIdentityToken } from "@/lib/verify/identity";
import { workerBelongsToAgency } from "@/lib/worker/agencyScope";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    let workerId: bigint;
    try { workerId = BigInt(id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }

    // ★13차: 공용 소속 판정(CONSENTED 배정/계약). 미동의 REQUESTED 위장으로 타 기관 워커 본인인증 플래그를
    //  조작하던 우회 차단.
    if (!(await workerBelongsToAgency(workerId, scope.agencyId))) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === "digital" ? "digital" : "inperson";

    // ── 대면 확인(매니저 attest) — 무비용·수동, 플랜 게이트 없음 ──
    if (mode === "inperson") {
      await prisma.worker.update({
        where: { id: workerId },
        data: {
          identityVerifiedAt: new Date(),
          identityMethod: "INPERSON",
          identityVerifiedBy: scope.managerId,
        } as any,
      });
      return NextResponse.json({ success: true, method: "INPERSON", message: "대면 본인 확인이 기록되었습니다." });
    }

    // ── 디지털 본인인증(벤더) — PRO 구독 + 키 필요 ──
    const plan = await checkAgencyPlanAccess(scope.agencyId, "VERIFICATION");
    if (!plan.allowed) {
      return NextResponse.json({ success: false, code: "PLAN", message: plan.message ?? "PRO 플랜에서 사용 가능합니다." }, { status: 403 });
    }

    const result = await verifyIdentityToken(String(body?.token ?? ""));
    if (!result.configured) {
      return NextResponse.json(
        { success: false, code: "NOT_CONFIGURED", message: "본인인증 서비스가 아직 설정되지 않았습니다. (인증 키 미설정)" },
        { status: 503 },
      );
    }
    if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: 400 });

    await prisma.worker.update({
      where: { id: workerId },
      data: {
        identityVerifiedAt: new Date(),
        identityMethod: result.method,
        ...(result.ci ? { ciKey: result.ci } : {}),
      } as any,
    });
    return NextResponse.json({ success: true, method: result.method, name: result.name, message: "본인 인증이 완료되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/worker-accounts/[id]/verify-identity]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
