// app/api/admin/pilots/[pilotId]/sites/route.ts
// 파일럿 전용 사업체 등록.
//
// ★기존 /admin/sites 경로를 재사용하거나 수정하지 않는다. 파일럿 자원 생성은 여기서 완결한다.
// ★좌표는 필수다(Site.gpsLat/gpsLon non-null). 화면이 주소 검색 결과의 좌표를 그대로 넘긴다.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { createPilotSite } from "@/lib/pilot/resources";
import { toPilotResponse, parsePilotId } from "@/lib/pilot/httpError";

export async function POST(req: Request, { params }: { params: Promise<{ pilotId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { pilotId } = await params;
    const id = parsePilotId(pilotId);
    const body = await req.json().catch(() => ({}));
    const site = await createPilotSite(id, body);

    await audit(scope, {
      entityType: "Site",
      entityId: site.id.toString(),
      action: "create",
      summary: `파일럿 사업체 등록: ${site.companyName} (pilot #${pilotId})`,
    });

    return NextResponse.json({ success: true, siteId: site.id.toString() }, { status: 201 });
  } catch (e) {
    return toPilotResponse(e);
  }
}
