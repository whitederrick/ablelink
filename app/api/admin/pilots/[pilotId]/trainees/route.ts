// app/api/admin/pilots/[pilotId]/trainees/route.ts
// 파일럿 전용 훈련생 + 현장 재적 등록(한 트랜잭션).
//
// ★재적 인원이 출근부 서식을 바꾼다 — 1:1 / 1:多는 "그 날짜에 그 현장에 재적한 훈련생 수"로
//  날짜별 결정된다(2026-06-18 확정 규칙).

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { createPilotTrainee } from "@/lib/pilot/resources";
import { toPilotResponse, parsePilotId } from "@/lib/pilot/httpError";

export async function POST(req: Request, { params }: { params: Promise<{ pilotId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { pilotId } = await params;
    const id = parsePilotId(pilotId);
    const body = await req.json().catch(() => ({}));
    const { trainee, placement } = await createPilotTrainee(id, body);

    await audit(scope, {
      entityType: "Trainee",
      entityId: trainee.id.toString(),
      action: "create",
      summary: `파일럿 훈련생 등록 + 재적 (pilot #${pilotId})`,
    });

    return NextResponse.json({
      success: true,
      traineeId: trainee.id.toString(),
      placementId: placement.id.toString(),
    }, { status: 201 });
  } catch (e) {
    return toPilotResponse(e);
  }
}
