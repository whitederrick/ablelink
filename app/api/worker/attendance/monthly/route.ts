export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { computeAbsentDates } from "@/lib/attendance/absentDays";
import { getKstDateString } from "@/lib/time";
import { resolveWorkerAssignment } from "@/lib/worker/assignmentResolve";

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

    // ★표시용 출근기록 = workerId 전체(그 달 모든 배정, ENDED 포함) — 월중 현장전환 시 이전(종료) 배정
    //  기록이 화면에서 사라지던 회귀 방지. 결근 합성만 오늘 활성 배정으로 스코프(아래).
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

    // ── 결근일 합성 (캘린더 RED와 동일 규칙, 공용 lib/attendance/absentDays) ──
    // 결근은 '오늘 활성 배정'의 근무기간 내에서만 합성. 낡은 쿠키가 ENDED를 가리키면 최신 활성으로 폴백.
    //  존재기록(existingDates)은 workerId 전체라, 다른 배정에 기록이 있는 날은 결근으로 잡히지 않음(오결근 방지).
    const rawSel = new URL(req.url).searchParams.get("assignmentId");
    const candidates = await prisma.siteAssignment.findMany({
      where: { workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } },
      select: { id: true, status: true, startDate: true, endDate: true },
    });
    const lite = candidates.map((c) => ({
      id: c.id.toString(),
      status: c.status,
      startDate: getKstDateString(c.startDate),
      endDate: c.endDate ? getKstDateString(c.endDate) : null,
    }));
    const resolved = resolveWorkerAssignment({ requestedId: rawSel, allowEnded: false, assignments: lite, todayStr: getKstDateString() });
    const active = resolved.assignmentId ? lite.find((a) => a.id === resolved.assignmentId) ?? null : null;

    if (active) {
      const customRows = await prisma.siteHoliday.findMany({
        where: { assignmentId: BigInt(active.id), date: { gte: dateFrom, lte: dateTo } },
        select: { date: true },
      });
      const absents = computeAbsentDates({
        from: dateFrom, to: dateTo,
        assignStart: active.startDate,
        assignEnd: active.endDate,
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
