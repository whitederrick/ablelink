// app/api/admin/pilots/[pilotId]/assignments/route.ts
// 파일럿 배정(근무형태·기간) 등록.
//
// ★attendanceButtonExempt: true — 출퇴근 버튼·GPS·실제 타각 없이 기존 '일괄 작성'으로
//  표준 근무시각 출근부 행을 만든다.
// ★근무형태는 AM/PM/FULL_DAY만. 시각은 computeWorkTimes()가 단독 결정하는 절대불변 규칙이라
//  여기서 직접 입력받지 않는다.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { createPilotAssignment } from "@/lib/pilot/resources";
import { toPilotResponse, parsePilotId } from "@/lib/pilot/httpError";

export async function POST(req: Request, { params }: { params: Promise<{ pilotId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { pilotId } = await params;
    const id = parsePilotId(pilotId);
    const body = await req.json().catch(() => ({}));
    const asg = await createPilotAssignment(id, body);

    await audit(scope, {
      entityType: "SiteAssignment",
      entityId: asg.id.toString(),
      action: "create",
      summary: `파일럿 배정 등록: ${asg.workType} (pilot #${pilotId})`,
    });

    return NextResponse.json({ success: true, assignmentId: asg.id.toString() }, { status: 201 });
  } catch (e) {
    return toPilotResponse(e);
  }
}
