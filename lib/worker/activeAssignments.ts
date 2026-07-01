// lib/worker/activeAssignments.ts
// 오늘(KST) 근무 가능한 워커의 활성 배정 목록 — 멀티 현장 선택 화면·활성 배정 API 공용 출처.
// buildHomeSummary의 todayActive와 동일 기준(status ACTIVE + 오늘 기간겹침)으로 일관성 유지.

import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";

export interface ActiveAssignmentItem {
  assignmentId: string;
  siteId: string | null;
  siteName: string;
  agencyName: string;
  workType: string; // AM | PM | FULL_DAY | CUSTOM
  traineeCount: number;
}

/** 오늘(KST) 활성(ACTIVE·기간겹침) 배정 목록. 근무형태·id 순 정렬(오전이 오후보다 앞). */
export async function getTodayActiveAssignments(workerId: bigint): Promise<ActiveAssignmentItem[]> {
  const today = getKstDateString();
  const rows = await prisma.siteAssignment.findMany({
    where: { workerId, status: "ACTIVE" },
    include: {
      site: { include: { trainees: { where: { status: { in: ["TRAINING", "EMPLOYED"] } }, select: { id: true } } } },
      agency: { select: { name: true } },
    },
    orderBy: [{ workType: "asc" }, { id: "asc" }],
  });
  const kstDateStr = (d: Date) => new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
  return rows
    .filter((a) =>
      (!a.startDate || kstDateStr(a.startDate) <= today) &&
      (!a.endDate || kstDateStr(a.endDate) >= today)
    )
    .map((a) => ({
      assignmentId: String(a.id),
      siteId: a.site?.id ? String(a.site.id) : null,
      siteName: a.site?.companyName ?? "현장",
      agencyName: a.agency?.name ?? "",
      workType: a.workType ?? "FULL_DAY",
      traineeCount: a.site?.trainees?.length ?? 0,
    }));
}
