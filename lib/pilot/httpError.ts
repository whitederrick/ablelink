// lib/pilot/httpError.ts
// 파일럿 라우트 공용 오류 변환.
//
// ★route.ts에는 HTTP 메서드 핸들러 외의 export를 두지 않는다(App Router 관례).

import { NextResponse } from "next/server";
import { PilotError } from "./resources";

/** PilotError는 상태코드를 그대로 옮기고, 그 외 예외는 500(사유 비노출). */
export function toPilotResponse(e: unknown): Response {
  if (e instanceof PilotError) {
    return NextResponse.json({ success: false, code: e.code, message: e.message }, { status: e.status });
  }
  if (e instanceof Response) return e; // requireAdminSession이 던지는 jsonError
  console.error("[pilot]", e);
  return NextResponse.json({ success: false, message: "처리 중 오류가 발생했습니다." }, { status: 500 });
}

/** 경로 파라미터의 파일럿 id. 형식이 틀리면 404로 통일한다(존재 여부 노출 방지). */
export function parsePilotId(raw: string | undefined): bigint {
  if (!raw || !/^\d+$/.test(raw)) throw new PilotError(404, "PILOT_NOT_FOUND", "파일럿을 찾을 수 없습니다.");
  return BigInt(raw);
}
