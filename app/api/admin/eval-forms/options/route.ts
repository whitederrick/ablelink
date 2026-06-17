// app/api/admin/eval-forms/options/route.ts
// 평가표 선택 목록(발송 모달용). 매니저 또는 운영자 세션 허용(읽기 전용).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { listEvalForms } from "@/lib/jobCoachEval";
import { requireManagerSession } from "@/lib/managerScope";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  // 매니저 또는 운영자면 허용
  try { await requireManagerSession(req); }
  catch {
    try { await requireAdminSession(req); }
    catch { return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 401 }); }
  }
  try {
    const forms = await listEvalForms();
    return NextResponse.json({ success: true, forms });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
