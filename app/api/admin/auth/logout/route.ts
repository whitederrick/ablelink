// app/api/admin/auth/logout/route.ts
// 관리자 로그아웃 API 핸들러입니다.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { clearAdminSessionCookieOnResponse } from "@/lib/adminCookies";

export async function POST() {
  // ✅ 응답에 세션 쿠키 삭제 부착 (NextResponse.cookies 사용)
  const res = NextResponse.json({ success: true });
  clearAdminSessionCookieOnResponse(res);
  return res;
}
