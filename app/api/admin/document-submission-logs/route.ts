// app/api/admin/document-submission-logs/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAdminSessionFromRequest } from "@/lib/adminCookies";
import { Prisma, DocumentStage } from "@prisma/client";

type AdminSession = {
  sub: string;
  role: "ADMIN" | "GOV" | "AGENCY";
  loginId: string;
  agencyName?: string | null;
};

async function getSessionOrThrow(req: Request): Promise<AdminSession> {
  const s = await readAdminSessionFromRequest(req);
  if (!s) throw new Error("UNAUTHORIZED");
  return {
    sub: String(s.sub),
    role: s.role,
    loginId: s.loginId,
    agencyName: s.agencyName ?? null,
  };
}

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

async function resolveAgencyIdByNameOrThrow(agencyName: string): Promise<bigint> {
  const a = await prisma.agency.findUnique({
    where: { name: agencyName },
    select: { id: true },
  });
  if (!a) throw new Error("VALIDATION:agencyName");
  return a.id;
}

function toItem(l: any) {
  return {
    id: String(l.id),
    runId: String(l.runId),
    versionId: String(l.versionId),
    stage: l.stage,
    submittedAt: l.submittedAt.toISOString(),
    submittedByUserId: l.submittedByUserId != null ? String(l.submittedByUserId) : null,
    submittedByAdminId: l.submittedByAdminId != null ? String(l.submittedByAdminId) : null,
    sentToEmail: l.sentToEmail ?? null,
    emailSentAt: l.emailSentAt ? l.emailSentAt.toISOString() : null,
    emailStatus: l.emailStatus ?? null,
    emailPayload: l.emailPayload ?? null,
  };
}

// GET: runId로 로그 조회
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionOrThrow(req);

    const { searchParams } = new URL(req.url);
    const runIdStr = String(searchParams.get("runId") || "").trim();
    if (!runIdStr) throw new Error("VALIDATION:runId");
    if (!isValidNumericId(runIdStr)) throw new Error("VALIDATION:runId");

    const runId = BigInt(runIdStr);

    // ✅ AGENCY 스코프 검증: assignment.site.agencyId 기준
    if (session.role === "AGENCY") {
      if (!session.agencyName) throw new Error("FORBIDDEN");
      const myAgencyId = await resolveAgencyIdByNameOrThrow(session.agencyName);

      const run = await prisma.documentRun.findUnique({
        where: { id: runId },
        select: { assignment: { select: { site: { select: { agencyId: true } } } } },
      });
      if (!run) throw new Error("NOT_FOUND");
      if (run.assignment.site.agencyId == null || run.assignment.site.agencyId !== myAgencyId) throw new Error("FORBIDDEN");
    }

    const rows = await prisma.documentSubmissionLog.findMany({
      where: { runId },
      orderBy: { id: "desc" },
      select: {
        id: true,
        runId: true,
        versionId: true,
        stage: true,
        submittedAt: true,
        submittedByUserId: true,
        submittedByAdminId: true,
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
    const session = await getSessionOrThrow(req);

    const body = await req.json();

    const runIdStr = String(body?.runId || "").trim();
    const versionIdStr = String(body?.versionId || "").trim();
    const stageStr = String(body?.stage || "").trim();

    if (!runIdStr) throw new Error("VALIDATION:runId");
    if (!versionIdStr) throw new Error("VALIDATION:versionId");
    if (!isValidNumericId(runIdStr)) throw new Error("VALIDATION:runId");
    if (!isValidNumericId(versionIdStr)) throw new Error("VALIDATION:versionId");

    if (!stageStr || !Object.values(DocumentStage).includes(stageStr as any)) throw new Error("VALIDATION:stage");

    const runId = BigInt(runIdStr);
    const versionId = BigInt(versionIdStr);

    // ✅ AGENCY 스코프 검증: run.assignment.site.agencyId
    if (session.role === "AGENCY") {
      if (!session.agencyName) throw new Error("FORBIDDEN");
      const myAgencyId = await resolveAgencyIdByNameOrThrow(session.agencyName);

      const run = await prisma.documentRun.findUnique({
        where: { id: runId },
        select: { assignment: { select: { site: { select: { agencyId: true } } } } },
      });
      if (!run) throw new Error("NOT_FOUND");
      if (run.assignment.site.agencyId == null || run.assignment.site.agencyId !== myAgencyId) throw new Error("FORBIDDEN");
    } else if (session.role !== "ADMIN" && session.role !== "GOV") {
      throw new Error("FORBIDDEN");
    }

    // version이 run 소속인지 확인
    const v = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: { id: true, runId: true },
    });
    if (!v) throw new Error("NOT_FOUND");
    if (v.runId !== runId) throw new Error("VALIDATION:versionId");

    const sentToEmail = body?.sentToEmail == null ? null : String(body.sentToEmail).trim();
    const emailStatus = body?.emailStatus == null ? null : String(body.emailStatus).trim();

    // ✅ 타입 안전한 JSON 처리
    let emailPayloadInput: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined;
    if (Object.prototype.hasOwnProperty.call(body, "emailPayload")) {
      if (body.emailPayload === null) {
        emailPayloadInput = Prisma.JsonNull;
      } else {
        emailPayloadInput = body.emailPayload as Prisma.InputJsonValue;
      }
    } else {
      emailPayloadInput = undefined; // 필드 생략
    }

    const created = await prisma.documentSubmissionLog.create({
      data: {
        run: { connect: { id: runId } },
        version: { connect: { id: versionId } },
        stage: stageStr as any,

        submittedByAdmin: { connect: { id: BigInt(session.sub) } },

        sentToEmail,
        emailSentAt: sentToEmail ? new Date() : null,
        emailStatus,

        ...(emailPayloadInput !== undefined ? { emailPayload: emailPayloadInput } : {}),
      },
      select: {
        id: true,
        runId: true,
        versionId: true,
        stage: true,
        submittedAt: true,
        submittedByUserId: true,
        submittedByAdminId: true,
        sentToEmail: true,
        emailSentAt: true,
        emailStatus: true,
        emailPayload: true,
      },
    });

    return NextResponse.json({ success: true, item: toItem(created) });
  } catch (e: any) {
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
