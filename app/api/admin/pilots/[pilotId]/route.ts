// app/api/admin/pilots/[pilotId]/route.ts
// 파일럿 상세 — 레지스트리에 기록된 자원만 되짚어 보여준다.
//
// ★"기관 소속 전체"가 아니라 레지스트리 id로 조회한다. 레지스트리가 삭제의 유일한 근거이므로
//  화면이 보여주는 것과 지워질 것이 같아야 하고, 기록 누락이 화면에서 바로 드러나야 한다.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { getPilotDetail } from "@/lib/pilot/resources";
import { toPilotResponse, parsePilotId } from "@/lib/pilot/httpError";

export async function GET(req: Request, ctx: { params: Promise<{ pilotId: string }> }) {
  try {
    await requireAdminSession(req);
    const { pilotId } = await ctx.params;
    return NextResponse.json({ success: true, ...(await getPilotDetail(parsePilotId(pilotId))) });
  } catch (e) {
    return toPilotResponse(e);
  }
}
