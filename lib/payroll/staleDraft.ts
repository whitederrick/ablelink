// lib/payroll/staleDraft.ts
// 급여 초안(DRAFT)을 계산한 뒤 입력(근태·연차 사용)이 바뀌었는지 판정 — 확정 직전 경고용.
//
// 2026-10-08 감사 P2: 계산과 확정 사이에 근태 수정 승인·연차 승인이 들어와도 경고가 없어, 낡은 금액으로 명세서가
//  발급·확정됐다(확정 후엔 수정 불가). 초안의 계산 시각은 run.createdAt(재계산은 초안을 지우고 새로 만든다)이다.
//  근태는 급여가 읽는 행(최종 마감·출근시각 있음)만 센다 — 진행 중인 행의 단순 갱신으로 오탐하지 않게.

import type { PrismaClient } from "@prisma/client";

export type StaleInputs = { attendance: number; leave: number; total: number };

export async function countStaleInputs(
  db: Pick<PrismaClient, "dailyAttendance" | "annualLeaveEntry">,
  p: { agencyId: bigint; yearMonth: string; since: Date },
): Promise<StaleInputs> {
  const [y, m] = p.yearMonth.split("-").map(Number);
  const first = `${p.yearMonth}-01`;
  const last = `${p.yearMonth}-31`; // 문자열 비교 상한(존재하지 않는 날짜여도 31일 이하 전부 포함)
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 0));

  const [attendance, leave] = await Promise.all([
    db.dailyAttendance.count({
      where: {
        assignment: { agencyId: p.agencyId },
        workDate: { gte: first, lte: last },
        isFinalClosed: true,
        startTime: { not: null },
        updatedAt: { gt: p.since },
      },
    }),
    db.annualLeaveEntry.count({
      where: {
        agencyId: p.agencyId, kind: "USE",
        effectiveDate: { gte: monthStart, lte: monthEnd },
        createdAt: { gt: p.since },
      },
    }),
  ]);
  return { attendance, leave, total: attendance + leave };
}

export function staleDraftMessage(s: StaleInputs): string {
  const parts: string[] = [];
  if (s.attendance > 0) parts.push(`근태 ${s.attendance}건`);
  if (s.leave > 0) parts.push(`연차 사용 ${s.leave}건`);
  return `급여를 계산한 뒤 ${parts.join("·")}이 변경되었습니다. 다시 계산하지 않으면 변경분이 급여에 반영되지 않습니다.`;
}
