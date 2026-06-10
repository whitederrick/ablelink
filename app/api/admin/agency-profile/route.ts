// app/api/admin/agency-profile/route.ts
// 매니저 소속 에이전시 기본 정보 (계약서 사업주 자동채움 등). GET 조회 + PATCH 편집(매니저 셀프).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { isValidBRN, formatBRN } from "@/lib/validateBRN";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const a = await prisma.agency.findUnique({
      where: { id: scope.agencyId },
      select: { name: true, phoneNumber: true, address: true, businessNumber: true, representativeName: true, representativeSignatureUrl: true },
    });
    if (!a) return NextResponse.json({ success: false, message: "에이전시를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({
      success: true,
      data: {
        name: a.name,
        phoneNumber: a.phoneNumber,
        address: a.address,
        businessNumber: a.businessNumber,
        representativeName: a.representativeName,
        representativeSignatureUrl: a.representativeSignatureUrl,
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[agency-profile GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// PATCH: 사업주 정보 편집(계약서 자동입력 소스). 이름(name)은 unique 충돌 위험 + 운영자 관리 영역이라 변경 불가.
export async function PATCH(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const body = await req.json().catch(() => ({}));
    const { phoneNumber, address, businessNumber, representativeName, representativeSignatureUrl } = body;

    const str = (v: any): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

    const data: any = {};
    if (phoneNumber !== undefined)        data.phoneNumber = str(phoneNumber);
    if (address !== undefined)            data.address = str(address);
    if (representativeName !== undefined)  data.representativeName = str(representativeName);
    if (representativeSignatureUrl !== undefined) {
      // data URI(PNG) 또는 null. 과대 페이로드 방지(약 1MB 상한).
      const sig = typeof representativeSignatureUrl === "string" && representativeSignatureUrl.startsWith("data:image") ? representativeSignatureUrl : null;
      if (sig && sig.length > 1_500_000) {
        return NextResponse.json({ success: false, message: "서명 이미지가 너무 큽니다." }, { status: 400 });
      }
      data.representativeSignatureUrl = sig;
    }
    if (businessNumber !== undefined) {
      const bn = str(businessNumber);
      // 사업자등록번호 형식 + 국세청 체크섬 검증
      if (bn && !isValidBRN(bn)) {
        return NextResponse.json({ success: false, message: "유효하지 않은 사업자등록번호입니다. 10자리를 확인해주세요. (예: 123-45-67890)" }, { status: 400 });
      }
      data.businessNumber = bn ? formatBRN(bn) : null;
    }

    try {
      await prisma.agency.update({ where: { id: scope.agencyId }, data });
    } catch (e: any) {
      if (e?.code === "P2002") {
        return NextResponse.json({ success: false, message: "이미 등록된 사업자등록번호입니다." }, { status: 409 });
      }
      throw e;
    }

    return NextResponse.json({ success: true, message: "사업주 정보가 저장되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[agency-profile PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
