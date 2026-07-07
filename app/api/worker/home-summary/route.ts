// app/api/worker/home-summary/route.ts
// 워커 홈 통합 데이터 — 출퇴근/일지 액션 후 재검증용. 첫 로드는 서버 컴포넌트가 프리페치.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq, WK_ACTIVE_ASSIGNMENT_COOKIE } from "@/app/worker/_lib/session";
import { buildHomeSummary } from "@/lib/worker/homeSummary";
import { prisma } from "@/lib/prisma";

function parseBigIntOrNull(v: string | undefined): bigint | null {
  if (!v) return null;
  try { return BigInt(v); } catch { return null; }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const workerId = BigInt(session.workerId);
    const selected = parseBigIntOrNull(request.cookies.get(WK_ACTIVE_ASSIGNMENT_COOKIE)?.value);
    const summary = await buildHomeSummary(workerId, selected);
    const res = NextResponse.json({ success: true, data: summary }, { headers: { "Cache-Control": "no-store" } });

    // ★근본(쿠키 위생): 선택 배정 쿠키가 이 워커의 유효 배정(소유+근무발생상태, ENDED 포함)을 가리키지 않으면
    //  (재시드로 사라진 id·삭제·공유기기의 이전 사용자 잔존 등) 서버가 정리한다. 낡은 쿠키가 문서/홈을 오도하지 않게.
    if (selected != null) {
      const owned = await prisma.siteAssignment.findFirst({
        where: { id: selected, workerId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE", "ENDED"] } },
        select: { id: true },
      });
      if (!owned) res.cookies.set(WK_ACTIVE_ASSIGNMENT_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
    }
    return res;
  } catch (e: any) {
    console.error("[worker/home-summary]", e);
    return NextResponse.json({ success: false, message: "데이터 로딩 실패" }, { status: 500 });
  }
}
