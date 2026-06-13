// app/api/worker/docs/context/route.ts
// 문서조회/생성 화면용 경량 컨텍스트 — 서비스단계(trainingType) + 훈련생 목록만.
// site/current는 구독·문서접근·출근기록까지 조회해 무거우므로, 문서 화면 진입 지연을 줄이기 위해 분리.
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { effectiveTrainingType } from "@/lib/serviceStep";

export async function GET(req: NextRequest) {
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

  const workerId = BigInt(session.workerId);
  const todayStr = getKstDateString();
  const today = new Date(`${todayStr}T00:00:00.000Z`);

  // 단일 쿼리: 활성 배정 + 현장명 + 사업체담당자 + 훈련생
  const assignment = await prisma.siteAssignment.findFirst({
    where: {
      workerId,
      status: "ACTIVE",
      startDate: { lte: today },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
    },
    select: {
      serviceStep: true,
      adaptationStartDate: true,
      site: {
        select: {
          companyName: true,
          businessContactName: true,
          trainees: { where: { status: "TRAINING" }, select: { id: true, name: true, gender: true } },
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const noStore = { headers: { "Cache-Control": "no-store" } };
  if (!assignment?.site) return NextResponse.json({ success: true, data: null }, noStore);

  // 오늘 기준 단계(전환일 지나면 적응지도)
  const trainingType = effectiveTrainingType(assignment.serviceStep, (assignment as any).adaptationStartDate, todayStr);

  return NextResponse.json({
    success: true,
    data: {
      companyName: assignment.site.companyName,
      businessContactName: assignment.site.businessContactName ?? "",
      trainingType,
      trainees: assignment.site.trainees.map((t) => ({ id: t.id.toString(), name: t.name, gender: t.gender })),
    },
  }, noStore);
}
