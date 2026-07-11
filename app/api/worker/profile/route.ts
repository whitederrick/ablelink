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
    where:  { id: BigInt(session.workerId) },
    select: {
      id: true, workerName: true, phoneNumber: true, loginId: true, isTemporary: true,
      bankName: true, accountNumber: true, accountHolder: true, birthDate: true,
    },
  });
  if (!user) return NextResponse.json({ success: false, message: "사용자를 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({
    success: true,
    user: { ...user, id: user.id.toString() },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { workerName, phoneNumber, currentPassword, newPassword, bankName, accountNumber, accountHolder, birthDate } = body;

    const user = await prisma.worker.findUnique({
      where:  { id: BigInt(session.workerId) },
      select: { id: true, password: true, workerName: true, phoneNumber: true },
    });
    if (!user) return NextResponse.json({ success: false, message: "사용자를 찾을 수 없습니다." }, { status: 404 });

    const updates: Record<string, any> = {};

    if (workerName && workerName.trim()) updates.workerName = workerName.trim();

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
      // ★비밀번호 변경 = 전 세션 로그아웃(sv+1). 셀프 재설정·onboarding·admin 초기화와 동일 정책(P2-16).
      //  누락 시 탈취 토큰이 sv 대조를 계속 통과 → 비번 바꿔도 도용 세션 미종료.
      updates.sessionVersion = { increment: 1 };
    }

    // 급여 계좌(셀프 입력) — 빈 문자열은 null 처리
    const bankStr = (v: any): string | null | undefined =>
      v === undefined ? undefined : (typeof v === "string" && v.trim() ? v.trim() : null);
    if (bankName !== undefined)      updates.bankName = bankStr(bankName);
    if (accountNumber !== undefined) updates.accountNumber = bankStr(accountNumber);
    if (accountHolder !== undefined) updates.accountHolder = bankStr(accountHolder);
    if (birthDate !== undefined) {
      const bd = bankStr(birthDate);
      if (bd && !/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
        return NextResponse.json({ success: false, message: "생년월일은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
      }
      updates.birthDate = bd;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, message: "변경할 내용이 없습니다." }, { status: 400 });
    }

    const updated = await prisma.worker.update({
      where:  { id: user.id },
      data:   updates,
      select: { id: true, workerName: true, phoneNumber: true },
    });

    // 세션 토큰 갱신 (이름/전화번호 변경 반영)
    const res = NextResponse.json({ success: true });
    const newToken = await signWorkerToken({
      workerId:      updated.id.toString(),
      workerName:    updated.workerName,
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
