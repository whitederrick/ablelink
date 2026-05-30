// app/api/admin/document-runs/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession, type ManagerScope } from "@/lib/managerScope";
import { Prisma, DocumentType, DocumentRunStatus } from "@prisma/client";

function errToStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "NOT_FOUND") return 404;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function isDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseDateOrThrow(s: string, field: string) {
  // ISO 또는 YYYY-MM-DD 모두 허용
  if (!s) throw new Error(`VALIDATION:${field}`);
  if (isDateOnly(s)) return new Date(`${s}T00:00:00.000+09:00`);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`VALIDATION:${field}`);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toItem(r: any) {
  return {
    id: String(r.id),
    agencyId: r.agencyId != null ? String(r.agencyId) : null,
    assignmentId: String(r.assignmentId),
    siteId: String(r.siteId),
    workerUserId: String(r.workerUserId),
    docType: r.docType,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    openAt: r.openAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    status: r.status,
    currentVersionId: r.currentVersionId != null ? String(r.currentVersionId) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    site: r.site
      ? {
          id: String(r.site.id),
          companyName: r.site.companyName,
          agencyId: r.site.agencyId != null ? String(r.site.agencyId) : null,
        }
      : null,
    worker: r.worker ? { id: String(r.worker.id), userName: r.worker.userName, loginId: r.worker.loginId } : null,
  };
}

// GET: 목록/검색
// query: docType, status, assignmentId, siteId, workerUserId, from, to, page, pageSize
export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { searchParams } = new URL(req.url);

    const page = parseIntSafe(searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntSafe(searchParams.get("pageSize"), 20), 100);

    const docTypeStr = (searchParams.get("docType") || "").trim();
    const statusStr = (searchParams.get("status") || "").trim();

    const assignmentIdStr = (searchParams.get("assignmentId") || "").trim();
    const siteIdStr = (searchParams.get("siteId") || "").trim();
    const workerUserIdStr = (searchParams.get("workerUserId") || "").trim();

    const fromStr = (searchParams.get("from") || "").trim();
    const toStr = (searchParams.get("to") || "").trim();

    let fromDt: Date | null = null;
    let toDt: Date | null = null;
    if (fromStr) fromDt = parseDateOrThrow(fromStr, "from");
    if (toStr) toDt = parseDateOrThrow(toStr, "to");

    const where: Prisma.DocumentRunWhereInput = {};

    if (docTypeStr) {
      if (!Object.values(DocumentType).includes(docTypeStr as any)) throw new Error("VALIDATION:docType");
      where.docType = docTypeStr as any;
    }

    if (statusStr) {
      if (!Object.values(DocumentRunStatus).includes(statusStr as any)) throw new Error("VALIDATION:status");
      where.status = statusStr as any;
    }

    if (assignmentIdStr) {
      if (!isValidNumericId(assignmentIdStr)) throw new Error("VALIDATION:assignmentId");
      where.assignmentId = BigInt(assignmentIdStr);
    }
    if (siteIdStr) {
      if (!isValidNumericId(siteIdStr)) throw new Error("VALIDATION:siteId");
      where.siteId = BigInt(siteIdStr);
    }
    if (workerUserIdStr) {
      if (!isValidNumericId(workerUserIdStr)) throw new Error("VALIDATION:workerUserId");
      where.workerUserId = BigInt(workerUserIdStr);
    }

    // 기간 필터: periodStart ~ periodEnd 오버랩
    if (fromDt || toDt) {
      where.AND = [
        ...(toDt ? [{ periodStart: { lte: toDt } }] : []),
        ...(fromDt ? [{ periodEnd: { gte: fromDt } }] : []),
      ];
    }

    // 소속 에이전시 스코프 강제
    where.agencyId = scope.agencyId;

    const [total, rows] = await Promise.all([
      prisma.documentRun.count({ where }),
      prisma.documentRun.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          agencyId: true,
          assignmentId: true,
          siteId: true,
          workerUserId: true,
          docType: true,
          periodStart: true,
          periodEnd: true,
          openAt: true,
          dueAt: true,
          status: true,
          currentVersionId: true,
          createdAt: true,
          updatedAt: true,
          site: { select: { id: true, companyName: true, agencyId: true } },
          worker: { select: { id: true, userName: true, loginId: true } },
        },
      }),
    ]);

    return NextResponse.json({ success: true, page, pageSize, total, items: rows.map(toItem) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}

// POST: Run 생성
// body: { assignmentId, docType, periodStart, periodEnd, dueAt, openAt? }
// - openAt 미지정 시 dueAt-7 (D-7 오픈 정책)
export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const body = await req.json();

    const assignmentIdStr = String(body?.assignmentId || "").trim();
    const docTypeStr = String(body?.docType || "").trim();

    if (!assignmentIdStr) throw new Error("VALIDATION:assignmentId");
    if (!isValidNumericId(assignmentIdStr)) throw new Error("VALIDATION:assignmentId");

    if (!docTypeStr) throw new Error("VALIDATION:docType");
    if (!Object.values(DocumentType).includes(docTypeStr as any)) throw new Error("VALIDATION:docType");

    const periodStart = parseDateOrThrow(String(body?.periodStart || "").trim(), "periodStart");
    const periodEnd = parseDateOrThrow(String(body?.periodEnd || "").trim(), "periodEnd");
    const dueAt = parseDateOrThrow(String(body?.dueAt || "").trim(), "dueAt");

    const openAt =
      body?.openAt != null && String(body.openAt).trim()
        ? parseDateOrThrow(String(body.openAt).trim(), "openAt")
        : addDays(dueAt, -7);

    const assignmentId = BigInt(assignmentIdStr);

    const assignment = await prisma.siteAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        userId: true,
        siteId: true,
        site: { select: { id: true, agencyId: true } },
      },
    });
    if (!assignment) throw new Error("NOT_FOUND");

    // 소속 에이전시 스코프 강제
    if (assignment.site.agencyId == null || assignment.site.agencyId !== scope.agencyId) throw new Error("FORBIDDEN");

    const created = await prisma.documentRun.create({
      data: {
        agencyId: assignment.site.agencyId, // nullable 가능
        assignment: { connect: { id: assignment.id } },
        site: { connect: { id: assignment.siteId } },
        worker: { connect: { id: assignment.userId } },

        docType: docTypeStr as any,
        periodStart,
        periodEnd,
        openAt,
        dueAt,
        status: "OPEN",
      },
      select: {
        id: true,
        agencyId: true,
        assignmentId: true,
        siteId: true,
        workerUserId: true,
        docType: true,
        periodStart: true,
        periodEnd: true,
        openAt: true,
        dueAt: true,
        status: true,
        currentVersionId: true,
        createdAt: true,
        updatedAt: true,
        site: { select: { id: true, companyName: true, agencyId: true } },
        worker: { select: { id: true, userName: true, loginId: true } },
      },
    });

    return NextResponse.json({ success: true, item: toItem(created) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errToStatus(msg) });
  }
}
