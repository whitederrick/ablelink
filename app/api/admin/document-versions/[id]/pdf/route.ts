// app/api/admin/document-versions/[id]/pdf/route.ts
// PDF 렌더링 — jsreport 기반 (5종 문서 모두 지원)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";
import { generatePdf, type DocType } from "@/lib/pdfGenerator";

// DocumentRun.docType(대문자) → jsreport 템플릿명(소문자) 변환
const DOC_TYPE_MAP: Record<string, DocType> = {
  TRAINING_DAILY_LOG:  "training-daily-log",
  ATTENDANCE_SHEET:    "attendance-sheet",
  ADAPTATION_DAILY_LOG:"adaptation-daily-log",
  ADAPTATION_FINAL_EVAL:"adaptation-final-eval",
  TRAINEE_FINAL_EVAL:  "trainee-final-eval",
};

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN")    return 403;
  if (msg?.startsWith("VALIDATION:")) return 400;
  if (msg === "NOT_FOUND")    return 404;
  return 500;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireAdminSession(req);
    const { id } = await params;
    const versionId = BigInt(id);

    const v = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        stage: true,
        sourceData: true,
        pdfUrl: true,
        run: {
          select: {
            docType: true,
            assignment: {
              select: {
                site: { select: { companyName: true, agencyId: true } },
              },
            },
          },
        },
      },
    });

    if (!v) throw new Error("NOT_FOUND");

    if (scope.role === "AGENCY") {
      const myAgencyId = requireAgencyScope(scope);
      const agencyId = v.run?.assignment?.site?.agencyId ?? null;
      if (!agencyId || agencyId !== myAgencyId) throw new Error("FORBIDDEN");
    }

    const jsreportType = DOC_TYPE_MAP[v.run?.docType ?? ""];

    // jsreport 미지원 docType이면 기존 pdfUrl로 리다이렉트
    if (!jsreportType) {
      if (v.pdfUrl) return NextResponse.redirect(v.pdfUrl);
      throw new Error("VALIDATION:docType");
    }

    const source = (v.sourceData ?? {}) as any;

    // sourceData에 companyName 보강
    const data = {
      ...source,
      companyName: source.companyName ?? v.run?.assignment?.site?.companyName ?? "",
    };

    const pdfBuffer = await generatePdf(jsreportType, data);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${jsreportType}_v${v.id}.pdf"`,
        "Cache-Control": "no-store",
      },
    });

  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json(
      { success: false, message: msg },
      { status: errToStatus(msg) }
    );
  }
}
