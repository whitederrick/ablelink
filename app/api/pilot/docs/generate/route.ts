// app/api/pilot/docs/generate/route.ts
// 파일럿 전용 문서 다운로드 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §9
//
// ★preview 와 payload·검증이 완전히 같고 Content-Disposition 만 attachment 다.
//  기존 운영 경로는 preview 와 generate 의 담당자명이 서로 어긋나 있었는데(F2),
//  파일럿은 **같은 함수 하나**(buildPilotDocPayload)를 쓰므로 구조적으로 어긋날 수 없다.
//
// ★생성물 없음 — DocumentRun·DocumentVersion·서명 토큰·Storage 객체를 만들지 않고
//  **이메일·제출·공단 발송 경로도 없다.** 파일럿 화면에는 미리보기·다운로드만 노출한다(§2).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { renderPdfToBuffer } from "@/lib/pdf";
import { isValidYmd } from "@/lib/time";
import { buildDocFileName, contentDisposition } from "@/lib/pdf/filename";
import { buildPilotDocPayload } from "@/lib/pilot/docs";
import { toPilotResponse } from "@/lib/pilot/httpError";
import { PilotError } from "@/lib/pilot/resources";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const docType = String(sp.get("docType") ?? "");
    const start = String(sp.get("periodStart") ?? "");
    const end = String(sp.get("periodEnd") ?? "");
    const assignmentIdRaw = String(sp.get("assignmentId") ?? "");
    const traineeId = sp.get("traineeId");

    if (!isValidYmd(start) || !isValidYmd(end)) {
      throw new PilotError(400, "INVALID_PERIOD", "기간(YYYY-MM-DD)이 올바르지 않습니다.");
    }
    if (!/^\d+$/.test(assignmentIdRaw)) throw new PilotError(400, "INVALID_INPUT", "배정을 선택해 주세요.");

    // ★docType 은 buildPilotDocPayload 가 3종 화이트리스트로 검증한 값을 되돌려준다.
    const { payload, companyName, docType: verified } = await buildPilotDocPayload({
      workerId: BigInt(session.workerId), assignmentId: BigInt(assignmentIdRaw),
      docType, start, end, traineeId,
    });

    const pdf = await renderPdfToBuffer({ documentType: verified, payload });
    const fileName = buildDocFileName(verified, {
      traineeName: (payload as { traineeName?: string })?.traineeName ?? null,
      companyName, start, end,
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(fileName, "attachment"),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return toPilotResponse(e);
  }
}
