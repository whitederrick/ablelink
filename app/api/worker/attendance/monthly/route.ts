export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { getKrHolidays } from "@/lib/krHolidays";

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

    const rows = await prisma.dailyAttendance.findMany({
      where: { workerId, workDate: { gte: dateFrom, lte: dateTo } },
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

    // ── 결근일 합성 (캘린더 RED와 동일 규칙) ──
    // ACTIVE 배정 범위 내 · 오늘 이하 · 휴무(공휴일+커스텀) 제외 · 출근기록 없는 날을 '미출근'으로 추가.
    // (캘린더는 이 날들을 RED로 표시하지만 출근부 검토는 레코드만 세어 '미출근' 수가 어긋났음)
    const assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    });
    if (assignment) {
      const nationalHolidays = getKrHolidays(y, m);
      const customRows = await prisma.siteHoliday.findMany({
        where: { assignmentId: assignment.id, date: { gte: dateFrom, lte: dateTo } },
        select: { date: true },
      });
      const holidays = new Set<string>([...Object.keys(nationalHolidays), ...customRows.map(r => r.date)]);
      const existing = new Set(records.map(r => r.workDate));

      const todayStr = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const assignStart = assignment.startDate.toISOString().slice(0, 10);
      const assignEnd = assignment.endDate ? assignment.endDate.toISOString().slice(0, 10) : todayStr;
      const redFrom = assignStart > dateFrom ? assignStart : dateFrom;
      const redTo   = assignEnd   < todayStr ? assignEnd   : todayStr; // 오늘 포함, 미래 제외

      const cur = new Date(redFrom + "T00:00:00");
      const end = new Date(redTo   + "T00:00:00");
      while (cur <= end) {
        const key = cur.toISOString().slice(0, 10);
        // 요일은 key 문자열에서 직접 파생(서버 TZ 무관). 주말(토·일)·휴무는 결근 아님 → 미출근 합성 제외.
        const [ky, km, kd] = key.split("-").map(Number);
        const dow = new Date(ky, km - 1, kd).getDay();
        if (key >= dateFrom && key <= dateTo && !existing.has(key) && !holidays.has(key) && dow !== 0 && dow !== 6) {
          records.push({
            id: `absent-${key}`, workDate: key, startTime: "", endTime: "",
            isFinalClosed: false, isManagerFinalClosed: false, isGpsModified: false,
            status: "ABSENT", correctionRequested: false,
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
      records.sort((a, b) => a.workDate.localeCompare(b.workDate));
    }

    return NextResponse.json({ success: true, records });
  } catch (e: any) {
    console.error("[attendance/monthly]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
