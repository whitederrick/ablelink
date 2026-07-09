export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { computeAbsentDates } from "@/lib/attendance/absentDays";
import { getKstDateString } from "@/lib/time";

function fmtKST(d: Date | null): string {
  if (!d) return "";
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

type Rec = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  isFinalClosed: boolean;
  isManagerFinalClosed: boolean;
  isGpsModified: boolean;
  status: string;
  correctionRequested: boolean;
};

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const yearMonth = new URL(req.url).searchParams.get("yearMonth") ?? "";
    if (!/^\d{4}-\d{2}$/.test(yearMonth))
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });

    const [y, m] = yearMonth.split("-").map(Number);
    const dateFrom = `${yearMonth}-01`;
    const dateTo   = `${yearMonth}-${new Date(y, m, 0).getDate().toString().padStart(2, "0")}`;
    const workerId = BigInt(session.workerId);

    // ★멀티현장: 선택 배정(쿠키/파라미터 assignmentId, 소유+ACTIVE)으로 스코프, 무효/미지정이면 최신 활성 폴백.
    //  과거엔 출근기록은 workerId 전체·결근 합성은 임의 배정 기준이라 멀티현장에서 잘못된 결근/기록이 섞였다.
    const rawSel = new URL(req.url).searchParams.get("assignmentId");
    let selId: bigint | null = null;
    try { selId = rawSel ? BigInt(rawSel) : null; } catch { selId = null; }
    let assignment = selId != null
      ? await prisma.siteAssignment.findFirst({ where: { id: selId, workerId, status: "ACTIVE" } })
      : null;
    if (!assignment) {
      assignment = await prisma.siteAssignment.findFirst({ where: { workerId, status: "ACTIVE" }, orderBy: { startDate: "desc" } });
    }

    const rows = await prisma.dailyAttendance.findMany({
      where: assignment
        ? { assignmentId: assignment.id, workDate: { gte: dateFrom, lte: dateTo } }
        : { workerId, workDate: { gte: dateFrom, lte: dateTo } },
      orderBy: { workDate: "asc" },
    });

    const records: Rec[] = rows.map(r => ({
      id:            r.id.toString(),
      workDate:      r.workDate,
      startTime:     fmtKST(r.startTime),
      endTime:       fmtKST(r.endTime),
      isFinalClosed: r.isFinalClosed,
      // 매니저 최종확정(잠금) — 워커 검토 화면에서 '확정/잠금'으로 취급(미확정 오표기 방지)
      isManagerFinalClosed: (r as any).isManagerFinalClosed ?? false,
      isGpsModified: r.isGpsModified,
      status:        r.status,
      // 관리자가 이 날 시각 보정을 요청했는지(미확정 상태에서만 의미). 워커 검토 화면 강조용.
      correctionRequested: !!r.correctionRequestedAt && !r.payrollConfirmedAt,
    }));

    // ── 결근일 합성 (캘린더 RED와 동일 규칙, 공용 lib/attendance/absentDays) ──
    // 위에서 선택 배정(assignment)으로 스코프한 records 기준. ACTIVE 배정 범위 내 · 오늘 이하 · 휴무 제외 · 평일 · 출근기록 없는 날.
    if (assignment) {
      const customRows = await prisma.siteHoliday.findMany({
        where: { assignmentId: assignment.id, date: { gte: dateFrom, lte: dateTo } },
        select: { date: true },
      });
      const kstDateStr = (d: Date) => new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
      const absents = computeAbsentDates({
        from: dateFrom, to: dateTo,
        assignStart: kstDateStr(assignment.startDate),
        assignEnd: assignment.endDate ? kstDateStr(assignment.endDate) : null,
        todayStr: getKstDateString(),
        existingDates: new Set(records.map(r => r.workDate)),
        customHolidays: new Set(customRows.map(r => r.date)),
      });
      for (const key of absents) {
        records.push({
          id: `absent-${key}`, workDate: key, startTime: "", endTime: "",
          isFinalClosed: false, isManagerFinalClosed: false, isGpsModified: false,
          status: "ABSENT", correctionRequested: false,
        });
      }
      records.sort((a, b) => a.workDate.localeCompare(b.workDate));
    }

    return NextResponse.json({ success: true, records });
  } catch (e: any) {
    console.error("[attendance/monthly]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
