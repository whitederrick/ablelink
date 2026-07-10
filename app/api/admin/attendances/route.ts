// app/api/admin/attendances/route.ts
// 관리자(위탁기관) - 직무지도원별 출퇴근(근태) 현황 조회 API
//
// GET /api/admin/attendances?workerId=1&from=2026-01-01&to=2026-01-31&page=1&pageSize=50
// GET /api/admin/attendances?yearMonth=2026-01&workerId=1
//
// ✅ 스코프(고도화)
// - AGENCY: (A) assignmentId가 있으면 assignment.site.agencyId 기준으로 제한(정식)
//          (B) assignmentId가 null인 레거시 데이터는 site.agencyId 기준으로 fallback 제한
//          (C) 기간(from/to 또는 yearMonth)이 있으면 assignment 기간과 오버랩되는 것만 포함(보수적)
// - ADMIN: 전체 조회 가능
// - GOV: 현재 차단(FORBIDDEN)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession, requireAdminOrManagerSession } from "@/lib/managerScope";
import { Prisma } from "@prisma/client";
import { logCompletionStatus } from "@/lib/docs/logCompletion";
import { computeAbsentDates } from "@/lib/attendance/absentDays";
import { getKstDateString } from "@/lib/time";

// "YYYY-MM" → 그 달의 실제 마지막 날 "YYYY-MM-DD". (과거 `${yearMonth}-31` 하드코딩은 2/4/6/9/11월에서
//  다음 달로 넘쳐 결근 합성이 유령 ABSENT 행을 만들었다.)
function monthEndStr(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 = 그 달(m, 1-indexed)의 말일
  return `${yearMonth}-${String(last).padStart(2, "0")}`;
}

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function isDateOnly(s: string) {
  // YYYY-MM-DD
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s);
}

function isYearMonth(s: string) {
  // YYYY-MM
  return /^[0-9]{4}-[0-9]{2}$/.test(s);
}


function asIso(d: any) {
  return d?.toISOString?.() ?? d ?? null;
}

