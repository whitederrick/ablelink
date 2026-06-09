// app/api/admin/document-runs/zip/route.ts
// 제출 문서 전체 다운로드 — 현재 목록(또는 ids)의 최신본 PDF를 ZIP으로 묶어 반환.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { renderPdfToBuffer, type DocumentType } from "@/lib/pdf";
import { PRISMA_TO_PDF_DOCTYPE } from "@/lib/docs/docTypeMap";
import JSZip from "jszip";

const DOC_LABEL: Record<string, string> = {
  ATTENDANCE_SHEET:              "출근부",
  TRAINING_DAILY_LOG:            "지원고용훈련일지",
  TRAINEE_COMPREHENSIVE_EVAL:    "훈련생종합평가",
  POST_EMPLOY_ADAPT_LOG:         "적응지도일지",
  ADAPTATION_COMPREHENSIVE_EVAL: "적응지도종합평가",
  CHECKLIST:                     "체크리스트",
};

function safe(s: string) { return (s || "").replace(/[\\/:*?"<>|]/g, "").trim(); }

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const idsParam = (searchParams.get("ids") ?? "").trim();
    const ids = idsParam ? idsParam.split(",").map(s => s.trim()).filter(s => /^\d+$/.test(s)).map(s => BigInt(s)) : null;

    const runs = await prisma.documentRun.findMany({
      where: {
        agencyId: scope.agencyId,
        signStage: { not: "DRAFT" },
        ...(ids ? { id: { in: ids } } : {}),
        ...(q ? { OR: [{ worker: { workerName: { contains: q } } }, { site: { companyName: { contains: q } } }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true, docType: true, traineeId: true, periodStart: true, periodEnd: true,
        worker: { select: { workerName: true } },
        site: { select: { companyName: true } },
        currentVersion: { select: { sourceData: true } },
      },
    });

    if (runs.length === 0)
      return NextResponse.json({ success: false, message: "다운로드할 문서가 없습니다." }, { status: 404 });

    // 훈련생 이름
    const traineeIds = [...new Set(runs.map(r => r.traineeId).filter((v): v is bigint => v != null))];
    const trainees = traineeIds.length
      ? await prisma.trainee.findMany({ where: { id: { in: traineeIds } }, select: { id: true, name: true } })
      : [];
    const traineeMap = new Map(trainees.map(t => [t.id.toString(), t.name]));

    const zip = new JSZip();
    let added = 0;
    const usedNames = new Set<string>();

    for (const r of runs) {
      if (!r.currentVersion?.sourceData) continue;
      const renderType = (PRISMA_TO_PDF_DOCTYPE[r.docType] ?? r.docType) as DocumentType;
      const payload = {
        ...((r.currentVersion.sourceData ?? {}) as any),
        companyName: (r.currentVersion.sourceData as any)?.companyName ?? r.site?.companyName ?? "",
      };
      let buf: Buffer;
      try {
        buf = await renderPdfToBuffer({ documentType: renderType, payload });
      } catch (e) {
        console.error("[document-runs/zip render]", r.id.toString(), e);
        continue;
      }
      const label = DOC_LABEL[r.docType] ?? r.docType;
      const who = r.traineeId != null ? (traineeMap.get(r.traineeId.toString()) ?? "") : safe(r.worker?.workerName ?? "");
      const ps = r.periodStart.toISOString().slice(0, 10);
      const pe = r.periodEnd.toISOString().slice(0, 10);
      let name = `${safe(label)}_${safe(who)}_${ps}_${pe}.pdf`;
      let i = 2;
      while (usedNames.has(name)) { name = `${safe(label)}_${safe(who)}_${ps}_${pe}_${i++}.pdf`; }
      usedNames.add(name);
      zip.file(name, buf);
      added++;
    }

    if (added === 0)
      return NextResponse.json({ success: false, message: "생성 가능한 문서가 없습니다." }, { status: 404 });

    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
    const fileName = encodeURIComponent(`제출문서_${new Date().toISOString().slice(0, 10)}.zip`);

    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/document-runs/zip]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
