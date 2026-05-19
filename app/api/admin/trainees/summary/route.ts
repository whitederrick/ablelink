// app/api/admin/trainees/summary/route.ts
// 훈련생 현황 조회 API (읽기 전용, Site별 그룹핑)

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // 활성 배정된 Site별 훈련생 현황
    const assignments = await prisma.siteAssignment.findMany({
      where: { status: "ACTIVE" },
      include: {
        site: {
          include: {
            trainees: {
              include: {
                logs: {
                  select: { id: true, isCompleted: true, attendance: { select: { workDate: true } } },
                  orderBy: { id: "desc" },
                },
              },
            },
          },
        },
        user: { select: { userName: true } },
      },
      orderBy: { siteId: "asc" },
    });

    // Site별 중복 제거
    const siteMap = new Map<string, any>();

    for (const assignment of assignments) {
      const site = assignment.site;
      if (!site) continue;
      const siteId = site.id.toString();

      if (!siteMap.has(siteId)) {
        siteMap.set(siteId, {
          siteId,
          siteName: site.companyName,
          coachName: assignment.user?.userName || "-",
          trainees: site.trainees.map(t => {
            const completedLogs = t.logs.filter(l => l.isCompleted);
            const lastLog = completedLogs[0];
            return {
              id: t.id.toString(),
              name: t.name,
              gender: t.gender,
              disabilityType: t.disabilityType || "-",
              severity: t.severity || "-",
              status: t.status,
              logCount: completedLogs.length,
              lastLogDate: lastLog?.attendance?.workDate ?? null,
            };
          }),
        });
      }
    }

    const data = Array.from(siteMap.values());

    return NextResponse.json({ success: true, data, total: data.reduce((s, d) => s + d.trainees.length, 0) });
  } catch (error: any) {
    console.error("[admin/trainees/summary]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
