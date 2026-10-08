// lib/worker/missingLogs.ts
// 직무지도원 기준 "미작성 일지" 판정 — 훈련생 단위. 하루가 통째로 비어야만 잡던 예전 로직은
// 1:多 배정에서 일부 훈련생만 작성한 날의 누락을 영구히 놓쳤다(app/worker/home 요약·
// /worker/logs/missing 페이지 두 곳이 각자 다르게 부실했음 — 여기로 단일화).

import { prisma } from "@/lib/prisma";
import { effectiveTrainingType } from "@/lib/serviceStep";
import { getKstDateString } from "@/lib/time";

export interface MissingLogItem {
  attendanceId: string;
  workDate: string;
  siteName: string;
  trainingType: "PRE" | "FIELD" | "ADAPTATION";
  trainees: { id: string; name: string; gender: string; draftLogId?: string }[]; // draftLogId=임시저장 일지(이어쓰기용). 이 날짜에 아직 완료 일지가 없는 훈련생만
}

// toDate 기본값 = 오늘(KST). 미래 일지 사전 작성(f6004db)이 미래 날짜에 placeholder 출근기록을 만들므로 상한이 없으면
//  미리 써 둔 날(임시저장·1:多 일부 완료)이 "미작성"으로 잡히고, 날짜 내림차순+take 제한 때문에 미래 날짜가
//  앞줄을 차지해 실제로 밀린 과거 일지를 목록 밖으로 밀어냈다(2026-10-08 감사 P2).
export async function getMissingLogItems(
  workerId: bigint, fromDate: string, take = 30, toDate: string = getKstDateString(),
): Promise<MissingLogItem[]> {
  const attendances = await prisma.dailyAttendance.findMany({
    where: { workerId, workDate: { gte: fromDate, lte: toDate } },
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
      // 완료된 일지만 "작성됨"으로 인정 — 임시저장(isCompleted:false)은 여전히 미작성 취급(단 이어쓰기용 id는 전달).
      logs: { where: { writerId: workerId }, select: { id: true, traineeId: true, isCompleted: true } },
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
    const doneIds = new Set(a.logs.filter(l => l.isCompleted).map(l => l.traineeId.toString()));
    const draftIds = new Map(a.logs.filter(l => !l.isCompleted).map(l => [l.traineeId.toString(), l.id.toString()]));
    const missingTrainees = scopedTrainees.filter(t => !doneIds.has(t.id.toString()));
    if (missingTrainees.length === 0) continue;

    items.push({
      attendanceId: a.id.toString(),
      workDate: a.workDate,
      siteName: a.site.companyName,
      trainingType,
      trainees: missingTrainees.map(t => ({ id: t.id.toString(), name: t.name, gender: t.gender, ...(draftIds.has(t.id.toString()) ? { draftLogId: draftIds.get(t.id.toString()) } : {}) })),
    });
    if (items.length >= take) break;
  }
  return items;
}
