// app/api/admin/agency-profile/sign-token/route.ts
// 매니저가 PC에서 발급 → 사업주(갑) 대표자가 스마트폰에서 서명을 입력하기 위한 일회용 토큰.
// QR로 즉석 서명하거나, 전화번호를 주면 대표자 휴대폰으로 서명 링크를 SMS 발송한다.
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";
import { createSelfSignToken } from "@/lib/selfSignToken";
import { sendSms, isSmsReady } from "@/lib/sms";

export async function POST(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const agency = await prisma.agency.findUnique({
      where: { id: scope.agencyId },
      select: { name: true, representativeName: true },
    });
    if (!agency) {
      return NextResponse.json({ success: false, message: "에이전시를 찾을 수 없습니다." }, { status: 404 });
    }

    const token = await createSelfSignToken({
      scope: "agency-rep",
      id: scope.managerId.toString(),
      agencyId: scope.agencyId.toString(),
      name: agency.representativeName ?? undefined,
    });

    const origin = new URL(request.url).origin;
    const url = `${origin}/sign-self/${token}`;

    // 전화번호가 있으면 대표자 휴대폰으로 서명 링크 SMS 발송(거래성).
    const body = await request.json().catch(() => ({}));
    const rawPhone: string | undefined = typeof body?.phone === "string" ? body.phone : undefined;
    let sent = false;
    if (rawPhone) {
      const phone = rawPhone.replace(/-/g, "").trim();
      if (!/^01[0-9]{8,9}$/.test(phone)) {
        return NextResponse.json({ success: false, message: "휴대전화번호 형식이 올바르지 않습니다." }, { status: 400 });
      }
      const msg = `[${agency.name}] 근로계약서 대표자 서명 요청\n아래 링크에서 서명해주세요(10분 유효).\n${url}`;
      try {
        await sendSms({ phone, message: msg });
        sent = isSmsReady(); // 미설정 환경은 콘솔 스텁이라 실제 발송 아님
      } catch {
        return NextResponse.json({ success: false, message: "문자 발송에 실패했습니다. QR로 진행해주세요." }, { status: 502 });
      }
    }

    return NextResponse.json({ success: true, token, url, expiresInSec: 600, sent });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[agency-profile sign-token]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
