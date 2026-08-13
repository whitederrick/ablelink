// app/api/pilot/docs/preview/route.ts
// 파일럿 전용 문서 미리보기 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §9
//
// ★★기존 `app/api/worker/docs/**` 와 `lib/pdf/pdfkitRenderer.ts` 는 **한 줄도 고치지 않는다.**
//  파일럿 특례(이름 자리를 넓히는 것)를 렌더러 전역 fallback 으로 넣으면 정상 운영 PDF 가 전부 바뀐다.
//
// ★생성물 없음 — DocumentRun·DocumentVersion·서명 토큰·Storage 객체·발송을 **아무것도 만들지 않는다.**
//  PDF 바이트만 응답한다.

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

    // ★접근 검증 2단은 buildPilotDocPayload 안에서 수행한다
    //  (레지스트리 등록 + 실제 소유 일치). 미등록이면 404.
    // ★docType 은 buildPilotDocPayload 가 3종 화이트리스트로 검증한 값을 되돌려준다.
    //  입력 문자열을 그대로 쓰지 않는다.
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
        "Content-Disposition": contentDisposition(fileName, "inline"),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return toPilotResponse(e);
  }
}
