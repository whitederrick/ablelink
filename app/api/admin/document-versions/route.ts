// app/api/admin/document-versions/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { logAccess } from "@/lib/accessLog";
import { DocumentStage } from "@prisma/client";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function toItem(v: any) {
  return {
    id: String(v.id),
    runId: String(v.runId),
    versionNo: v.versionNo,
    stage: v.stage,
    pdfUrl: v.pdfUrl,
    pdfFileName: v.pdfFileName ?? null,
    sourceData: v.sourceData ?? null,
    createdAt: v.createdAt.toISOString(),
    createdByWorkerId: v.createdByWorkerId != null ? String(v.createdByWorkerId) : null,
    createdByManagerId: v.createdByManagerId != null ? String(v.createdByManagerId) : null,
  };
}

// 목록 전용 매퍼 — sourceData(서명 data-URI 포함 문서 원본) 제외.
//  버전 목록은 "어떤 버전이 있는가"만 보여주면 되고, 실제 내용은 /document-versions/[id]/pdf가
//  서버에서 직접 읽어 렌더한다. 전문을 목록에 실으면 건당 수백 KB가 불필요하게 나가고
//  필요최소 원칙에도 어긋난다. (소비처 실측: manager/documents/page.tsx:108 = id·versionNo·createdAt만 사용)
type VersionListRow = {
  id: bigint;
  runId: bigint;
  versionNo: number;
  stage: DocumentStage;
  pdfUrl: string;
  pdfFileName: string | null;
  createdAt: Date;
  createdByWorkerId: bigint | null;
  createdByManagerId: bigint | null;
};
function toListItem(v: VersionListRow) {
  return {
    id: String(v.id),
    runId: String(v.runId),
    versionNo: v.versionNo,
    stage: v.stage,
    pdfUrl: v.pdfUrl,
    pdfFileName: v.pdfFileName ?? null,
    createdAt: v.createdAt.toISOString(),
    createdByWorkerId: v.createdByWorkerId != null ? String(v.createdByWorkerId) : null,
    createdByManagerId: v.createdByManagerId != null ? String(v.createdByManagerId) : null,
  };
}

// GET: runId로 버전 목록 조회
// query: runId (required)
export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { searchParams } = new URL(req.url);
    const runIdStr = String(searchParams.get("runId") || "").trim();
    if (!runIdStr) throw new Error("VALIDATION:runId");
    if (!isValidNumericId(runIdStr)) throw new Error("VALIDATION:runId");
    const runId = BigInt(runIdStr);

    // run + 스코프 체크 — run.agencyId(실귀속, 생성 시 assignment.agencyId 기록) 기준.
    //  site.agencyId는 참고용·공유현장 divergence 시 타기관 제출본(PII) 열람으로 샌다.
    //  인박스·발송·action 등 형제 라우트와 동일 기준(null이면 fail-closed).
    const run = await prisma.documentRun.findUnique({
      where: { id: runId },
      select: { agencyId: true },
    });
    if (!run) throw new Error("NOT_FOUND");
    if (run.agencyId == null || run.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");

    const rows = await prisma.documentVersion.findMany({
      where: { runId },
      orderBy: { versionNo: "desc" },
      select: {
        id: true,
        runId: true,
        versionNo: true,
        stage: true,
        pdfUrl: true,
        pdfFileName: true,
        // sourceData는 select하지 않는다 — DB→서버 전송량까지 함께 줄인다(toListItem과 짝).
        createdAt: true,
        createdByWorkerId: true,
        createdByManagerId: true,
      },
    });

    // 개인정보 접속기록: 취급자가 특정 대상자의 제출 문서(사업자 제출 서류) 이력을 조회.
    //  ※응답에서 sourceData 전문은 제외됐지만, 어떤 대상자에게 어떤 문서가 있는지 자체가
    //   개인정보 열람에 해당하므로 기록은 유지한다(안전성확보조치 제8조).
    await logAccess(req, scope, {
      subjectType: "DocumentRun",
      subjectId: runId,
      resource: "submitted_document",
      action: "view",
    });

    return NextResponse.json({ success: true, items: rows.map(toListItem) });
  } catch (e: any) {
    // requireManagerSession은 NextResponse(401)를 throw — message 기반 매핑이 500으로 바꿔버리던 것 방지.
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    const st = errToStatus(msg);
    return NextResponse.json({ success: false, message: st === 500 ? "서버 오류" : msg }, { status: st });
  }
}

// POST(버전 생성)는 2026-10-08 제거: 앱 내 호출처가 없고(클라이언트 createVersion도 미사용),
//  매니저가 임의 sourceData/pdfUrl로 currentVersion을 바꿔 제출·서명 단계 검사 없이 공단 발송 본문을
//  위조할 수 있는 경로였다. 버전은 워커 제출/매니저 서명 등 정식 경로가 생성한다.
