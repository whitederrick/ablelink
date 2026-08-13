// app/api/admin/pilots/route.ts
// 파일럿 목록 조회 / 생성 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §8
//
// ★시스템 운영자 전용. 위탁기관 Manager는 파일럿에 관여하지 않는다(계정 자체를 만들지 않는다).
// ★라우트는 인증·입력·HTTP만 담당하고 실제 동작은 lib/pilot/resources.ts가 갖는다.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { createPilot, listPilots } from "@/lib/pilot/resources";
import { toPilotResponse } from "@/lib/pilot/httpError";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    return NextResponse.json({ success: true, pilots: await listPilots() });
  } catch (e) {
    return toPilotResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requireAdminSession(req);
    const body = await req.json().catch(() => ({}));
    const created = await createPilot(body);

    await audit(scope, {
      entityType: "Pilot",
      entityId: created.pilotId.toString(),
      action: "create",
      summary: `파일럿 생성: ${created.pilotName} (전용 기관 ${created.agencyName})`,
    });

    return NextResponse.json({
      success: true,
      pilotId: created.pilotId.toString(),
      agencyId: created.agencyId.toString(),
    }, { status: 201 });
  } catch (e) {
    return toPilotResponse(e);
  }
}
