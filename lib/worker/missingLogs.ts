// lib/worker/missingLogs.ts
// 직무지도원 기준 "미작성 일지" 판정 — 훈련생 단위. 하루가 통째로 비어야만 잡던 예전 로직은
// 1:多 배정에서 일부 훈련생만 작성한 날의 누락을 영구히 놓쳤다(app/worker/home 요약·
// /worker/logs/missing 페이지 두 곳이 각자 다르게 부실했음 — 여기로 단일화).

import { prisma } from "@/lib/prisma";
import { effectiveTrainingType } from "@/lib/serviceStep";

export interface MissingLogItem {
  attendanceId: string;
  workDate: string;
  siteName: string;
  trainingType: "PRE" | "FIELD" | "ADAPTATION";
  trainees: { id: string; name: string; gender: string }[]; // 이 날짜에 아직 완료 일지가 없는 훈련생만
}

export async function getMissingLogItems(workerId: bigint, fromDate: string, take = 30): Promise<MissingLogItem[]> {
  const attendances = await prisma.dailyAttendance.findMany({
    where: { workerId, workDate: { gte: fromDate } },
    include: {
      site: {
        select: {
          companyName: true,
          agencyId: true, // 공유현장 크로스테넌트 PII 스코프 판정용(아래)
          trainees: {
            where: { status: { in: ["TRAINING", "EMPLOYED"] } },
            select: { id: true, name: true, gender: true },
          },
        },
      },
      assignment: { select: { serviceStep: true, adaptationStartDate: true, agencyId: true } },
      // 완료된 일지만 "작성됨"으로 인정 — 임시저장(isCompleted:false)은 여전히 미작성 취급.
      logs: { where: { writerId: workerId, isCompleted: true }, select: { traineeId: true } },
    },
    orderBy: { workDate: "desc" },
  });

  const items: MissingLogItem[] = [];
  for (const a of attendances) {
    const trainingType = effectiveTrainingType(a.assignment?.serviceStep, a.assignment?.adaptationStartDate, a.workDate);
    // 공유(divergent) 현장 크로스테넌트 PII 차단(2026-07-21 감사 P2)과 동일 정책: 배정 기관과 현장 소유
    // 기관이 일치할 때만 훈련생 노출. 불일치·null이면 빈 목록(fail-closed).
    const asgAgencyId = a.assignment?.agencyId;
    const scopedTrainees = asgAgencyId != null && a.site.agencyId === asgAgencyId ? a.site.trainees : [];
    const doneIds = new Set(a.logs.map(l => l.traineeId.toString()));
    const missingTrainees = scopedTrainees.filter(t => !doneIds.has(t.id.toString()));
    if (missingTrainees.length === 0) continue;

    items.push({
      attendanceId: a.id.toString(),
      workDate: a.workDate,
      siteName: a.site.companyName,
      trainingType,
      trainees: missingTrainees.map(t => ({ id: t.id.toString(), name: t.name, gender: t.gender })),
    });
    if (items.length >= take) break;
  }
  return items;
}
