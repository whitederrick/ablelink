// app/api/pilot/docs/sign-status/route.ts
// 이 배정·기간에 **사업체 담당자 서명이 이미 있는가** — 파일럿 화면의 배지 판정용.
//
// ★★판정을 화면에 맡기지 않는 이유: 서명은 (배정 + 기간)에 붙고 문서 종류를 가리지 않으므로,
//  화면이 기억하는 "방금 서명했다" 상태만으로는 **새로고침·기간 변경 후에 거짓말**을 한다.
//  PDF 를 만드는 `findPilotCompanySignature` 를 **그대로 호출**해 같은 답을 준다.
//
// ★생성물 없음 — 읽기 전용이다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { isValidYmd } from "@/lib/time";
import { assertPilotDocAccess, findPilotCompanySignature } from "@/lib/pilot/docs";
import { pilotDocHasCompanySign } from "@/lib/pilot/docConstants";
import { toPilotResponse } from "@/lib/pilot/httpError";
import { PilotError } from "@/lib/pilot/resources";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const start = String(sp.get("periodStart") ?? "");
    const end = String(sp.get("periodEnd") ?? "");
    const assignmentIdRaw = String(sp.get("assignmentId") ?? "");
    const docType = String(sp.get("docType") ?? "");

    if (!isValidYmd(start) || !isValidYmd(end)) {
      throw new PilotError(400, "INVALID_PERIOD", "기간(YYYY-MM-DD)이 올바르지 않습니다.");
    }
    if (!/^\d+$/.test(assignmentIdRaw)) throw new PilotError(400, "INVALID_INPUT", "배정을 선택해 주세요.");

    // ★접근 검증 2단(레지스트리 등록 ∩ 실제 소유) — 문서 생성과 같은 관문을 통과해야 한다.
    const assignmentId = BigInt(assignmentIdRaw);
    await assertPilotDocAccess(BigInt(session.workerId), assignmentId);

    // 서명 슬롯이 없는 문서(적응지도 일지)는 조회 자체가 무의미하다.
    if (docType && !pilotDocHasCompanySign(docType)) {
      return NextResponse.json({ success: true, supported: false, signed: false });
    }

    const sig = await findPilotCompanySignature(assignmentId, start, end);
    return NextResponse.json({
      success: true,
      supported: true,
      signed: !!sig,
      signerName: sig?.signerName ?? "",
      signedAt: sig?.usedAt?.toISOString() ?? null,
    });
  } catch (e) {
    return toPilotResponse(e);
  }
}
