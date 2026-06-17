// app/api/admin/survey-targets/route.ts
// 매니저(위탁기관): 직무지도원 평가 워크리스트 — 본 기관 '종료 배정 × 평가요청 상태'. 서버 페이지네이션.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { getEvalWorklistPage } from "@/lib/evalWorklist";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const sp = new URL(req.url).searchParams;
    const page = Number(sp.get("page") || 1);
    const pageSize = Number(sp.get("pageSize") || 10);
    const q = sp.get("q") || "";
    const states = (sp.get("state") || "").split(",").map(s => s.trim()).filter(Boolean);
    const result = await getEvalWorklistPage({ agencyId: scope.agencyId, page, pageSize, q, states });
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/survey-targets GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
