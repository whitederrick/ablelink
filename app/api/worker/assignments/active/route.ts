// app/api/worker/assignments/active/route.ts
// 오늘(KST) 활성 배정 목록 — 멀티 현장 선택/전환 UI용.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { getTodayActiveAssignments } from "@/lib/worker/activeAssignments";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const items = await getTodayActiveAssignments(BigInt(session.workerId));
    return NextResponse.json({ success: true, data: items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[worker/assignments/active]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
