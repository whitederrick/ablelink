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
import { randomUUID, timingSafeEqual } from "crypto";
import { PREMIUM_FEATURE_PLANS } from "@/lib/plans";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
// 일일 배치는 섹션 수·기관 수에 비례해 길어질 수 있음 — 기본(10s)보다 넉넉히(중간 실패 시 뒷 섹션 통째 누락 방지).
export const maxDuration = 300;

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
  // ★상수시간 비교(타이밍 사이드채널 제거). 길이 다르면 timingSafeEqual이 throw하므로 선체크.
  const expectedSecret = process.env.CRON_SECRET || "";
  const secretOk = expectedSecret.length > 0
    && secret.length === expectedSecret.length
    && timingSafeEqual(Buffer.from(secret), Buffer.from(expectedSecret));
  if (!secretOk) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const yesterday = kstDateStr(-1);

  // #9(17차): 배치가 1회라도 실패/미실행하면 그 날짜의 자동확정·면제 출근부·급여 초안이 영구 누락됐다(캐치업 없음).
  //  최근 N일을 되돌아보며 재처리한다 — 각 섹션의 멱등 장치(자동확정=isFinalClosed:false 필터, 면제생성=
  //  existSet+skipDuplicates, 급여=run 존재검사)가 이미 처리된 날은 자연히 건너뛰므로 중복 없이 자가 치유된다.
  const LOOKBACK_DAYS = 7;
  const lookbackDates: string[] = []; // [어제, 그제, … N일 전]
  for (let i = 1; i <= LOOKBACK_DAYS; i++) lookbackDates.push(kstDateStr(-i));
  const lookbackStart = lookbackDates[lookbackDates.length - 1];

  let autoConfirmed  = 0;
  let missedFlagged  = 0;
  let tokensCleared  = 0;
  let expiryNotified = 0;
  let exemptCreated  = 0;
  let surveysSent    = 0;
  let payrollDrafted = 0;
  let assignmentsEnded = 0;
  const errors: string[] = [];

  // 감사 상세: 요약 1줄 + 상세 모달에서 처리 건별 내역 조회용(변경주체=시스템)
  const detail: {
    autoConfirmed: any[]; missedFlagged: any[]; exemptCreated: any[]; payrollDrafted: any[]; assignmentsEnded: any[];
  } = { autoConfirmed: [], missedFlagged: [], exemptCreated: [], payrollDrafted: [], assignmentsEnded: [] };

  // ── 1. 전일 미확정 출근 처리 ───────────────────────────────────
  // - status=DONE(퇴근은 눌렀으나 미확정): 기존대로 자동 확정(endTime 이미 표준시각으로 채워짐)
  // - status=WORKING(퇴근 미실행): 18:00 자동 채움 금지. endTime은 비워 '보정대기'로 두고,
  //   '퇴근 미실행'으로 플래그(clockOutMissedAt) + 직무지도원에 앱 내 알림.
  //   → 직무지도원이 사유와 함께 늦게 퇴근 처리하거나, 매니저가 표준시각으로 확정해야 채워진다.
  try {
    const stale = await prisma.dailyAttendance.findMany({
      // #9: 어제 하루가 아니라 최근 N일 미확정을 함께 처리(미실행 캐치업). isFinalClosed:false 필터가
      //  이미 확정된 날을 제외하므로 중복 없음.
      where: { workDate: { gte: lookbackStart, lte: yesterday }, startTime: { not: null }, isFinalClosed: false },
      select: {
        id: true, status: true, workerId: true, workDate: true, clockOutMissedAt: true,
        site: { select: { companyName: true } },
        assignment: { select: { agencyId: true } },
      },
    });
    // 순차 N update → 일괄 배치(대량일 때 함수 타임아웃 방지). 의미 동일.
    //  · status=DONE(퇴근 눌렀으나 미확정): endTime 이미 채워짐 → 일괄 자동 확정.
    //  · status=WORKING(퇴근 미실행): 18:00 자동 채움 금지. 보정대기로 두고 1회만 플래그(clockOutMissedAt)+알림.
    // ★DONE만 자동확정. 비-WORKING 전체(status!=="WORKING")로 잡으면 startTime 있는 ABSENT행까지 DONE으로
    //  덮어 결근이 조용히 근무일화될 수 있다(현재 ABSENT는 시각과 함께 persist 안 되나 방어적 명시).
    const doneRows = stale.filter((a) => a.status === "DONE");
    const workingRows = stale.filter((a) => a.status === "WORKING" && !a.clockOutMissedAt);

    if (doneRows.length) {
      await prisma.dailyAttendance.updateMany({
        where: { id: { in: doneRows.map((a) => a.id) } },
        data: { isFinalClosed: true, finalizedAt: now, status: "DONE" },
      });
      autoConfirmed = doneRows.length;
      detail.autoConfirmed = doneRows.map((a) => ({ attId: String(a.id), workerId: String(a.workerId), site: a.site?.companyName ?? null, date: a.workDate }));
    }

    if (workingRows.length) {
      await prisma.dailyAttendance.updateMany({
        where: { id: { in: workingRows.map((a) => a.id) } },
        data: { clockOutMissedAt: now },
      });
      missedFlagged = workingRows.length;
      detail.missedFlagged = workingRows.map((a) => ({ attId: String(a.id), workerId: String(a.workerId), site: a.site?.companyName ?? null, date: a.workDate }));
      // '퇴근 미실행' 앱 내 알림(무료) — agencyId 있는 행만 일괄 생성.
      try {
        const notices = workingRows
          .filter((a) => a.assignment?.agencyId)
          .map((a) => ({
            workerId: a.workerId,
            agencyId: a.assignment!.agencyId!,
            title: "퇴근 미실행 안내",
            body: `${a.workDate} '${a.site?.companyName ?? "현장"}' 퇴근이 등록되지 않았습니다.\n앱에서 사유와 함께 퇴근을 처리해 주세요. (처리 전까지 출근부에 퇴근 시각이 비어 있습니다)`,
            type: "WARN" as any,
            link: "/worker/home",
          }));
        if (notices.length) await prisma.workerNotice.createMany({ data: notices });
      } catch (e: any) { errors.push(`미실행알림: ${e.message}`); }
    }
  } catch (e: any) { errors.push(`자동확정: ${e.message}`); }

  // ── 2. 만료 서명 토큰 삭제 ──────────────────────────────────────
  try {
    // 미사용(서명 전) 만료 토큰만 삭제 — 사용완료(서명) 토큰은 서명 근거·재제출 흐름을 위해 보존.
    const r = await prisma.siteSignToken.deleteMany({ where: { expiresAt: { lt: now }, usedAt: null } });
    tokensCleared = r.count;
  } catch (e: any) { errors.push(`토큰삭제: ${e.message}`); }

  // ── 3. 계약 만료 안내 (D-30 / D-7 / D-1) — 앱 내 알림(무료, 비용 절감) ──
  // #9: 재진입(재시도·수동 재트리거) 시 같은 날 중복 알림 방지용 오늘(KST) 시작 시각.
  const startOfTodayKst = new Date(`${kstDateStr(0)}T00:00:00+09:00`);
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
        const title = `근로계약 만료 D-${offsetDays} 안내`;
        // C(회귀#9 수정): dedup 키를 '계약별'로 — link에 contractId를 넣어 같은 워커가 같은 날 복수 계약이
        //  만료돼도 각 계약 알림이 서로 덮이지 않게 한다. (title만으로 dedup하면 둘째 현장 알림이 누락됐음)
        const link = `/worker/contracts?c=${contract.id}`;

        try {
          // #9: 오늘 이미 '이 계약' 만료 알림을 보냈으면 건너뜀(재진입 중복 방지, 섹션 5/7과 동일 존재검사).
          const dup = await prisma.workerNotice.findFirst({
            where: { workerId: contract.workerId, link, createdAt: { gte: startOfTodayKst } },
            select: { id: true },
          });
          if (dup) continue;

          await prisma.workerNotice.create({
            data: {
              workerId: contract.workerId,
              agencyId: contract.agencyId,
              title,
              body: `사업장: ${siteName}\n계약 종료일: ${contractEndStr}\n재계약이 필요하면 담당 위탁기관로 연락해 주세요.`,
              type: "WARN",
              link,
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
  // #9: 최근 N일 각각에 대해 면제 출근부를 보정 생성(미실행 캐치업). 각 날짜는 existSet/skipDuplicates로 멱등.
  for (const dayStr of lookbackDates) {
    try {
      const [yy, mm, dd] = dayStr.split("-").map(Number);
      const dow = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay(); // 0=일, 6=토
      const isWeekend = dow === 0 || dow === 6;
      const isKrHoliday = Object.prototype.hasOwnProperty.call(getKrHolidays(yy, mm), dayStr);
      if (isWeekend || isKrHoliday) continue;

      // ★배정 기간(startDate~endDate)이 그날을 포함하는 배정만 — 시작 전/종료 후 날짜가 출근부·급여에 들어가던 버그 차단.
      const yStart = new Date(`${dayStr}T00:00:00+09:00`);
      const yEnd = new Date(`${dayStr}T23:59:59+09:00`);
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

      // 배정별 3쿼리 순차(3N) → 일괄 조회 2회 + createMany 1회(함수 타임아웃 방지). 의미 동일.
      const asgIds = exemptAssignments.map((a) => a.id);
      const [holRows, existRows] = await Promise.all([
        prisma.siteHoliday.findMany({
          where: { assignmentId: { in: asgIds }, date: dayStr, countAsWorkday: false },
          select: { assignmentId: true },
        }),
        prisma.dailyAttendance.findMany({
          where: { assignmentId: { in: asgIds }, workDate: dayStr },
          select: { id: true, assignmentId: true, startTime: true, isFinalClosed: true },
        }),
      ]);
      const asgById = new Map(exemptAssignments.map((a) => [a.id.toString(), a]));
      const holSet = new Set(holRows.map((r) => r.assignmentId.toString()));
      const existSet = new Set(existRows.map((r) => r.assignmentId.toString()));
      // ★시각 없는 placeholder(워커가 clock-in 없이 일지만 써서 생긴 행: startTime=null·미확정)는
      //  스킵하지 말고 '채택'한다. 스킵하면 확정행이 영영 안 생겨 그 날이 급여에서 조용히 누락된다
      //  (면제 워커 과소지급). 공휴일/커스텀휴무(holSet)면 채택 안 함=미지급 유지. 이미 확정됐거나
      //  시각 있는 행은 손대지 않는다(실제 clock-in 등).
      const toAdopt = existRows.filter((r) => !r.isFinalClosed && !r.startTime && !holSet.has(r.assignmentId.toString()));
      // 아예 출근행이 없는 배정 = 신규 생성(휴무 제외).
      const toCreate = exemptAssignments.filter((a) => !holSet.has(a.id.toString()) && !existSet.has(a.id.toString()));
      if (toCreate.length) {
        await prisma.dailyAttendance.createMany({
          data: toCreate.map((a) => {
            const times = computeWorkTimes(a.workType, a.commuteGuidanceIncluded, a.customWorkStart, a.customWorkEnd);
            return {
              workerId: a.workerId,
              siteId: a.siteId,
              assignmentId: a.id,
              workDate: dayStr,
              startTime: kstWallTimeToInstant(dayStr, times.start),
              endTime: kstWallTimeToInstant(dayStr, times.end),
              status: "DONE" as const,
              isFinalClosed: true,   // 면제 배정: 워커 확정 불필요 → 자동 확정
              finalizedAt: now,
            };
          }),
          skipDuplicates: true, // (assignmentId,workDate) unique — 동시 실행 안전
        });
      }
      // placeholder 채택: 시각을 채워 확정(면제 표준시각). 건수 적음(당일 일지 먼저 쓴 면제 워커만).
      for (const r of toAdopt) {
        const a = asgById.get(r.assignmentId.toString());
        if (!a) continue;
        const times = computeWorkTimes(a.workType, a.commuteGuidanceIncluded, a.customWorkStart, a.customWorkEnd);
        await prisma.dailyAttendance.update({
          where: { id: r.id },
          data: {
            startTime: kstWallTimeToInstant(dayStr, times.start),
            endTime: kstWallTimeToInstant(dayStr, times.end),
            status: "DONE",
            isFinalClosed: true,
            finalizedAt: now,
          },
        });
      }
      if (toCreate.length || toAdopt.length) {
        exemptCreated += toCreate.length + toAdopt.length;
        detail.exemptCreated.push(
          ...toCreate.map((a) => ({ assignmentId: String(a.id), workerId: String(a.workerId), siteId: String(a.siteId), date: dayStr })),
          ...toAdopt.map((r) => {
            const a = asgById.get(r.assignmentId.toString());
            return { assignmentId: String(r.assignmentId), workerId: String(a?.workerId ?? ""), siteId: String(a?.siteId ?? ""), date: dayStr, adopted: true };
          }),
        );
      }
    } catch (e) { errors.push(`면제출근부[${dayStr}]: ${e instanceof Error ? e.message : String(e)}`); }
  }

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

    // #9(17차): 설정일 '당일'만 매칭하면 그날 배치가 실패/미실행 시 그 달 급여 초안이 통째로 누락됐다.
    //  설정일 '이상'(payrollAutoDay <= todayDay)으로 넓혀, 설정일 이후 첫 실행에서 전월분을 보정 생성한다.
    //  이미 있으면 run 존재검사로 건너뛰므로(멱등) 중복 생성 없음. (설정일 > 이번달 일수는 말일에 대응.)
    const agencies = await prisma.agency.findMany({
      where: {
        isActive: true,
        OR: [{ payrollAutoDay: { lte: todayDay } }, ...(isLastDay ? [{ payrollAutoDay: { gt: daysInMonth } }] : [])],
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

  // ── 6. 만료 배정 자동 종료(ENDED) — endDate 경과한 점유 배정(ACTIVE/CONFIRMED/ASSIGNED)을 ENDED로 전환 ──
  //   endDate가 어제까지인 배정은 오늘부터 '종료'. 상태 자체를 정리해 '현재 배정' 조회·이중배정 점유에서 빠지고,
  //   과거문서 재제출은 ENDED 딥링크/폴백으로 열린다. ASSIGNED/CONFIRMED로 만료된 좀비 배정도 함께 정리(W5).
  //   endDate=오늘(종료 당일)은 아직 근무 중이므로 제외 — cutoff=오늘 00:00 KST 미만만.
  try {
    const todayKstStart = new Date(`${kstDateStr()}T00:00:00+09:00`);
    const EXPIRE_STATUSES = ["ACTIVE", "CONFIRMED", "ASSIGNED"] as const;
    const expired = await prisma.siteAssignment.findMany({
      where: { status: { in: [...EXPIRE_STATUSES] }, endDate: { lt: todayKstStart } }, // null endDate는 lt에 매칭 안 됨(무기한 유지)
      select: { id: true, workerId: true, endDate: true, site: { select: { companyName: true } } },
    });
    if (expired.length) {
      const res = await prisma.siteAssignment.updateMany({
        where: { id: { in: expired.map(a => a.id) }, status: { in: [...EXPIRE_STATUSES] } },
        data: { status: "ENDED", endedAt: now, statusReason: "계약기간 종료(자동)" },
      });
      assignmentsEnded = res.count;
      detail.assignmentsEnded = expired.map(a => ({
        assignmentId: a.id.toString(),
        workerId: a.workerId.toString(),
        site: a.site?.companyName ?? null,
        endDate: a.endDate ? a.endDate.toISOString().slice(0, 10) : null,
      }));
    }
  } catch (e: any) { errors.push(`배정 자동종료: ${e.message}`); }

  // ── 감사로그(변경주체=시스템): 데이터 변경이 있었던 배치만 요약 1건 기록. 상세는 payload에 처리 내역 전량. ──
  try {
    const changed = autoConfirmed + missedFlagged + exemptCreated + payrollDrafted + surveysExpired + expiryNotified + surveysSent + remindAgencies + tokensCleared + assignmentsEnded;
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
      if (assignmentsEnded) parts.push(`배정 자동종료 ${assignmentsEnded}`);
      if (tokensCleared) parts.push(`만료 토큰 삭제 ${tokensCleared}`);
      const payload: Record<string, unknown> = {
        date: yesterday,
        counts: { autoConfirmed, missedFlagged, exemptCreated, payrollDrafted, surveysExpired, surveysSent, expiryNotified, remindAgencies, assignmentsEnded, tokensCleared },
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

  console.log(`[CRON] ${yesterday} 자동확정:${autoConfirmed} 퇴근미실행:${missedFlagged} 토큰삭제:${tokensCleared} 만료알림:${expiryNotified} 면제생성:${exemptCreated} 만족도:${surveysSent} 평가만료:${surveysExpired} 급여초안:${payrollDrafted} 진척독려:${remindAgencies} 배정종료:${assignmentsEnded}`, errors);

  return NextResponse.json({
    success: true, yesterday,
    autoConfirmed, missedFlagged, tokensCleared, expiryNotified, exemptCreated, surveysSent, payrollDrafted, remindAgencies, assignmentsEnded,
    errors,
  });
}
