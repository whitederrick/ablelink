// app/api/auth/login/route.ts
// DEPRECATED: 이 엔드포인트는 비활성화되었습니다.
// 로그인은 /api/worker/auth/login 을 사용하세요.

export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { success: false, message: "이 엔드포인트는 더 이상 사용되지 않습니다." },
    { status: 410 }
  );
}
