// app/api/worker/auth/refresh/route.ts
// 롤링 세션: 유효한 워커 토큰을 새 만료(90일)로 재발급. 앱을 열 때마다 호출되어
// 정기적으로 쓰는 직무지도원은 사실상 재로그인이 없도록 한다. (계정 비활성 시엔 차단)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq, signWorkerToken, WORKER_COOKIE, workerCookieOptions } from "@/app/worker/_lib/session";

export async function POST(req: NextRequest) {
  // getWorkerSessionFromReq가 토큰 유효성 + 계정 ACTIVE까지 재검증
  const session = await getWorkerSessionFromReq(req);
  if (!session) return NextResponse.json({ success: false }, { status: 401 });

  const token = await signWorkerToken({
    workerId: session.workerId,
    workerName: session.workerName,
    isTemporary: session.isTemporary,
  });

  const res = NextResponse.json({ success: true });
  res.cookies.set(WORKER_COOKIE, token, workerCookieOptions());
  return res;
}
