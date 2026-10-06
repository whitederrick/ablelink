// app/api/admin/pilots/[pilotId]/assignments/[assignmentId]/route.ts
// 파일럿 배정(근무형태·기간) 수정/삭제.
//
// ★기존 운영 화면·API(/api/admin/assignments)를 재사용하지 않는다. 파일럿 전용 레지스트리로
//  소유권을 확인하고, 여기서 완결한다(lib/pilot/resources.ts 파일 헤더 원칙과 동일).

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { updatePilotAssignment, deletePilotAssignment, PilotError } from "@/lib/pilot/resources";
import { toPilotResponse, parsePilotId } from "@/lib/pilot/httpError";

function parseAssignmentId(raw: string | undefined): bigint {
  if (!raw || !/^\d+$/.test(raw)) throw new PilotError(404, "NOT_FOUND", "배정을 찾을 수 없습니다.");
  return BigInt(raw);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ pilotId: string; assignmentId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { pilotId, assignmentId } = await params;
    const id = parsePilotId(pilotId);
    const asgId = parseAssignmentId(assignmentId);
    const body = await req.json().catch(() => ({}));
    const asg = await updatePilotAssignment(id, asgId, body);

    await audit(scope, {
      entityType: "SiteAssignment",
      entityId: asg.id.toString(),
      action: "update",
      summary: `파일럿 배정 수정 (pilot #${pilotId})`,
    });

    return NextResponse.json({ success: true, assignmentId: asg.id.toString() });
  } catch (e) {
    return toPilotResponse(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ pilotId: string; assignmentId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { pilotId, assignmentId } = await params;
    const id = parsePilotId(pilotId);
    const asgId = parseAssignmentId(assignmentId);
    await deletePilotAssignment(id, asgId);

    await audit(scope, {
      entityType: "SiteAssignment",
      entityId: asgId.toString(),
      action: "delete",
      summary: `파일럿 배정 삭제 (pilot #${pilotId})`,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return toPilotResponse(e);
  }
}