function toItem(r: any) {
  return {
    id: String(r.id),
    workerId: String(r.workerId),
    siteId: String(r.siteId),

    // 증빙(있으면)
    assignmentId: r.assignmentId != null ? String(r.assignmentId) : null,
    basePointId: r.basePointId != null ? String(r.basePointId) : null,

    workDate: r.workDate,

    startTime: asIso(r.startTime),
    // 실제 출/퇴근 버튼 누른 시각(등록시각). startTime/endTime은 출근부용 표준 고정시각.
    actualStartTime: asIso(r.actualStartTime),
    startLocLat: r.startLocLat != null ? String(r.startLocLat) : null,
    startLocLon: r.startLocLon != null ? String(r.startLocLon) : null,

    endTime: asIso(r.endTime),
    actualEndTime: asIso(r.actualEndTime),
    endLocLat: r.endLocLat != null ? String(r.endLocLat) : null,
    endLocLon: r.endLocLon != null ? String(r.endLocLon) : null,

    startDistanceM: r.startDistanceM ?? null,
    endDistanceM: r.endDistanceM ?? null,
    withinRange: r.withinRange ?? null,
    rangeM: r.rangeM ?? null,

    isGpsModified: Boolean(r.isGpsModified),
    status: r.status,
    isFinalClosed: Boolean(r.isFinalClosed),
    finalizedAt: asIso(r.finalizedAt),

    // 일지 상태(대시보드 '일지 미완료'와 동일 기준): 미작성(none)·임시저장(draft)·완료(done)
    // 완료 = 그 현장 배정 훈련생 전원 완료(공용 lib/docs/logCompletion). none/draft = 미완료.
    logStatus: logCompletionStatus(Array.isArray(r.logs) ? r.logs : [], r.site?.trainees?.length ?? 0),

    site: r.site
      ? {
          id: String(r.site.id),
          companyName: r.site.companyName,
          address: r.site.address,
          agencyId: r.site.agencyId != null ? String(r.site.agencyId) : null,
        }
      : null,

    user: r.user
      ? {
          id: String(r.user.id),
          workerName: r.user.workerName,
          loginId: r.user.loginId,
          phoneNumber: r.user.phoneNumber,
          role: r.user.role,
          status: r.user.status,
        }
      : null,

    assignment: r.assignment
      ? {
          id: String(r.assignment.id),
          status: r.assignment.status,
          startDate: asIso(r.assignment.startDate),
          endDate: asIso(r.assignment.endDate),
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    // 듀얼: 운영자(admin)는 전체 기관, 매니저는 본인 기관으로 스코프.
    // (운영자 콘솔은 x-admin-context:1 헤더로 admin 우선)
    const session = await requireAdminOrManagerSession(req);

    const { searchParams } = new URL(req.url);

    const userIdStr = (searchParams.get("workerId") || "").trim();
    const siteIdStr = (searchParams.get("siteId") || "").trim();

    const from = (searchParams.get("from") || "").trim();
    const to = (searchParams.get("to") || "").trim();
    const yearMonth = (searchParams.get("yearMonth") || "").trim();

    const pageStr = (searchParams.get("page") || "1").trim();
    const pageSizeStr = (searchParams.get("pageSize") || "50").trim();

    if (!isValidNumericId(pageStr)) throw new Error("VALIDATION:page");
    if (!isValidNumericId(pageSizeStr)) throw new Error("VALIDATION:pageSize");

    const page = Math.max(1, Number(pageStr));
    const pageSize = Math.min(200, Math.max(1, Number(pageSizeStr)));
    const skip = (page - 1) * pageSize;

    // 매니저는 본인 agency로 제한, 운영자(admin)는 전체(undefined)
    const agencyId: bigint | undefined = session.kind === "manager" ? session.agencyId : undefined;

    // 기간 형식 검증(실제 필터는 아래 where.workDate에서 from/to 문자열로 적용)
    if (from || to) {
      if (from && !isDateOnly(from)) throw new Error("VALIDATION:from");
      if (to && !isDateOnly(to)) throw new Error("VALIDATION:to");
    } else if (yearMonth) {
      if (!isYearMonth(yearMonth)) throw new Error("VALIDATION:yearMonth");
    }

    const where: Prisma.DailyAttendanceWhereInput = {};

    if (userIdStr) {
      if (!isValidNumericId(userIdStr)) throw new Error("VALIDATION:workerId");
      where.workerId = BigInt(userIdStr);
    }

    if (siteIdStr) {
      if (!isValidNumericId(siteIdStr)) throw new Error("VALIDATION:siteId");
      where.siteId = BigInt(siteIdStr);
    }

    // 날짜 필터: workDate가 "YYYY-MM-DD" 문자열이므로 문자열 범위로 필터
    if (from || to) {
      if (from && to) where.workDate = { gte: from, lte: to };
      else if (from) where.workDate = { gte: from };
      else if (to) where.workDate = { lte: to };
    } else if (yearMonth) {
      const start = `${yearMonth}-01`;
      const end = monthEndStr(yearMonth);
      where.workDate = { gte: start, lte: end };
    }

    // ✅ AGENCY 스코프 — assignment.agencyId 기준으로 단순 필터
    if (agencyId) {
      where.assignment = { agencyId };
    }

    const [total, rows] = await Promise.all([
      prisma.dailyAttendance.count({ where }),
      prisma.dailyAttendance.findMany({
        where,
        orderBy: [{ workDate: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          workerId: true,
          siteId: true,

          assignmentId: true,
          basePointId: true,

          workDate: true,
          startTime: true,
          actualStartTime: true,
          startLocLat: true,
          startLocLon: true,
          endTime: true,
          actualEndTime: true,
          endLocLat: true,
          endLocLon: true,

          startDistanceM: true,
          endDistanceM: true,
          withinRange: true,
          rangeM: true,

          isGpsModified: true,
          status: true,
          isFinalClosed: true,
          finalizedAt: true,
          logs: { select: { isCompleted: true, traineeId: true } },

          site: { select: { id: true, companyName: true, address: true, agencyId: true, trainees: { where: { status: { in: ["TRAINING", "EMPLOYED"] } }, select: { id: true } } } },
          user: { select: { id: true, workerName: true, loginId: true, phoneNumber: true, role: true, status: true } },
          assignment: { select: { id: true, status: true, startDate: true, endDate: true } },
        },
      }),
    ]);

    // ── 결근(미출근) 합성 ──────────────────────────────────────────
    // 배정 근무일 중 출근기록 없는 평일을 ABSENT 항목으로 추가(워커 캘린더와 동일 규칙, lib/attendance/absentDays).
    // 월별현황 그리드에서 결근을 '미출근'(rose)으로 표시하기 위함. 목록/지도 뷰는 클라에서 synthetic 제외.
    const period = (from && to) ? { from, to }
      : yearMonth ? { from: `${yearMonth}-01`, to: monthEndStr(yearMonth) } : null;
    const absentItems: any[] = [];
    if (period) {
      const todayStr = getKstDateString();
      const activeAssigns = await prisma.siteAssignment.findMany({
        where: {
          status: "ACTIVE",
          ...(agencyId ? { agencyId } : {}),
          ...(userIdStr ? { workerId: BigInt(userIdStr) } : {}),
          ...(siteIdStr ? { siteId: BigInt(siteIdStr) } : {}),
          startDate: { lte: new Date(period.to + "T23:59:59+09:00") },
          OR: [{ endDate: null }, { endDate: { gte: new Date(period.from + "T00:00:00+09:00") } }],
        },
        select: {
          id: true, workerId: true, siteId: true, startDate: true, endDate: true, attendanceButtonExempt: true,
          user: { select: { workerName: true } }, site: { select: { companyName: true } },
        },
      });
      if (activeAssigns.length > 0) {
        // 기간 내 실제 출근기록 전체(페이지 무관) — 결근 오탐 방지용 existing 집합.
        const existRows = await prisma.dailyAttendance.findMany({ where, select: { workerId: true, workDate: true } });
        const existByWorker = new Map<string, Set<string>>();
        for (const e of existRows) {
          const k = String(e.workerId);
          (existByWorker.get(k) ?? existByWorker.set(k, new Set()).get(k)!).add(e.workDate);
        }
        // #12(3번째 호출부): countAsWorkday=true(근무 인정 대체일)는 급여가 소정근로일로 집계하므로
        //  결근 제외 대상이 아니다 — 필터 없으면 매니저 근태 그리드가 그날 미출근을 은폐(캘린더/월별/급여와 불일치).
        const custRows = await prisma.siteHoliday.findMany({
          where: { assignmentId: { in: activeAssigns.map(a => a.id) }, date: { gte: period.from, lte: period.to }, countAsWorkday: false },
          select: { assignmentId: true, date: true },
        });
        const custByAssign = new Map<string, Set<string>>();
        for (const c of custRows) {
          const k = String(c.assignmentId);
          (custByAssign.get(k) ?? custByAssign.set(k, new Set()).get(k)!).add(c.date);
        }
        const kstDateStr = (d: Date) => new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
        const seen = new Set<string>(); // workerId|date 중복 방지(다현장)
        for (const a of activeAssigns) {
          const absents = computeAbsentDates({
            from: period.from, to: period.to,
            assignStart: kstDateStr(a.startDate),
            assignEnd: a.endDate ? kstDateStr(a.endDate) : null,
            todayStr,
            existingDates: existByWorker.get(String(a.workerId)) ?? new Set(),
            customHolidays: custByAssign.get(String(a.id)),
            // D(#14): 면제 배정은 오늘 결근 판정 제외(워커 캘린더·월별과 통일).
            exemptToday: a.attendanceButtonExempt,
          });
          for (const d of absents) {
            const dedup = `${a.workerId}|${d}`;
            if (seen.has(dedup)) continue;
            seen.add(dedup);
            absentItems.push({
              id: `absent-${a.id}-${d}`,
              workerId: String(a.workerId), siteId: String(a.siteId), assignmentId: String(a.id),
              workDate: d,
              startTime: null, actualStartTime: null, startLocLat: null, startLocLon: null,
              endTime: null, actualEndTime: null, endLocLat: null, endLocLon: null,
              startDistanceM: null, endDistanceM: null, withinRange: null, rangeM: null,
              isGpsModified: false, status: "ABSENT", isFinalClosed: false, finalizedAt: null,
              logStatus: "none", synthetic: true,
              site: { id: String(a.siteId), companyName: a.site?.companyName ?? "-", address: null, agencyId: null },
              user: { id: String(a.workerId), workerName: a.user?.workerName ?? "-", loginId: "", phoneNumber: "", role: "WORKER", status: "ACTIVE" },
            });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      items: [...rows.map(toItem), ...absentItems],
    });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}