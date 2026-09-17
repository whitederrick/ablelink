export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { getMissingLogItems } from "@/lib/worker/missingLogs";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const workerId = BigInt(session.workerId);

    // 최근 3개월 · 훈련생 단위 미작성(부분 작성된 날도 포함 — 2026-09-17 사용성 개선)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const from = threeMonthsAgo.toISOString().slice(0, 10);

    const attendances = await getMissingLogItems(workerId, from, 30);

    return NextResponse.json({ success: true, attendances });
  } catch (e: any) {
    console.error("[logs/missing]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
