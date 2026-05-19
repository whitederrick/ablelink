// app/api/admin/document-versions/[id]/pdf/route.ts
// PDF 렌더링은 Node.js 런타임에서만 동작하도록 설정

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";
import { renderPdfToBuffer, type DocumentType } from "@/lib/pdf";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg?.startsWith("VALIDATION:")) return 400;
  if (msg === "NOT_FOUND") return 404;
  return 500;
}

function isSupportedDocType(docType: any): docType is DocumentType {
  return (
    docType === "TRAINING_DAILY_LOG" ||
    docType === "ATTENDANCE_SHEET" ||
    docType === "ADAPTATION_DAILY_LOG" ||
    docType === "ADAPTATION_FINAL_EVAL" ||
    docType === "COACH_CHECKLIST" ||
    docType === "TRAINEE_FINAL_EVAL"
  );
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
        run: {
          select: {
            id: true,
            docType: true,
            assignmentId: true,
            assignment: {
              select: {
                id: true,
                site: { select: { id: true, companyName: true, agencyId: true } },
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
      if (!agencyId) throw new Error("FORBIDDEN");
      if (agencyId !== myAgencyId) throw new Error("FORBIDDEN");
    }

    const docType = v.run?.docType;
    if (!isSupportedDocType(docType)) throw new Error("VALIDATION:docType");

    const source = (v.sourceData ?? {}) as any;

    let payload: any = source;
    if (docType === "TRAINING_DAILY_LOG") {
      payload = {
        ...source,
        companyName: source.companyName ?? v.run?.assignment?.site?.companyName ?? "",
      };
    }

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    // ✅ NextResponse 타입 안전: Buffer -> Uint8Array로 변환
    const body = new Uint8Array(pdfBuffer);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${docType}_v${v.id}.pdf"`,
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
