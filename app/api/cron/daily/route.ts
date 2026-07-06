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
import { PREMIUM_FEATURE_PLANS } from "@/lib/plans";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

function kstDateStr(offsetDays = 0): string {
  const d = new Date();
  d.setTime(d.getTime() + (9 * 60 + offsetDays * 24 * 60) * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  // 인증: 헤더 전용(x-cron-secret 또는 Vercel Cron의 Authorization: Bearer).
  //  · 쿼리스트링(?secret=)은 프록시/브라우저/모니터링 로그에 남아 제거함.
  const secret =
    req.headers.get("x-cron-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
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

  // 감사 상세: 요약 1줄 + 상세 모달에서 처리 건별 내역 조회용(변경주체=시스템)
  const detail: {
    autoConfirmed: any[]; missedFlagged: any[]; exemptCreated: any[]; payrollDrafted: any[];
  } = { autoConfirmed: [], missedFlagged: [], exemptCreated: [], payrollDrafted: [] };

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
        detail.missedFlagged.push({ attId: String(att.id), workerId: String(att.workerId), site: att.site?.companyName ?? null, date: yesterday });
      } else {
        // status=DONE: endTime 있음 → 자동 확정
        await prisma.dailyAttendance.update({
          where: { id: att.id },
          data: { isFinalClosed: true, finalizedAt: now, status: "DONE" },
        });
        autoConfirmed++;
        detail.autoConfirmed.push({ attId: String(att.id), workerId: String(att.workerId), site: att.site?.companyName ?? null, date: yesterday });
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
          agency:      { planType: { in: PREMIUM_FEATURE_PLANS } },
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
              link: "/worker/contracts",
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
      // ★배정 기간(startDate~endDate)이 전일을 포함하는 배정만 — 시작 전/종료 후 날짜가 출근부·급여에 들어가던 버그 차단.
      const yStart = new Date(`${yesterday}T00:00:00+09:00`);
      const yEnd = new Date(`${yesterday}T23:59:59+09:00`);
      const exemptAssignments = await prisma.siteAssignment.findMany({
        where: {
          attendanceButtonExempt: true,
          status: { in: ["ACTIVE", "CONFIRMED", "ASSIGNED"] },
          startDate: { lte: yEnd },
          OR: [{ endDate: null }, { endDate: { gte: yStart } }],
        },
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
          detail.exemptCreated.push({ assignmentId: String(a.id), workerId: String(a.workerId), siteId: String(a.siteId), date: yesterday });
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

  // ── 5b. 미회신 평가 자동 종료 — 만료(30일) 경과한 PENDING 평가는 '미회신 종료'(EXPIRED)로. 재요청 가능. ──
  let surveysExpired = 0;
  try {
    const expiring = await prisma.satisfactionSurvey.findMany({
      where: { status: "PENDING", expiresAt: { lt: now } },
      select: { id: true, agencyId: true, workerId: true, createdByManagerId: true },
    });
    if (expiring.length > 0) {
      await prisma.satisfactionSurvey.updateMany({
        where: { id: { in: expiring.map(s => s.id) } },
        data: { status: "EXPIRED" },
      });
      surveysExpired = expiring.length;
      // 요청자(작성 의뢰 매니저, 없으면 기관 활성 매니저)에게 '기한 만료 — 재요청 필요' 알림(앱 내 무료)
      try {
        const workerIds = [...new Set(expiring.map(s => s.workerId))];
        const workers = await prisma.worker.findMany({ where: { id: { in: workerIds } }, select: { id: true, workerName: true } });
        const nameOf = new Map(workers.map(w => [w.id.toString(), w.workerName]));
        const agencyMgrCache = new Map<string, bigint[]>();
        const notices: { managerId: bigint; title: string; body: string; link: string }[] = [];
        for (const s of expiring) {
          let mids: bigint[] = [];
          if (s.createdByManagerId) mids = [s.createdByManagerId];
          else if (s.agencyId) {
            const key = s.agencyId.toString();
            if (!agencyMgrCache.has(key)) {
              const mgrs = await prisma.manager.findMany({ where: { agencyId: s.agencyId, isActive: true }, select: { id: true } });
              agencyMgrCache.set(key, mgrs.map(m => m.id));
            }
            mids = agencyMgrCache.get(key)!;
          }
          const name = nameOf.get(s.workerId.toString()) ?? "직무지도원";
          for (const mid of mids) notices.push({
            managerId: mid,
            title: `[평가 만료] ${name} 만족도 조사 미회신`,
            body: `${name} 직무지도원 만족도(역량) 평가가 응답 기한 내 회신되지 않아 종료되었습니다. 필요 시 재요청해 주세요.`,
            link: "/manager/reports",
          });
        }
        if (notices.length > 0) await prisma.managerNotice.createMany({ data: notices });
      } catch (e: any) { errors.push(`평가만료알림: ${e.message}`); }
    }
  } catch (e: any) { errors.push(`평가만료: ${e.message}`); }

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
    const daysInMonth = new Date(ky, km, 0).getDate();        // 이번 달 일수
    const isLastDay = todayDay === daysInMonth;

    // 오늘 == 설정일, 또는 설정일이 이번 달 일수보다 커서 말일로 보정되는 기관(말일 대응)
    const agencies = await prisma.agency.findMany({
      where: {
        isActive: true,
        OR: [{ payrollAutoDay: todayDay }, ...(isLastDay ? [{ payrollAutoDay: { gt: daysInMonth } }] : [])],
      },
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
        detail.payrollDrafted.push({ agencyId: String(ag.id), yearMonth: prevYm, userCount });
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

  // ── 7. 월별 진척도 자동 독려 ──────────────────────────────────────
  //   이번 달에 근무(배정)가 종료되는 직무지도원 중 출근부/일지가 미확정인 건이 있는 위탁기관의
  //   담당자에게 마감 독려 알림(ManagerNotice). 진행 중 직무지도원은 제외.
  let remindAgencies = 0;
  try {
    const todayKst = kstDateStr(0);
    const ym = todayKst.slice(0, 7);
    const [yy, mm] = ym.split("-").map(Number);
    const dateFrom = `${ym}-01`;
    const dateTo = `${ym}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
    const dtFrom = new Date(`${dateFrom}T00:00:00`);
    const dtTo = new Date(`${dateTo}T23:59:59`);

    const ending = await prisma.siteAssignment.findMany({
      where: { status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] }, endDate: { gte: dtFrom, lte: dtTo } },
      select: { workerId: true, agencyId: true },
    });
    if (ending.length) {
      const uids = [...new Set(ending.map(e => e.workerId))];
      const [attRows, logRows] = await Promise.all([
        prisma.dailyAttendance.findMany({ where: { workerId: { in: uids }, workDate: { gte: dateFrom, lte: dateTo }, startTime: { not: null } }, select: { workerId: true, isFinalClosed: true } }),
        prisma.traineeLog.findMany({ where: { writerId: { in: uids }, attendance: { workDate: { gte: dateFrom, lte: dateTo } } }, select: { writerId: true, isCompleted: true } }),
      ]);
      const att = new Map<string, { t: number; c: number }>(), log = new Map<string, { t: number; c: number }>();
      for (const r of attRows) { const k = r.workerId.toString(); const m = att.get(k) ?? { t: 0, c: 0 }; m.t++; if (r.isFinalClosed) m.c++; att.set(k, m); }
      for (const r of logRows) { const k = r.writerId.toString(); const m = log.get(k) ?? { t: 0, c: 0 }; m.t++; if (r.isCompleted) m.c++; log.set(k, m); }

      const urgentByAgency = new Map<string, number>();
      for (const e of ending) {
        if (e.agencyId == null) continue;
        const wk = e.workerId.toString();
        const a = att.get(wk), l = log.get(wk);
        const incomplete = (!!a && a.c < a.t) || (!!l && l.c < l.t);
        if (incomplete) { const k = e.agencyId.toString(); urgentByAgency.set(k, (urgentByAgency.get(k) ?? 0) + 1); }
      }

      const since = new Date(Date.now() - 20 * 60 * 60 * 1000); // 중복 발송 방지(20h)
      for (const [agId, cnt] of urgentByAgency) {
        const mgrs = await prisma.manager.findMany({ where: { agencyId: BigInt(agId), isActive: true }, select: { id: true } });
        if (!mgrs.length) continue;
        const title = `[마감 독려] ${ym} 근무 종료 직무지도원 ${cnt}명 서류 미완료`;
        const dup = await prisma.managerNotice.findFirst({ where: { managerId: { in: mgrs.map(m => m.id) }, title, createdAt: { gte: since } }, select: { id: true } });
        if (dup) continue;
        await prisma.managerNotice.createMany({
          data: mgrs.map(m => ({
            managerId: m.id, title,
            body: `근무가 종료되는 직무지도원의 출근부·일지 중 미확정 건이 ${cnt}명 있습니다.\n공단 제출·정산 전에 출근부 확정 및 일지 작성을 마무리해 주세요.`,
            link: "/manager/documents",
          })),
        });
        remindAgencies++;
      }
    }
  } catch (e: any) { errors.push(`진척독려: ${e.message}`); }

  // ── 감사로그(변경주체=시스템): 데이터 변경이 있었던 배치만 요약 1건 기록. 상세는 payload에 처리 내역 전량. ──
  try {
    const changed = autoConfirmed + missedFlagged + exemptCreated + payrollDrafted + surveysExpired + expiryNotified + surveysSent + remindAgencies + tokensCleared;
    if (changed > 0) {
      const parts: string[] = [];
      if (autoConfirmed) parts.push(`출근 자동확정 ${autoConfirmed}`);
      if (missedFlagged) parts.push(`퇴근 미실행 ${missedFlagged}`);
      if (exemptCreated) parts.push(`면제 출근부 생성 ${exemptCreated}`);
      if (payrollDrafted) parts.push(`급여 초안 ${payrollDrafted}`);
      if (surveysExpired) parts.push(`평가 만료 ${surveysExpired}`);
      if (surveysSent) parts.push(`만족도 발송 ${surveysSent}`);
      if (expiryNotified) parts.push(`계약만료 알림 ${expiryNotified}`);
      if (remindAgencies) parts.push(`마감 독려 ${remindAgencies}`);
      if (tokensCleared) parts.push(`만료 토큰 삭제 ${tokensCleared}`);
      const payload: Record<string, unknown> = {
        date: yesterday,
        counts: { autoConfirmed, missedFlagged, exemptCreated, payrollDrafted, surveysExpired, surveysSent, expiryNotified, remindAgencies, tokensCleared },
        details: detail,
      };
      if (errors.length) payload.errors = errors;
      await audit(null, {
        entityType: "cron.daily",
        entityId: yesterday,
        action: "batch",
        summary: `일일 배치(${yesterday}) — ${parts.join(", ")}`,
        payload: payload as any,
      });
    }
  } catch { /* 감사 실패는 배치에 영향 없음 */ }

  console.log(`[CRON] ${yesterday} 자동확정:${autoConfirmed} 퇴근미실행:${missedFlagged} 토큰삭제:${tokensCleared} 만료알림:${expiryNotified} 면제생성:${exemptCreated} 만족도:${surveysSent} 평가만료:${surveysExpired} 급여초안:${payrollDrafted} 진척독려:${remindAgencies}`, errors);

  return NextResponse.json({
    success: true, yesterday,
    autoConfirmed, missedFlagged, tokensCleared, expiryNotified, exemptCreated, surveysSent, payrollDrafted, remindAgencies,
    errors,
  });
}
