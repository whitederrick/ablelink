// app/api/worker/profile/email-change/request/route.ts
// 이메일 아이디 변경 1단계: 인증 코드 발송

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { sendSimpleEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit(`email-change:${ip}:${session.userId}`);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, message: "잠시 후 다시 시도해주세요." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ success: false, message: "올바른 이메일 주소를 입력해주세요." }, { status: 400 });
  }

  // 중복 확인 (다른 사용자가 이미 같은 이메일을 loginId로 사용 중인지)
  const dup = await prisma.user.findFirst({
    where: { loginId: email, id: { not: BigInt(session.userId) } },
  });
  if (dup) {
    return NextResponse.json({ success: false, message: "이미 사용 중인 이메일 주소입니다." }, { status: 409 });
  }

  // 6자리 인증 코드 생성
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10분

  await prisma.user.update({
    where: { id: BigInt(session.userId) },
    data: {
      pendingLoginId:      email,
      verifyCode:          code,
      verifyCodeExpiresAt: expiresAt,
    },
  });

  try {
    await sendSimpleEmail({
      to:      email,
      subject: "[AbleLink] 이메일 인증 코드",
      text:    `안녕하세요, ${session.userName}님.\n\n이메일 아이디 변경을 위한 인증 코드입니다.\n\n인증 코드: ${code}\n\n이 코드는 10분간 유효합니다.\n본인이 요청하지 않으셨다면 무시해주세요.`,
    });
  } catch (e) {
    console.error("[email-change/request] SES 오류:", e);
    // SES 샌드박스 환경에서는 발송 실패 허용 (개발 환경 대응)
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ success: false, message: "이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
    }
    console.warn("[email-change/request] 개발 환경 — 인증 코드:", code);
  }

  return NextResponse.json({ success: true, message: "인증 코드를 발송했습니다. 이메일을 확인해주세요." });
}
