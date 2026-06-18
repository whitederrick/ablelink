// app/api/admin/worker-accounts/[id]/verify-account/route.ts
// 매니저가 소속 직무지도원의 급여 계좌를 예금주 조회로 검증(POST).
// 통장 이미지 비보관 — 결과값(예금주 일치 여부·일시)만 저장. 사용자 행동 불필요(매니저 대행).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { verifyAccountHolder } from "@/lib/verify/account";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    let workerId: bigint;
    try { workerId = BigInt(id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }

    // 자기 위탁기관 소속 직무지도원만
    const owned = await prisma.worker.findFirst({
      where: { id: workerId, assignments: { some: { site: { agencyId: scope.agencyId } } } },
      select: { bankName: true, accountNumber: true, accountHolder: true },
    });
    if (!owned) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const bankName = String(body?.bankName ?? owned.bankName ?? "").trim();
    const accountNumber = String(body?.accountNumber ?? owned.accountNumber ?? "").trim();
    const expectedHolder = String(body?.accountHolder ?? owned.accountHolder ?? "").trim();
    const bankCode = body?.bankCode ? String(body.bankCode).trim() : null;
    if (!accountNumber) return NextResponse.json({ success: false, message: "계좌번호가 없습니다." }, { status: 400 });

    const result = await verifyAccountHolder({ bankCode, bankName, accountNumber, expectedHolder });

    if (!result.configured) {
      return NextResponse.json(
        { success: false, code: "NOT_CONFIGURED", message: "계좌 인증 서비스가 아직 설정되지 않았습니다. (인증 키 미설정)" },
        { status: 503 },
      );
    }
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    await prisma.worker.update({
      where: { id: workerId },
      data: {
        accountVerifiedAt: new Date(),
        accountHolderVerified: result.matched,
        accountVerifyMethod: result.method,
        ...(result.bankCode ? { bankCode: result.bankCode } : {}),
      } as any,
    });

    return NextResponse.json({
      success: true,
      holderName: result.holderName,
      matched: result.matched,
      message: result.matched ? "예금주가 일치합니다." : `조회된 예금주(${result.holderName})가 입력한 예금주와 다릅니다.`,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/worker-accounts/[id]/verify-account]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
