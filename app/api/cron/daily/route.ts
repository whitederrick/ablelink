// app/api/cron/daily/route.ts
// 매일 KST 자정 직후 실행되는 배치 작업
// Vercel Cron: vercel.json → "0 15 * * *" (UTC 15:00 = KST 00:00)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeWorkTimes, kstWallTimeToInstant } from "@/lib/workSchedule";
import { getKrHolidays } from "@/lib/krHolidays";
import { sendAlimtalk, isAlimtalkReady } from "@/lib/kakao";
import { randomUUID } from "crypto";

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
  let exemptCreated  = 0;
  let surveysSent    = 0;
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

  // ── 3. 계약 만료 안내 (D-30 / D-7 / D-1) — 앱 내 알림(무료, 비용 절감) ──
  for (const offsetDays of [30, 7, 1]) {
    const targetDate = kstDateStr(offsetDays); // 오늘로부터 N일 후 날짜
    try {
      const targetStart = new Date(`${targetDate}T00:00:00+09:00`);
      const targetEnd   = new Date(`${targetDate}T23:59:59+09:00`);

      const contracts = await prisma.employmentContract.findMany({
        where: {
          status:      { in: ["COMPLETED", "SIGNED"] },
          contractEnd: { gte: targetStart, lte: targetEnd },
          agency:      { planType: { in: ["STARTER", "STANDARD", "PRO", "TRIAL"] } },
        },
        include: { agency: { select: { planType: true, trialEndsAt: true } } },
      });

      for (const contract of contracts) {
        if (contract.agency.planType === "TRIAL") {
          const trialEnd = contract.agency.trialEndsAt;
          if (!trialEnd || trialEnd < now) continue;
        }

        const contractEndStr = contract.contractEnd.toISOString().slice(0, 10);
        const siteName = contract.siteName || contract.workerFilledSiteName || "-";

        try {
          await prisma.workerNotice.create({
            data: {
              workerId: contract.workerId,
              agencyId: contract.agencyId,
              title: `근로계약 만료 D-${offsetDays} 안내`,
              body: `사업장: ${siteName}\n계약 종료일: ${contractEndStr}\n재계약이 필요하면 담당 에이전시로 연락해 주세요.`,
              type: "WARN",
            },
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

  // ── 4. 출퇴근 버튼 면제 배정: 전일 출근부 자동 생성 (시프티 병행) ──
  try {
    const [yy, mm, dd] = yesterday.split("-").map(Number);
    const dow = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay(); // 0=일, 6=토
    const isWeekend = dow === 0 || dow === 6;
    const isKrHoliday = Object.prototype.hasOwnProperty.call(getKrHolidays(yy, mm), yesterday);

    if (!isWeekend && !isKrHoliday) {
      const exemptAssignments = await prisma.siteAssignment.findMany({
        where: { attendanceButtonExempt: true, status: { in: ["ACTIVE", "CONFIRMED", "ASSIGNED"] } },
        select: {
          id: true, workerId: true, siteId: true,
          workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true,
        },
      });

      for (const a of exemptAssignments) {
        try {
          // 현장 커스텀 휴무(근무 미인정)면 스킵
          const customHol = await prisma.siteHoliday.findFirst({
            where: { assignmentId: a.id, date: yesterday, countAsWorkday: false },
            select: { id: true },
          });
          if (customHol) continue;
          // 이미 출근부가 있으면 스킵
          const exists = await prisma.dailyAttendance.findFirst({
            where: { assignmentId: a.id, workDate: yesterday },
            select: { id: true },
          });
          if (exists) continue;

          const times = computeWorkTimes(a.workType, a.commuteGuidanceIncluded, a.customWorkStart, a.customWorkEnd);
          await prisma.dailyAttendance.create({
            data: {
              workerId: a.workerId,
              siteId: a.siteId,
              assignmentId: a.id,
              workDate: yesterday,
              startTime: kstWallTimeToInstant(yesterday, times.start),
              endTime: kstWallTimeToInstant(yesterday, times.end),
              status: "DONE",
              isFinalClosed: true,   // 면제 배정: 워커 확정 불필요 → 자동 확정
              finalizedAt: now,
            },
          });
          exemptCreated++;
        } catch (e: any) { errors.push(`면제생성[${a.id}]: ${e.message}`); }
      }
    }
  } catch (e: any) { errors.push(`면제출근부: ${e.message}`); }

  // ── 5. 계약 종료 자동 만족도 조사 (기본 OFF: SURVEY_AUTO_SEND=true + 알림톡 설정 시) ──
  // 전일 계약 종료(SIGNED/COMPLETED) 직무지도원에 대해, 사업체 담당자(현장 businessContact)에게 자동 발송.
  try {
    if (process.env.SURVEY_AUTO_SEND === "true" && isAlimtalkReady("KAKAO_SURVEY_TEMPLATE_CODE")) {
      const dayStart = new Date(`${yesterday}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const ended = await prisma.employmentContract.findMany({
        where: { status: { in: ["SIGNED", "COMPLETED"] }, contractEnd: { gte: dayStart, lt: dayEnd } },
        select: { id: true, agencyId: true, workerId: true, siteName: true, user: { select: { workerName: true } } },
      });
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://able-link.co.kr";
      for (const c of ended) {
        try {
          // 이미 이 계약 종료로 생성된 조사가 있으면 스킵
          const dup = await prisma.satisfactionSurvey.findFirst({ where: { contractId: c.id }, select: { id: true } });
          if (dup) continue;
          // 사업체 담당자 연락처: 현장(현장명 일치)에서 조회
          const site = c.siteName
            ? await prisma.site.findFirst({
                where: { agencyId: c.agencyId, companyName: c.siteName },
                select: { businessContactName: true, businessContactPhone: true },
              })
            : null;
          const phone = site?.businessContactPhone;
          if (!phone) continue; // 연락처 없으면 자동발송 불가 → 스킵
          const token = randomUUID();
          await prisma.satisfactionSurvey.create({
            data: {
              agencyId: c.agencyId, workerId: c.workerId, contractId: c.id,
              recipientName: site?.businessContactName || null, recipientPhone: phone,
              siteName: c.siteName || null, token, status: "PENDING", auto: true,
              expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), sentAt: now,
            },
          });
          const surveyUrl = `${baseUrl}/survey/${token}`;
          await sendAlimtalk({
            phone, name: site?.businessContactName || "담당자",
            templateCode: process.env.KAKAO_SURVEY_TEMPLATE_CODE!,
            subject: "직무지도원 만족도 조사",
            message: `안녕하세요.\n\n${c.user?.workerName ?? "직무지도원"} 직무지도원에 대한 만족도 조사를 요청드립니다.\n아래 링크에서 평가해 주세요.\n\n${surveyUrl}\n\n링크는 14일간 유효합니다.`,
            buttons: [{ name: "만족도 평가하기", linkType: "WL", linkMo: surveyUrl, linkPc: surveyUrl }],
          });
          surveysSent++;
        } catch (e: any) { errors.push(`만족도자동[${c.id}]: ${e.message}`); }
      }
    }
  } catch (e: any) { errors.push(`만족도자동: ${e.message}`); }

  console.log(`[CRON] ${yesterday} 자동확정:${autoConfirmed} 토큰삭제:${tokensCleared} 만료알림:${expiryNotified} 면제생성:${exemptCreated} 만족도:${surveysSent}`, errors);

  return NextResponse.json({
    success: true, yesterday,
    autoConfirmed, tokensCleared, expiryNotified, exemptCreated, surveysSent,
    errors,
  });
}
