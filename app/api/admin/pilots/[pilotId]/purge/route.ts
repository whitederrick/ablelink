// app/api/admin/pilots/[pilotId]/purge/route.ts
// 파일럿 초기화 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §10
//
//   GET  : 미리보기(아무것도 지우지 않는다). 실행 전 재확인용 — 종류별 삭제 예정 건수·중단 사유
//   POST : 실행. body `{ confirm: "<파일럿 이름>" }` 가 정확히 일치해야 한다
//
// ★이 라우트는 `audit()`를 부르지 않는다(§10-2-2·§12-7).
//  AuditEvent는 라우트가 명시 호출하는 방식이라, 부르지 않으면 이 대량 삭제는 감사행을 만들지 않는다.
//  남기면 삭제 직후 파일럿을 가리키는 행이 다시 1건 생겨 "흔적 0"과 충돌한다.
//  결과는 응답으로 전량 반환한다.

export const runtime = "nodejs";
// ★Storage 나열·삭제(외부 HTTP)와 대량 삭제 트랜잭션이 있어 기본 제한으로는 짧다.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminScope";
import { previewPilotPurge, purgePilot } from "@/lib/pilot/purge";
import { toPilotResponse, parsePilotId } from "@/lib/pilot/httpError";

export async function GET(req: Request, ctx: { params: Promise<{ pilotId: string }> }) {
  try {
    await requireAdminSession(req);
    const { pilotId } = await ctx.params;
    return NextResponse.json({ success: true, preview: await previewPilotPurge(parsePilotId(pilotId)) });
  } catch (e) {
    return toPilotResponse(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ pilotId: string }> }) {
  try {
    await requireAdminSession(req);
    const { pilotId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
    const result = await purgePilot(parsePilotId(pilotId), body.confirm);

    // ★실패분이 있으면 "완료"로 보고하지 않는다(§10-3). 남은 목록을 그대로 돌려준다.
    //  `AWAITING_CONFIRM`(1차 정리 완료·확인 대기)은 오류가 아니므로 200이다.
    return NextResponse.json({ success: true, result }, { status: result.outcome === "FAILED" ? 207 : 200 });
  } catch (e) {
    return toPilotResponse(e);
  }
}
