// 시스템 운영자 전용: 개인정보 접속기록(AccessLog) 조회 — 읽기 전용.
//  · 안전성 확보조치 기준 제8조 접속기록 열람·점검·CSV(월점검) 지원.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { escapeCsvCell } from "@/lib/csv";

const ACTOR_TYPES = ["ADMIN", "MANAGER"] as const;
const PAGE_SIZES = [10, 20, 50];

// PERF-3: 필터 드롭다운 어휘(resource/action)는 필터와 무관한 전역 값인데 매 페이지 요청마다
//  DISTINCT 전체스캔 2회를 돌렸다. 거의 변하지 않으므로 인스턴스 메모리에 60초 캐시한다.
const VOCAB_TTL_MS = 60_000;
let vocabCache: { at: number; resources: string[]; actions: string[] } | null = null;

async function getVocab(): Promise<{ resources: string[]; actions: string[] }> {
  if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL_MS) {
    return { resources: vocabCache.resources, actions: vocabCache.actions };
  }
  const [resourcesRaw, actionsRaw] = await Promise.all([
    prisma.accessLog.findMany({ select: { resource: true }, distinct: ["resource"], orderBy: { resource: "asc" }, take: 100 }),
    prisma.accessLog.findMany({ select: { action: true }, distinct: ["action"], orderBy: { action: "asc" }, take: 50 }),
  ]);
  const resources = resourcesRaw.map(r => r.resource).filter(Boolean);
  const actions = actionsRaw.map(a => a.action).filter(Boolean);
  vocabCache = { at: Date.now(), resources, actions };
  return { resources, actions };
}

function toDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const rawSize = parseInt(searchParams.get("pageSize") ?? "20", 10) || 20;
    const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : 20;

    const actorType = searchParams.get("actorType")?.trim() ?? "";
    const resource = searchParams.get("resource")?.trim() ?? "";
    const action = searchParams.get("action")?.trim() ?? "";
    const q = searchParams.get("q")?.trim() ?? "";
    const from = toDate(searchParams.get("from"));
    const to = toDate(searchParams.get("to"));

    const where: Prisma.AccessLogWhereInput = {};
    if (actorType && (ACTOR_TYPES as readonly string[]).includes(actorType)) {
      where.actorType = actorType as (typeof ACTOR_TYPES)[number];
    }
    if (resource) where.resource = resource;
    if (action) where.action = action;
    if (q) {
      where.OR = [
        { actorLabel: { contains: q } },
        { subjectLabel: { contains: q } },
        { subjectId: { contains: q } },
        { ip: { contains: q } },
      ];
    }
    if (from || to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (from) createdAt.gte = from;
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }

    // CSV 다운로드(현재 필터 기준, 최대 10000건) — 월점검·보관 근거
    if (searchParams.get("format") === "csv") {
      const rows = await prisma.accessLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 10000 });
      const esc = escapeCsvCell;
      const header = ["접속일시", "취급자유형", "취급자(계정)", "위탁기관ID", "접속지(IP)", "정보주체유형", "정보주체ID", "정보주체", "열람정보", "수행업무", "경로"];
      const lines = [header.join(",")];
      for (const e of rows) {
        lines.push([
          new Date(e.createdAt).toISOString(),
          e.actorType,
          e.actorLabel ?? "",
          e.agencyId?.toString() ?? "",
          e.ip ?? "",
          e.subjectType,
          e.subjectId ?? "",
          e.subjectLabel ?? "",
          e.resource,
          e.action,
          e.path ?? "",
        ].map(esc).join(","));
      }
      const csv = "﻿" + lines.join("\r\n"); // BOM: Excel 한글 깨짐 방지
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="access_log_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const [items, total, vocab] = await Promise.all([
      prisma.accessLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.accessLog.count({ where }),
      getVocab(),
    ]);

    return NextResponse.json({
      success: true,
      total,
      page,
      pageSize,
      resourceOptions: vocab.resources,
      actionOptions: vocab.actions,
      items: items.map(e => ({
        id: e.id.toString(),
        agencyId: e.agencyId?.toString() ?? null,
        actorType: e.actorType,
        actorId: e.actorId?.toString() ?? null,
        actorLabel: e.actorLabel ?? null,
        ip: e.ip ?? null,
        subjectType: e.subjectType,
        subjectId: e.subjectId ?? null,
        subjectLabel: e.subjectLabel ?? null,
        resource: e.resource,
        action: e.action,
        path: e.path ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
