// app/api/worker/home-summary/route.ts
// 워커 홈 통합 데이터 — 출퇴근/일지 액션 후 재검증용. 첫 로드는 서버 컴포넌트가 프리페치.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq, WK_ACTIVE_ASSIGNMENT_COOKIE } from "@/app/worker/_lib/session";
import { buildHomeSummary } from "@/lib/worker/homeSummary";

function parseBigIntOrNull(v: string | undefined): bigint | null {
  if (!v) return null;
  try { return BigInt(v); } catch { return null; }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const selected = parseBigIntOrNull(request.cookies.get(WK_ACTIVE_ASSIGNMENT_COOKIE)?.value);
    const summary = await buildHomeSummary(BigInt(session.workerId), selected);
    return NextResponse.json({ success: true, data: summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[worker/home-summary]", e);
    return NextResponse.json({ success: false, message: "데이터 로딩 실패" }, { status: 500 });
  }
}
