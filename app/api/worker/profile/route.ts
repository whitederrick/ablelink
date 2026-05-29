// app/api/worker/profile/route.ts
// GET: 내 정보 조회  PATCH: 이름·전화번호·비밀번호 수정

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq, signWorkerToken, WORKER_COOKIE } from "@/app/worker/_lib/session";
import { hash, compare } from "bcryptjs";

export async function GET(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  const user = await prisma.worker.findUnique({
    where:  { id: BigInt(session.userId) },
    select: { id: true, userName: true, phoneNumber: true, loginId: true, isTemporary: true },
  });
  if (!user) return NextResponse.json({ success: false, message: "사용자를 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({ success: true, user: { ...user, id: user.id.toString() } });
}

export async function PATCH(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { userName, phoneNumber, currentPassword, newPassword } = body;

    const user = await prisma.worker.findUnique({
      where:  { id: BigInt(session.userId) },
      select: { id: true, password: true, userName: true, phoneNumber: true },
    });
    if (!user) return NextResponse.json({ success: false, message: "사용자를 찾을 수 없습니다." }, { status: 404 });

    const updates: Record<string, any> = {};

    if (userName && userName.trim()) updates.userName = userName.trim();

    if (phoneNumber) {
      const cleaned = phoneNumber.replace(/-/g, "");
      if (!/^01[0-9]{8,9}$/.test(cleaned)) {
        return NextResponse.json({ success: false, message: "올바른 전화번호 형식이 아닙니다." }, { status: 400 });
      }
      // 중복 확인
      const dup = await prisma.worker.findFirst({
        where: { phoneNumber: { in: [phoneNumber, cleaned] }, id: { not: user.id } },
      });
      if (dup) return NextResponse.json({ success: false, message: "이미 사용 중인 전화번호입니다." }, { status: 409 });
      updates.phoneNumber = phoneNumber;
    }

    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ success: false, message: "현재 비밀번호를 입력해주세요." }, { status: 400 });
      }
      const ok = await compare(currentPassword, user.password);
      if (!ok) return NextResponse.json({ success: false, message: "현재 비밀번호가 올바르지 않습니다." }, { status: 400 });
      if (newPassword.length < 8) {
        return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
      }
      updates.password    = await hash(newPassword, 12);
      updates.isTemporary = false;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, message: "변경할 내용이 없습니다." }, { status: 400 });
    }

    const updated = await prisma.worker.update({
      where:  { id: user.id },
      data:   updates,
      select: { id: true, userName: true, phoneNumber: true },
    });

    // 세션 토큰 갱신 (이름/전화번호 변경 반영)
    const res = NextResponse.json({ success: true });
    const newToken = await signWorkerToken({
      userId:      updated.id.toString(),
      userName:    updated.userName,
      isTemporary: false,
    });
    res.cookies.set({
      name:     WORKER_COOKIE,
      value:    newToken,
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      path:     "/",
      maxAge:   60 * 60 * 24 * 7,
    });
    return res;
  } catch (e: any) {
    console.error("[profile PATCH]", e);
    return NextResponse.json({ success: false, message: "저장에 실패했습니다." }, { status: 500 });
  }
}
