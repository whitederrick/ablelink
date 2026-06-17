// app/api/admin/system/survey-targets/route.ts
// 운영자(시스템): 직무지도원 평가 워크리스트 — 전체 위탁기관의 '종료(임박 포함) 계약 × 평가요청 상태'.
// 공용 로직 lib/evalWorklist 사용(매니저용과 동일, 단 운영자는 전체 기관 + 종료 임박 포함).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { getEvalWorklist } from "@/lib/evalWorklist";

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const items = await getEvalWorklist();
    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[system/survey-targets GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
