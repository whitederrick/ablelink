// app/api/admin/document-versions/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { Prisma, DocumentStage } from "@prisma/client";

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

    // run + 스코프 체크
    const run = await prisma.documentRun.findUnique({
      where: { id: runId },
      select: { assignment: { select: { site: { select: { agencyId: true } } } } },
    });
    if (!run) throw new Error("NOT_FOUND");

    {
      const agencyId = run.assignment.site.agencyId;
      if (agencyId == null || agencyId !== scope.agencyId) throw new Error("FORBIDDEN");
    }

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
        sourceData: true,
        createdAt: true,
        createdByWorkerId: true,
        createdByManagerId: true,
      },
    });

    return NextResponse.json({ success: true, items: rows.map(toItem) });
  } catch (e: any) {
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

// POST: 버전 생성 + DocumentRun.currentVersion 갱신
// body: { runId, stage(PRE|FINAL), pdfUrl, pdfFileName?, sourceData? }
// ✅ sourceData 처리 규칙
// - undefined: 필드 생략
// - null: Prisma.JsonNull 저장(JSON null)
// - object/value: 그대로 저장
export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const body = await req.json();
    const runIdStr = String(body?.runId || "").trim();
    const stageStr = String(body?.stage || "").trim();
    const pdfUrl = String(body?.pdfUrl || "").trim();

    if (!runIdStr) throw new Error("VALIDATION:runId");
    if (!isValidNumericId(runIdStr)) throw new Error("VALIDATION:runId");
    if (!stageStr || !Object.values(DocumentStage).includes(stageStr as any)) throw new Error("VALIDATION:stage");
    if (!pdfUrl) throw new Error("VALIDATION:pdfUrl");

    const runId = BigInt(runIdStr);

    const run = await prisma.documentRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        assignment: { select: { site: { select: { agencyId: true } } } },
      },
    });
    if (!run) throw new Error("NOT_FOUND");

    {
      const agencyId = run.assignment.site.agencyId;
      if (agencyId == null || agencyId !== scope.agencyId) throw new Error("FORBIDDEN");
    }

    const nextVersionNo =
      (await prisma.documentVersion.aggregate({
        where: { runId },
        _max: { versionNo: true },
      }))._max.versionNo ?? 0;

    const pdfFileName = body?.pdfFileName == null ? null : String(body.pdfFileName).trim();

    // ✅ 타입 안전한 JSON 처리
    let sourceDataInput: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined;
    if (Object.prototype.hasOwnProperty.call(body, "sourceData")) {
      if (body.sourceData === null) {
        sourceDataInput = Prisma.JsonNull;
      } else {
        sourceDataInput = body.sourceData as Prisma.InputJsonValue;
      }
    } else {
      sourceDataInput = undefined;
    }

    const created = await prisma.$transaction(async (tx) => {
      const v = await tx.documentVersion.create({
        data: {
          run: { connect: { id: runId } },
          versionNo: nextVersionNo + 1,
          stage: stageStr as any,
          pdfUrl,
          pdfFileName,

          ...(sourceDataInput !== undefined ? { sourceData: sourceDataInput } : {}),

          createdByManager: { connect: { id: scope.managerId } },
        },
        select: {
          id: true,
          runId: true,
          versionNo: true,
          stage: true,
          pdfUrl: true,
          pdfFileName: true,
          sourceData: true,
          createdAt: true,
          createdByWorkerId: true,
          createdByManagerId: true,
        },
      });

      await tx.documentRun.update({
        where: { id: runId },
        data: { currentVersion: { connect: { id: v.id } } },
      });

      return v;
    });

    return NextResponse.json({ success: true, item: toItem(created) });
  } catch (e: any) {
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
