// app/api/admin/workers/[id]/route.ts
// PATCH: 직무지도원 이름·전화번호·비밀번호 수정 (어드민)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { hash } from "bcryptjs";
import { randomInt } from "crypto";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireManagerSession(req);

    const { id } = await params;
    const userId = BigInt(id);

    // 자기 에이전시 소속 직무지도원만 수정 가능
    const worker = await prisma.worker.findFirst({
      where: {
        id: userId,
        assignments: { some: { site: { agencyId: scope.agencyId } } },
      },
      select: { id: true },
    });
    if (!worker) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json();
    const { userName, phoneNumber, resetPassword } = body;

    const updates: Record<string, any> = {};

    if (userName?.trim()) updates.userName = userName.trim();

    if (phoneNumber) {
      const cleaned = String(phoneNumber).replace(/-/g, "");
      if (!/^01[0-9]{8,9}$/.test(cleaned)) {
        return NextResponse.json({ success: false, message: "올바른 전화번호 형식이 아닙니다." }, { status: 400 });
      }
      const dup = await prisma.worker.findFirst({
        where: { phoneNumber: { in: [phoneNumber, cleaned] }, id: { not: userId } },
      });
      if (dup) return NextResponse.json({ success: false, message: "이미 사용 중인 전화번호입니다." }, { status: 409 });
      updates.phoneNumber = phoneNumber;
    }

    let tempPassword: string | null = null;
    if (resetPassword) {
      tempPassword         = generateTempPassword();
      updates.password     = await hash(tempPassword, 12);
      updates.isTemporary  = true;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, message: "변경할 내용이 없습니다." }, { status: 400 });
    }

    await prisma.worker.update({ where: { id: userId }, data: updates });

    // 임시 비밀번호는 응답에 포함하지 않음 — SMS/카카오 알림으로만 전달
    return NextResponse.json({ success: true, passwordReset: !!tempPassword });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin workers PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
