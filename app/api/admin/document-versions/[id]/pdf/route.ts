// app/api/admin/document-versions/[id]/pdf/route.ts
// 저장된 DocumentVersion의 sourceData로 PDF 렌더링

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { renderPdfToBuffer, type DocumentType } from "@/lib/pdf";
import { PRISMA_TO_PDF_DOCTYPE } from "@/lib/docs/docTypeMap";
import { injectManagerSignature } from "@/lib/docs/managerSig";
import { logAccess } from "@/lib/accessLog";

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
    const scope = await requireManagerSession(req);
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
            managerSignatureUrl: true,
            managerSignerName: true,
            worker: { select: { id: true, workerName: true } },
            assignment: { select: { site: { select: { companyName: true, agencyId: true } } } },
          },
        },
      },
    });

    if (!v) throw new Error("NOT_FOUND");

    const agencyId = v.run?.assignment?.site?.agencyId ?? null;
    if (!agencyId || agencyId !== scope.agencyId) throw new Error("FORBIDDEN");

    // Prisma DocumentType → PDF 렌더 docType(vocabulary 다름)
    const rawDocType = v.run?.docType as string | undefined;
    const docType = (rawDocType ? (PRISMA_TO_PDF_DOCTYPE[rawDocType] ?? rawDocType) : undefined) as DocumentType | undefined;
    if (!docType) {
      if (v.pdfUrl) return NextResponse.redirect(v.pdfUrl);
      throw new Error("VALIDATION:docType");
    }

    const basePayload = {
      ...((v.sourceData ?? {}) as any),
      companyName: (v.sourceData as any)?.companyName ?? v.run?.assignment?.site?.companyName ?? "",
    };
    // 제출 후 추가된 매니저 서명을 스냅샷에 합쳐 렌더(스냅샷 자체에는 비어 있음).
    const payload = await injectManagerSignature(basePayload, {
      managerSignatureUrl: v.run?.managerSignatureUrl,
      managerSignerName: v.run?.managerSignerName,
    });

    const pdfBuffer = await renderPdfToBuffer({ documentType: docType, payload });

    // 접속기록(제8조): 제출본 PII PDF 렌더·제공 지점 기록.
    await logAccess(req, scope, {
      subjectType: "Worker",
      subjectId: v.run?.worker?.id ?? null,
      subjectLabel: v.run?.worker?.workerName ?? null,
      resource: "official_document",
      action: "print",
    });

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
