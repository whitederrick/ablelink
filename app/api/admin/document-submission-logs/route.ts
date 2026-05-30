// app/api/admin/document-submission-logs/route.ts
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

function toItem(l: any) {
  return {
    id: String(l.id),
    runId: String(l.runId),
    versionId: String(l.versionId),
    stage: l.stage,
    submittedAt: l.submittedAt.toISOString(),
    submittedByWorkerId: l.submittedByWorkerId != null ? String(l.submittedByWorkerId) : null,
    submittedByManagerId: l.submittedByManagerId != null ? String(l.submittedByManagerId) : null,
    sentToEmail: l.sentToEmail ?? null,
    emailSentAt: l.emailSentAt ? l.emailSentAt.toISOString() : null,
    emailStatus: l.emailStatus ?? null,
    emailPayload: l.emailPayload ?? null,
  };
}

// GET: runId로 로그 조회
export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { searchParams } = new URL(req.url);
    const runIdStr = String(searchParams.get("runId") || "").trim();
    if (!runIdStr) throw new Error("VALIDATION:runId");
    if (!isValidNumericId(runIdStr)) throw new Error("VALIDATION:runId");

    const runId = BigInt(runIdStr);

    // 스코프 검증
    const run = await prisma.documentRun.findUnique({
      where: { id: runId },
      select: { assignment: { select: { site: { select: { agencyId: true } } } } },
    });
    if (!run) throw new Error("NOT_FOUND");
    if (run.assignment.site.agencyId == null || run.assignment.site.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");

    const rows = await prisma.documentSubmissionLog.findMany({
      where: { runId },
      orderBy: { id: "desc" },
      select: {
        id: true,
        runId: true,
        versionId: true,
        stage: true,
        submittedAt: true,
        submittedByWorkerId: true,
        submittedByManagerId: true,
        sentToEmail: true,
        emailSentAt: true,
        emailStatus: true,
        emailPayload: true,
      },
    });

    return NextResponse.json({ success: true, items: rows.map(toItem) });
  } catch (e: any) {
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

// POST: 로그 생성(사전본/최종본 분리)
// body: { runId, versionId, stage, sentToEmail?, emailStatus?, emailPayload? }
// ✅ emailPayload 처리 규칙
// - undefined: 필드 생략(변경 없음)
// - null: Prisma.JsonNull 저장(JSON null)
// - object/value: 그대로 저장
export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const body = await req.json();
    const runIdStr = String(body?.runId || "").trim();
    const versionIdStr = String(body?.versionId || "").trim();
    const stageStr = String(body?.stage || "").trim();

    if (!runIdStr || !isValidNumericId(runIdStr)) throw new Error("VALIDATION:runId");
    if (!versionIdStr || !isValidNumericId(versionIdStr)) throw new Error("VALIDATION:versionId");
    if (!stageStr || !Object.values(DocumentStage).includes(stageStr as any)) throw new Error("VALIDATION:stage");

    const runId = BigInt(runIdStr);
    const versionId = BigInt(versionIdStr);

    const run = await prisma.documentRun.findUnique({
      where: { id: runId },
      select: { assignment: { select: { site: { select: { agencyId: true } } } } },
    });
    if (!run) throw new Error("NOT_FOUND");
    if (run.assignment.site.agencyId == null || run.assignment.site.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");

    const v = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: { id: true, runId: true },
    });
    if (!v) throw new Error("NOT_FOUND");
    if (v.runId !== runId) throw new Error("VALIDATION:versionId");

    const sentToEmail = body?.sentToEmail == null ? null : String(body.sentToEmail).trim();
    const emailStatus = body?.emailStatus == null ? null : String(body.emailStatus).trim();

    let emailPayloadInput: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined;
    if (Object.prototype.hasOwnProperty.call(body, "emailPayload")) {
      emailPayloadInput = body.emailPayload === null ? Prisma.JsonNull : (body.emailPayload as Prisma.InputJsonValue);
    }

    const created = await prisma.documentSubmissionLog.create({
      data: {
        run: { connect: { id: runId } },
        version: { connect: { id: versionId } },
        stage: stageStr as any,
        submittedByManager: { connect: { id: scope.managerId } },
        sentToEmail,
        emailSentAt: sentToEmail ? new Date() : null,
        emailStatus,
        ...(emailPayloadInput !== undefined ? { emailPayload: emailPayloadInput } : {}),
      },
      select: {
        id: true, runId: true, versionId: true, stage: true, submittedAt: true,
        submittedByWorkerId: true, submittedByManagerId: true,
        sentToEmail: true, emailSentAt: true, emailStatus: true, emailPayload: true,
      },
    });

    return NextResponse.json({ success: true, item: toItem(created) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
