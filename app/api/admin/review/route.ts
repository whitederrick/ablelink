export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { readAdminSessionFromRequest } from "@/lib/adminCookies";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await readAdminSessionFromRequest(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const yearMonth = searchParams.get("yearMonth") ?? "";
    if (!/^\d{4}-\d{2}$/.test(yearMonth))
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });

    const [y, m] = yearMonth.split("-").map(Number);
    const dateFrom = `${yearMonth}-01`;
    const dateTo   = `${yearMonth}-${new Date(y, m, 0).getDate().toString().padStart(2, "0")}`;

    // 에이전시 스코프 결정
    const agencyFilter = session.agencyId ? { agencyId: BigInt(session.agencyId) } : {};

    // 배정된 직무지도원 목록 조회
    const assignments = await prisma.siteAssignment.findMany({
      where: {
        ...agencyFilter,
        status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
      },
      select: {
        id: true,
        user: { select: { id: true, userName: true, phoneNumber: true } },
        site: { select: { companyName: true } },
      },
      orderBy: { assignedAt: "desc" },
    });

    // 유니크 유저만 (중복 배정 제거)
    const seen = new Set<string>();
    const users = assignments.filter(a => {
      const key = a.user.id.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 각 유저별 통계를 병렬 조회
    const rows = await Promise.all(
      users.map(async ({ user, site }) => {
        const uid = user.id;

        const [attTotal, attConfirmed, logTotal, logConfirmed, evalTotal, evalConfirmed] =
          await Promise.all([
            // 출근부 전체 (해당 월 출근 기록)
            prisma.dailyAttendance.count({
              where: { userId: uid, workDate: { gte: dateFrom, lte: dateTo }, startTime: { not: null } },
            }),
            // 출근부 확정
            prisma.dailyAttendance.count({
              where: { userId: uid, workDate: { gte: dateFrom, lte: dateTo }, isFinalClosed: true },
            }),
            // 일지 전체
            prisma.traineeLog.count({
              where: { writerId: uid, attendance: { workDate: { gte: dateFrom, lte: dateTo } } },
            }),
            // 일지 확정
            prisma.traineeLog.count({
              where: { writerId: uid, isCompleted: true, attendance: { workDate: { gte: dateFrom, lte: dateTo } } },
            }),
            // 평가 전체
            prisma.traineeEvaluation.count({
              where: { writerId: uid, periodStart: { gte: dateFrom }, periodEnd: { lte: dateTo } },
            }),
            // 평가 확정
            prisma.traineeEvaluation.count({
              where: { writerId: uid, isConfirmed: true, periodStart: { gte: dateFrom }, periodEnd: { lte: dateTo } },
            }),
          ]);

        return {
          userId:       uid.toString(),
          userName:     user.userName,
          phoneNumber:  user.phoneNumber,
          siteName:     site?.companyName ?? "-",
          attendance:   { total: attTotal,  confirmed: attConfirmed },
          logs:         { total: logTotal,  confirmed: logConfirmed },
          evaluations:  { total: evalTotal, confirmed: evalConfirmed },
        };
      })
    );

    return NextResponse.json({ success: true, yearMonth, rows });
  } catch (e: any) {
    console.error("[admin/review]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
