// app/api/admin/document-versions/[id]/pdf/route.ts
// 저장된 DocumentVersion의 sourceData로 PDF 렌더링

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";
import { renderPdfToBuffer, type DocumentType } from "@/lib/pdf";

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
        sourceData: true,
        pdfUrl: true,
        run: {
          select: {
            docType: true,
            assignment: { select: { site: { select: { companyName: true, agencyId: true } } } },
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

    const docType = v.run?.docType as DocumentType | undefined;
    if (!docType) {
      if (v.pdfUrl) return NextResponse.redirect(v.pdfUrl);
      throw new Error("VALIDATION:docType");
    }

    const payload = {
      ...((v.sourceData ?? {}) as any),
      companyName: (v.sourceData as any)?.companyName ?? v.run?.assignment?.site?.companyName ?? "",
    };

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    return new NextResponse(new Uint8Array(pdfBuffer), {
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
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
