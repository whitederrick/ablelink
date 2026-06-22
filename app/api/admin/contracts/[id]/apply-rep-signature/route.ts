// app/api/admin/contracts/[id]/apply-rep-signature/route.ts
// 이미 생성된 계약서에 사업주(갑) 대표자명·직인을 사후 적용.
//  - 작성 시 '대표 서명 적용'을 깜빡했거나, 기관 직인 등록 이전에 만들어진 계약서 보완용.
//  - 기관에 등록된 representativeSignatureUrl(직인/대표 서명)을 주입하고, 대표자명이 비어있으면 기관 대표자명으로 채운다.
//  - 미서명(PENDING)·서명완료(SIGNED) 모두 허용. 직인은 사업주 본인의 날인 행위이므로 사후 적용 가능.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    let cid: bigint;
    try { cid = BigInt(id); } catch { return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 }); }

    const contract = await prisma.employmentContract.findUnique({
      where: { id: cid },
      select: { id: true, agencyId: true, status: true, adminSignatureUrl: true, employerRepName: true },
    });
    if (!contract || contract.agencyId !== scope.agencyId) {
      return NextResponse.json({ success: false, message: "계약서를 찾을 수 없습니다." }, { status: 404 });
    }
    if (contract.status === "CANCELLED") {
      return NextResponse.json({ success: false, message: "취소된 계약서에는 적용할 수 없습니다." }, { status: 400 });
    }

    const agency: any = await prisma.agency.findUnique({
      where: { id: scope.agencyId },
      select: { representativeName: true, representativeSignatureUrl: true } as any,
    });
    if (!agency?.representativeSignatureUrl) {
      return NextResponse.json(
        { success: false, message: "등록된 대표 서명/직인이 없습니다. 사업주 정보 설정에서 먼저 등록해주세요." },
        { status: 400 },
      );
    }

    await prisma.employmentContract.update({
      where: { id: cid },
      data: {
        adminSignatureUrl: agency.representativeSignatureUrl,
        adminSignedAt: new Date(),
        // 대표자명이 비어있으면 기관 대표자명으로 보완(이미 있으면 보존)
        ...(contract.employerRepName ? {} : { employerRepName: agency.representativeName ?? null }),
      } as any,
    });

    return NextResponse.json({ success: true, message: "사업주 대표자명·직인이 적용되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/contracts/[id]/apply-rep-signature]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
