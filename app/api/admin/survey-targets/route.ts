// app/api/admin/survey-targets/route.ts
// 매니저(위탁기관): 직무지도원 평가 워크리스트 — 본 기관의 '종료 계약 × 평가요청 상태'.
// 운영자(system/survey-targets)와 동일 로직(lib/evalWorklist), 본 기관 스코프.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { getEvalWorklist } from "@/lib/evalWorklist";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const items = await getEvalWorklist({ agencyId: scope.agencyId });
    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/survey-targets GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
