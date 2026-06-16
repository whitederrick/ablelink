// app/api/cron/daily/route.ts
// 매일 KST 자정 직후 실행되는 배치 작업
// Vercel Cron: vercel.json → "0 15 * * *" (UTC 15:00 = KST 00:00)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeWorkTimes, kstWallTimeToInstant } from "@/lib/workSchedule";
import { getKrHolidays } from "@/lib/krHolidays";
import { sendAlimtalk, isAlimtalkReady } from "@/lib/kakao";
import { computePayrollItems } from "@/lib/payroll/computeRun";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
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
  let missedFlagged  = 0;
  let tokensCleared  = 0;
  let expiryNotified = 0;
  let exemptCreated  = 0;
  let surveysSent    = 0;
  let payrollDrafted = 0;
  const errors: string[] = [];

  // ── 1. 전일 미확정 출근 처리 ───────────────────────────────────
  // - status=DONE(퇴근은 눌렀으나 미확정): 기존대로 자동 확정(endTime 이미 표준시각으로 채워짐)
  // - status=WORKING(퇴근 미실행): 18:00 자동 채움 금지. endTime은 비워 '보정대기'로 두고,
  //   '퇴근 미실행'으로 플래그(clockOutMissedAt) + 직무지도원에 앱 내 알림.
  //   → 직무지도원이 사유와 함께 늦게 퇴근 처리하거나, 매니저가 표준시각으로 확정해야 채워진다.
  try {
    const stale = await prisma.dailyAttendance.findMany({
      where: { workDate: yesterday, startTime: { not: null }, isFinalClosed: false },
      select: {
        id: true, status: true, workerId: true, clockOutMissedAt: true,
        site: { select: { companyName: true } },
        assignment: { select: { agencyId: true } },
      },
    });
    for (const att of stale) {
      if (att.status === "WORKING") {
        // 퇴근 미실행 → 보정대기로 두고 1회만 플래그/알림
        if (att.clockOutMissedAt) continue;
        await prisma.dailyAttendance.update({
          where: { id: att.id },
          data: { clockOutMissedAt: now },
        });
        const noticeAgencyId = att.assignment?.agencyId;
        if (noticeAgencyId) {
          try {
            await prisma.workerNotice.create({
              data: {
                workerId: att.workerId,
                agencyId: noticeAgencyId,
                title: "퇴근 미실행 안내",
                body: `${yesterday} '${att.site?.companyName ?? "현장"}' 퇴근이 등록되지 않았습니다.\n앱에서 사유와 함께 퇴근을 처리해 주세요. (처리 전까지 출근부에 퇴근 시각이 비어 있습니다)`,
                type: "WARN",
                link: "/worker/home",
              },
            });
          } catch (e: any) { errors.push(`미실행알림[${att.id}]: ${e.message}`); }
        }
        missedFlagged++;
      } else {
        // status=DONE: endTime 있음 → 자동 확정
        await prisma.dailyAttendance.update({
          where: { id: att.id },
          data: { isFinalClosed: true, finalizedAt: now, status: "DONE" },
        });
        autoConfirmed++;
      }
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
              body: `사업장: ${siteName}\n계약 종료일: ${contractEndStr}\n재계약이 필요하면 담당 위탁기관로 연락해 주세요.`,
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

  // ── 6. 매월 자동 급여 DRAFT 생성 (에이전시별 설정일) ──
  // 오늘(KST) 날짜 == 기관 payrollAutoDay 인 기관에 대해 전월분 급여를 DRAFT로 자동 생성.
  // 이미 해당 월 run이 있으면 건너뜀(확정/초안 보존). 명세서 발급은 담당자 확정 시(자동 X).
  try {
    const todayKst = kstDateStr(0);            // YYYY-MM-DD (KST)
    const todayDay = Number(todayKst.slice(8, 10));
    const [ky, km] = todayKst.split("-").map(Number);
    const py = km === 1 ? ky - 1 : ky;
    const pm = km === 1 ? 12 : km - 1;
    const prevYm = `${py}-${String(pm).padStart(2, "0")}`;   // 전월 YYYY-MM

    const agencies = await prisma.agency.findMany({
      where: { payrollAutoDay: todayDay, isActive: true } as any,
      select: { id: true },
    });
    for (const ag of agencies) {
      try {
        const plan = await checkAgencyPlanAccess(ag.id, "PAYROLL");
        if (!plan.allowed) continue;
        const exists = await prisma.payrollRun.findUnique({ where: { agencyId_yearMonth: { agencyId: ag.id, yearMonth: prevYm } }, select: { id: true } });
        if (exists) continue; // 이미 있으면 보존(덮어쓰지 않음)
        const { items, userCount } = await computePayrollItems(ag.id, prevYm);
        if (userCount === 0 || items.length === 0) continue;
        await prisma.payrollRun.create({ data: { agencyId: ag.id, yearMonth: prevYm, status: "DRAFT", items: { create: items } } });
        payrollDrafted++;
        // 담당자 알림(앱 내 무료) — 활성 매니저에게 초안 생성 알림
        try {
          const mgrs = await prisma.manager.findMany({ where: { agencyId: ag.id, isActive: true }, select: { id: true } });
          if (mgrs.length > 0) {
            await prisma.managerNotice.createMany({
              data: mgrs.map((mg) => ({
                managerId: mg.id,
                title: `${prevYm} 급여 초안 자동 생성`,
                body: `${prevYm} 급여가 출근부·근로계약 기준으로 자동 계산(초안)되었습니다.\n급여 관리 → 월 급여에서 검토 후 확정해 주세요. (확정 시 직무지도원에게 명세서가 발급됩니다)`,
              })),
            });
          }
        } catch { /* 알림 실패 무시 */ }
      } catch (e: any) { errors.push(`급여자동[${ag.id}]: ${e.message}`); }
    }
  } catch (e: any) { errors.push(`급여자동생성: ${e.message}`); }

  console.log(`[CRON] ${yesterday} 자동확정:${autoConfirmed} 퇴근미실행:${missedFlagged} 토큰삭제:${tokensCleared} 만료알림:${expiryNotified} 면제생성:${exemptCreated} 만족도:${surveysSent} 급여초안:${payrollDrafted}`, errors);

  return NextResponse.json({
    success: true, yesterday,
    autoConfirmed, missedFlagged, tokensCleared, expiryNotified, exemptCreated, surveysSent, payrollDrafted,
    errors,
  });
}
