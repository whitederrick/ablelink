// app/api/worker/site/register/route.ts
// 직무지도원 셀프 현장등록 종료(2026-06-06): 현장 배정은 시스템 운영자/위탁기관가 입력한다.
// (정체성 모델: 워커가 스스로 현장을 만들지 않음 — 운영자가 강제 연결)

export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message: "직무지도원이 직접 현장을 등록하는 기능은 종료되었습니다. 현장 배정은 소속 위탁기관 또는 시스템 운영자에게 요청해주세요.",
    },
    { status: 403 }
  );
}
