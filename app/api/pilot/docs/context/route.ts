// app/api/pilot/docs/context/route.ts
// 파일럿 문서 화면이 쓰는 선택지 — 이 워커의 파일럿 배정과 그 현장 재적 훈련생.
//
// ★레지스트리에 등록된 배정만 내려준다. 비파일럿 배정은 이 화면에 나타나지 않는다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { toPilotResponse } from "@/lib/pilot/httpError";
import { toPilotServiceStep } from "@/lib/pilot/docConstants";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    // 이 워커가 파일럿 참여자인가 — 레지스트리가 유일한 근거다.
    const wRes = await prisma.pilotResource.findUnique({
      where: { kind_resourceKey: { kind: "WORKER", resourceKey: workerId.toString() } },
      select: { pilotId: true },
    });
    if (!wRes) return NextResponse.json({ success: true, isPilot: false, assignments: [] });

    const asgKeys = await prisma.pilotResource.findMany({
      where: { pilotId: wRes.pilotId, kind: "ASSIGNMENT" },
      select: { resourceKey: true },
    });
    const asgIds = asgKeys.map((r) => BigInt(r.resourceKey));

    const assignments = await prisma.siteAssignment.findMany({
      // ★레지스트리 ∩ 실제 소유 — 둘 다 만족해야 보여준다.
      where: { id: { in: asgIds }, workerId },
      select: {
        id: true, startDate: true, endDate: true, workType: true, serviceStep: true,
        // ★businessContactName — 서명 화면의 담당자 성함 기본값. 없으면 서명자가 빈 칸을 받고,
        //  운영 업로드 라우트가 "사업체 담당자"라는 대체 문자열을 넣어 실명이 문서에서 사라진다.
        site: { select: { id: true, companyName: true, businessContactName: true } },
      },
      orderBy: { id: "asc" },
    });

    // ★★현장 기준으로 뽑으면 안 된다 — 파일럿 현장에 비파일럿 훈련생이 잘못 재적되면
    //  그 이름이 선택지에 노출된다. **레지스트리에 등록된 훈련생 ∩ 그 현장 재적**으로 좁힌다.
    //  (문서 생성 쪽도 같은 검증을 한다 — lib/pilot/docs.ts. 화면과 서버가 같은 기준을 써야
    //   "목록에는 보이는데 만들면 404" 같은 어긋남이 안 생긴다.)
    const traineeKeys = await prisma.pilotResource.findMany({
      where: { pilotId: wRes.pilotId, kind: "TRAINEE" },
      select: { resourceKey: true },
    });
    const pilotTraineeIds = traineeKeys.map((r) => BigInt(r.resourceKey));

    const siteIds = assignments.map((a) => a.site?.id).filter((v): v is bigint => v != null);
    const placements = siteIds.length && pilotTraineeIds.length
      ? await prisma.traineePlacement.findMany({
          where: { siteId: { in: siteIds }, traineeId: { in: pilotTraineeIds } },
          select: { siteId: true, startDate: true, endDate: true, trainee: { select: { id: true, name: true } } },
          orderBy: { id: "asc" },
        })
      : [];

    return NextResponse.json({
      success: true,
      isPilot: true,
      workerName: session.workerName,
      assignments: assignments.map((a) => ({
        id: a.id.toString(),
        siteId: a.site?.id.toString() ?? "",
        companyName: a.site?.companyName ?? "",
        businessContactName: a.site?.businessContactName ?? "",
        workType: a.workType,
        // ★서비스 단계 — 화면이 이 값으로 문서 목록을 좁힌다(서버도 같은 기준으로 거부한다).
        serviceStep: toPilotServiceStep(a.serviceStep),
        startDate: a.startDate.toISOString().slice(0, 10),
        endDate: a.endDate ? a.endDate.toISOString().slice(0, 10) : null,
        trainees: placements
          .filter((p) => p.siteId === a.site?.id)
          .map((p) => ({ id: p.trainee.id.toString(), name: p.trainee.name })),
      })),
    });
  } catch (e) {
    return toPilotResponse(e);
  }
}
