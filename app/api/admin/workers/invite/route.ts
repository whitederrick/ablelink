// POST /api/admin/workers/invite — 직무지도원 초대 링크 생성

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { sendSms } from "@/lib/sms";

const PHONE_RE = /^01[0-9]{8,9}$/;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);
    const agencyId = scope.agencyId;

    const body = await request.json();
    const phoneNumber = String(body?.phoneNumber ?? "").replace(/-/g, "").trim();
    const workerName  = String(body?.workerName  ?? "").trim() || null;
    const siteIdRaw   = body?.siteId != null ? String(body.siteId).trim() : "";
    const siteId      = siteIdRaw && /^\d+$/.test(siteIdRaw) ? BigInt(siteIdRaw) : null;

    if (!PHONE_RE.test(phoneNumber)) {
      return NextResponse.json({ success: false, message: "올바른 휴대전화번호를 입력해주세요." }, { status: 400 });
    }

    // 이미 가입된 계정인지 확인
    const existing = await prisma.worker.findUnique({ where: { loginId: phoneNumber } });
    if (existing) {
      return NextResponse.json({ success: false, message: "이미 가입된 직무지도원입니다." }, { status: 409 });
    }

    const code = randomCode();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    // 기존 미사용 초대 무효화
    await prisma.workerInvite.updateMany({
      where: { agencyId, phoneNumber, usedAt: null },
      data: { expiresAt: new Date() },
    });

    const invite = await prisma.workerInvite.create({
      data: {
        agencyId,
        siteId,
        phoneNumber,
        workerName,
        code,
        expiresAt,
        createdByManagerId: scope.managerId,
      },
      include: { agency: { select: { name: true } } },
    });

    const baseUrl   = process.env.NEXT_PUBLIC_APP_URL || "https://able-link.co.kr";
    const inviteUrl = `${baseUrl}/worker/invite/${invite.id}`;

    // SMS 발송 시도 (환경변수 없으면 콘솔 출력)
    try {
      await sendSms({
        phone: phoneNumber,
        message: `[AbleLink] ${invite.agency.name}에서 직무지도원 초대장이 도착했습니다.\n인증번호: ${code}\n가입 링크: ${inviteUrl}\n(24시간 유효)`,
      });
    } catch (smsErr) {
      console.warn("[invite] SMS 발송 실패:", smsErr);
    }

    return NextResponse.json({
      success: true,
      invite: {
        id:         invite.id.toString(),
        code,
        inviteUrl,
        expiresAt:  invite.expiresAt.toISOString(),
        phoneNumber,
        workerName,
      },
    });
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error("[admin/workers/invite]", err);
    return NextResponse.json({ success: false, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
