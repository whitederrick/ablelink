// app/api/cron/daily/route.ts
// 매일 KST 자정 직후 실행되는 배치 작업
// Vercel Cron: vercel.json → "0 15 * * *" (UTC 15:00 = KST 00:00)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAlimtalk, isAlimtalkReady } from "@/lib/kakao";

export const runtime = "nodejs";

function kstDateStr(offsetDays = 0): string {
  const d = new Date();
  d.setTime(d.getTime() + (9 * 60 + offsetDays * 24 * 60) * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const yesterday = kstDateStr(-1);

  let autoConfirmed  = 0;
  let tokensCleared  = 0;
  let expiryNotified = 0;
  const errors: string[] = [];

  // ── 1. 전일 미확정 출근 자동 확정 ──────────────────────────────
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

  // ── 2. 만료 서명 토큰 삭제 ──────────────────────────────────────
  try {
    const r = await prisma.siteSignToken.deleteMany({ where: { expiresAt: { lt: now } } });
    tokensCleared = r.count;
  } catch (e: any) { errors.push(`토큰삭제: ${e.message}`); }

  // ── 3. 계약 만료 알림톡 (D-30 / D-7 / D-1) ─────────────────────
  const templateCode = process.env.KAKAO_CONTRACT_EXPIRY_TEMPLATE_CODE;
  const appUrl       = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
  const alimtalkOk   = isAlimtalkReady("KAKAO_CONTRACT_EXPIRY_TEMPLATE_CODE");

  if (!alimtalkOk || !templateCode) {
    errors.push("만료알림: KAKAO_CONTRACT_EXPIRY_TEMPLATE_CODE 미설정 — 건너뜀");
  } else {
    for (const offsetDays of [30, 7, 1]) {
      const targetDate = kstDateStr(offsetDays); // 오늘로부터 N일 후 날짜
      try {
        // contractEnd가 정확히 targetDate인 활성 계약 (COMPLETED/SIGNED) 검색
        const targetStart = new Date(`${targetDate}T00:00:00+09:00`);
        const targetEnd   = new Date(`${targetDate}T23:59:59+09:00`);

        const contracts = await prisma.employmentContract.findMany({
          where: {
            status:      { in: ["COMPLETED", "SIGNED"] },
            contractEnd: { gte: targetStart, lte: targetEnd },
            agency:      { planType: { in: ["STARTER", "STANDARD", "PRO", "TRIAL"] } },
          },
          include: {
            user:   { select: { phoneNumber: true, userName: true } },
            agency: { select: { planType: true, trialEndsAt: true } },
          },
        });

        for (const contract of contracts) {
          // TRIAL인 경우 기간이 유효한지 추가 확인
          if (contract.agency.planType === "TRIAL") {
            const trialEnd = contract.agency.trialEndsAt;
            if (!trialEnd || trialEnd < now) continue;
          }

          const { userName, phoneNumber } = contract.user;
          const contractEndStr = contract.contractEnd.toISOString().slice(0, 10);
          const siteName = contract.siteName || contract.coachFilledSiteName || "-";

          try {
            await sendAlimtalk({
              phone: phoneNumber, name: userName, templateCode,
              subject: "AbleLink 계약 만료 안내",
              message:
                `안녕하세요 ${userName}님,\n\n` +
                `AbleLink 근로계약 만료 D-${offsetDays} 안내입니다.\n\n` +
                `사업장: ${siteName}\n` +
                `계약 종료일: ${contractEndStr}\n\n` +
                `재계약이 필요하시면 담당 에이전시로 연락해 주세요.\n\n` +
                `${appUrl}/worker/home`,
              buttons: [
                { name: "AbleLink 앱 열기", linkType: "WL", linkMo: `${appUrl}/worker/home`, linkPc: `${appUrl}/worker/home` },
              ],
            });
            expiryNotified++;
          } catch (e: any) {
            errors.push(`만료알림[${contract.id}]: ${e.message}`);
          }
        }
      } catch (e: any) {
        errors.push(`만료알림D-${offsetDays}: ${e.message}`);
      }
    }
  }

  console.log(`[CRON] ${yesterday} 자동확정:${autoConfirmed} 토큰삭제:${tokensCleared} 만료알림:${expiryNotified}`, errors);

  return NextResponse.json({
    success: true, yesterday,
    autoConfirmed, tokensCleared, expiryNotified,
    errors,
  });
}
