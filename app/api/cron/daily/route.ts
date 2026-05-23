import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(kst.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let autoConfirmed = 0;
  let tokensCleared = 0;
  const errors: string[] = [];

  // 1. 전일 미확정 출근 자동 확정
  try {
    const stale = await prisma.dailyAttendance.findMany({
      where: { workDate: yesterday, startTime: { not: null }, isFinalClosed: false },
      select: { id: true, endTime: true },
    });
    const autoEndTime = new Date(`${yesterday}T18:00:00+09:00`);
    for (const att of stale) {
      await prisma.dailyAttendance.update({
        where: { id: att.id },
        data: {
          endTime:       att.endTime ?? autoEndTime,
          isFinalClosed: true,
          finalizedAt:   now,
          status:        "DONE",
        },
      });
      autoConfirmed++;
    }
  } catch (e: any) { errors.push(`자동확정: ${e.message}`); }

  // 2. 만료 서명 토큰 삭제
  try {
    const r = await prisma.siteSignToken.deleteMany({ where: { expiresAt: { lt: now } } });
    tokensCleared = r.count;
  } catch (e: any) { errors.push(`토큰삭제: ${e.message}`); }

  console.log(`[CRON] ${yesterday} 자동확정:${autoConfirmed} 토큰삭제:${tokensCleared}`, errors);

  return NextResponse.json({ success: true, yesterday, autoConfirmed, tokensCleared, errors });
}
