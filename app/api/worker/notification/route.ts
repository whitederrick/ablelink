// app/api/worker/notification/route.ts
// 알람 설정 조회/저장

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

// GET: 알람 설정 조회
export async function GET(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

  const userId = BigInt(session.userId);
  const setting = await prisma.userNotificationSetting.findUnique({
    where: { userId },
    select: { clockInAlertMinutes: true, clockOutAlertMinutes: true, pushSubscription: true },
  });

  return NextResponse.json({
    success: true,
    data: setting ?? { clockInAlertMinutes: 3, clockOutAlertMinutes: 3, pushSubscription: null },
  });
}

// POST: 알람 설정 저장 (구독 정보 포함)
export async function POST(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

  const userId = BigInt(session.userId);
  const body = await req.json();

  const clockInAlertMinutes  = typeof body.clockInAlertMinutes  === "number" ? Math.max(0, Math.min(60, body.clockInAlertMinutes))  : 3;
  const clockOutAlertMinutes = typeof body.clockOutAlertMinutes === "number" ? Math.max(0, Math.min(60, body.clockOutAlertMinutes)) : 3;

  const data: any = { clockInAlertMinutes, clockOutAlertMinutes, updatedAt: new Date() };
  if (body.pushSubscription !== undefined) {
    const subStr = JSON.stringify(body.pushSubscription);
    if (subStr.length > 4096) {
      return NextResponse.json({ success: false, message: "pushSubscription이 너무 큽니다." }, { status: 400 });
    }
    data.pushSubscription = body.pushSubscription;
  }

  await prisma.userNotificationSetting.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return NextResponse.json({ success: true });
}
