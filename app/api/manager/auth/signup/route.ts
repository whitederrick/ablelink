// app/api/manager/auth/signup/route.ts
// 에이전시 자가가입 종료(2026-06-07): 에이전시·관리자 계정은 시스템 운영자가 개설(에이전시 생성 + 초대)한다.
// 기존 자체 가입 신청(Option A)은 폐지. 운영자 발급/초대(Option B)만 유지.

export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message: "에이전시 자가가입은 운영되지 않습니다. 시스템 운영자에게 개설을 요청해주세요.",
    },
    { status: 403 }
  );
}
