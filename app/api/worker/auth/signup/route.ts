// POST /api/worker/auth/signup
// 개인 자가가입 종료(2026-06-06): 직무지도원 계정은 에이전시 초대 또는 시스템 운영자 발급으로만 생성한다.
// (정체성은 에이전시에서 파생 — [[subscription-plan]] 정체성 모델 결정)

export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message: "개인 자가가입은 종료되었습니다. 소속 에이전시 초대 또는 시스템 운영자를 통해 가입해주세요.",
    },
    { status: 403 }
  );
}
