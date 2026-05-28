// app/api/worker/profile/email-change/confirm/route.ts
// 이메일 아이디 변경 2단계: 코드 확인 후 loginId 교체

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function POST(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "").trim();

  if (!code) {
    return NextResponse.json({ success: false, message: "인증 코드를 입력해주세요." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: BigInt(session.userId) },
    select: { id: true, pendingLoginId: true, verifyCode: true, verifyCodeExpiresAt: true },
  });

  if (!user?.pendingLoginId || !user.verifyCode) {
    return NextResponse.json({ success: false, message: "인증 코드 발송 내역이 없습니다. 다시 시도해주세요." }, { status: 400 });
  }

  if (!user.verifyCodeExpiresAt || new Date() > user.verifyCodeExpiresAt) {
    return NextResponse.json({ success: false, message: "인증 코드가 만료되었습니다. 다시 발송해주세요." }, { status: 400 });
  }

  if (user.verifyCode !== code) {
    return NextResponse.json({ success: false, message: "인증 코드가 올바르지 않습니다." }, { status: 400 });
  }

  // loginId를 이메일로 교체 + 임시 필드 초기화
  await prisma.user.update({
    where: { id: user.id },
    data: {
      loginId:             user.pendingLoginId,
      pendingLoginId:      null,
      verifyCode:          null,
      verifyCodeExpiresAt: null,
    },
  });

  return NextResponse.json({ success: true, newLoginId: user.pendingLoginId });
}
