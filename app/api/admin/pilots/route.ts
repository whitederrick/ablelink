// GET  /api/admin/pilots — 파일럿 회차 목록
// POST /api/admin/pilots — 회차 생성
//
// 시스템 운영자 전용. 라우트는 인증·입력 변환·HTTP 응답만 담당하고
// 트랜잭션·불변성 규칙은 lib/pilot/session.ts에 있다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { createPilotSession } from "@/lib/pilot/session";
import { audit } from "@/lib/audit";
import type { PilotSessionStatus } from "@prisma/client";

const STATUSES: PilotSessionStatus[] = ["DRAFT", "READY", "ACTIVE", "ENDED", "PURGED", "CANCELLED"];

function parseYmd(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // 달력 왕복검증 — 2026-02-31 같은 값이 롤오버로 통과하지 않게.
  if (d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    // ★enum 화이트리스트 — 임의 문자열을 Prisma에 넘기면 400이어야 할 입력이 500이 된다.
    const rawStatus = new URL(req.url).searchParams.get("status");
    if (rawStatus && !STATUSES.includes(rawStatus as PilotSessionStatus)) {
      return NextResponse.json({ success: false, message: "알 수 없는 상태 필터입니다." }, { status: 400 });
    }
    const status = rawStatus as PilotSessionStatus | null;

    const rows = await prisma.pilotSession.findMany({
      where: status ? { status } : undefined,
      orderBy: { id: "desc" },
      take: 50,
      select: {
        id: true, status: true, startDate: true, endDate: true,
        managerDisplayName: true, activatedAt: true, endedAt: true, purgedAt: true,
        agency: { select: { id: true, name: true } },
        _count: { select: { participants: true } },
      },
    });

    return NextResponse.json({
      success: true,
      items: rows.map((r) => ({
        id: r.id.toString(),
        status: r.status,
        startDate: r.startDate.toISOString().slice(0, 10),
        endDate: r.endDate.toISOString().slice(0, 10),
        managerDisplayName: r.managerDisplayName,
        agencyId: r.agency.id.toString(),
        agencyName: r.agency.name,
        participantCount: r._count.participants,
        activatedAt: r.activatedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
        purgedAt: r.purgedAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const body = await req.json().catch(() => ({}));

    const agencyId = parseBigInt(body?.agencyId);
    const startDate = parseYmd(body?.startDate);
    const endDate = parseYmd(body?.endDate);
    const managerDisplayName = String(body?.managerDisplayName ?? "").trim() || null;

    if (!agencyId) {
      return NextResponse.json({ success: false, message: "위탁기관을 선택해주세요." }, { status: 400 });
    }
    if (!startDate || !endDate) {
      return NextResponse.json({ success: false, message: "기간(YYYY-MM-DD)을 올바르게 입력해주세요." }, { status: 400 });
    }

    const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
    if (!agency) {
      return NextResponse.json({ success: false, message: "위탁기관을 찾을 수 없습니다." }, { status: 404 });
    }

    const r = await createPilotSession({
      agencyId, startDate, endDate, managerDisplayName, createdByAdminId: scope.adminId,
    });
    if (!r.ok) {
      return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
    }

    await audit(scope, {
      entityType: "PilotSession", entityId: r.value.id, action: "create",
      after: { agencyId: agencyId.toString(), startDate: body?.startDate, endDate: body?.endDate },
    });

    return NextResponse.json({ success: true, id: r.value.id.toString(), status: r.value.status });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
