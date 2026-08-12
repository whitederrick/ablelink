// GET   /api/admin/pilots/[sessionId] — 회차 상세(참여자 포함)
// PATCH /api/admin/pilots/[sessionId] — 회차 설정 수정 또는 상태 전이
//
// 시스템 운영자 전용. 상태별 불변성·전이 규칙·회차 잠금은 lib/pilot/session.ts에 있다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { updatePilotSession, transitionPilotSession, editableFields } from "@/lib/pilot/session";
import { audit } from "@/lib/audit";
import type { PilotSessionStatus } from "@prisma/client";

// ★PURGED는 API로 전이할 수 없다 — 폐기 서비스가 실제 정리를 끝낸 뒤에만 설정한다(9단계).
const TRANSITIONS: PilotSessionStatus[] = ["DRAFT", "READY", "ACTIVE", "ENDED", "CANCELLED"];

function parseYmd(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    await requireAdminSession(req);
    const { sessionId: raw } = await ctx.params;
    const id = parseBigInt(raw);
    if (!id) return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });

    const s = await prisma.pilotSession.findUnique({
      where: { id },
      select: {
        id: true, status: true, startDate: true, endDate: true, managerDisplayName: true,
        activatedAt: true, endedAt: true, purgedAt: true,
        agency: { select: { id: true, name: true } },
        participants: {
          orderBy: { id: "asc" },
          select: {
            id: true, status: true, workerId: true, siteId: true, inviteId: true,
            createdAssignmentId: true, assignmentStartDate: true, assignmentEndDate: true,
            serviceStep: true, workType: true, acceptedAt: true,
            site: { select: { companyName: true } },
            worker: { select: { workerName: true, phoneNumber: true } },
            invite: { select: { code: true, expiresAt: true, usedAt: true, workerName: true } },
            trainees: { select: { trainee: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!s) return NextResponse.json({ success: false, message: "회차를 찾을 수 없습니다." }, { status: 404 });

    // ★회차가 만든 사업체·훈련생을 함께 내린다. 참여자에서 역산하면 첫 등록 직후
    //  아직 참여자가 없어 셋업 화면의 선택지가 비고, 다음 단계로 넘어갈 수 없다.
    const [pilotSites, pilotTrainees] = await Promise.all([
      prisma.site.findMany({
        where: { createdByPilotSessionId: id },
        orderBy: { id: "asc" },
        select: { id: true, companyName: true, address: true, businessContactName: true },
      }),
      prisma.trainee.findMany({
        where: { createdByPilotSessionId: id },
        orderBy: { id: "asc" },
        select: { id: true, name: true, currentSiteId: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      sites: pilotSites.map((x) => ({
        id: x.id.toString(),
        companyName: x.companyName,
        address: x.address,
        businessContactName: x.businessContactName,
      })),
      trainees: pilotTrainees.map((x) => ({
        id: x.id.toString(),
        name: x.name,
        siteId: x.currentSiteId?.toString() ?? null,
      })),
      session: {
        id: s.id.toString(),
        status: s.status,
        editable: editableFields(s.status),
        startDate: s.startDate.toISOString().slice(0, 10),
        endDate: s.endDate.toISOString().slice(0, 10),
        managerDisplayName: s.managerDisplayName,
        agencyId: s.agency.id.toString(),
        agencyName: s.agency.name,
        activatedAt: s.activatedAt?.toISOString() ?? null,
        endedAt: s.endedAt?.toISOString() ?? null,
        purgedAt: s.purgedAt?.toISOString() ?? null,
      },
      participants: s.participants.map((p) => ({
        id: p.id.toString(),
        status: p.status,
        isNewWorker: p.workerId == null,
        workerName: p.worker?.workerName ?? null,
        workerPhone: p.worker?.phoneNumber ?? null,
        siteId: p.siteId?.toString() ?? null,
        siteName: p.site?.companyName ?? null,
        assignmentStartDate: p.assignmentStartDate.toISOString().slice(0, 10),
        assignmentEndDate: p.assignmentEndDate.toISOString().slice(0, 10),
        serviceStep: p.serviceStep,
        workType: p.workType,
        assignmentId: p.createdAssignmentId?.toString() ?? null,
        acceptedAt: p.acceptedAt?.toISOString() ?? null,
        invite: p.invite ? {
          code: p.invite.code,
          expiresAt: p.invite.expiresAt.toISOString(),
          used: p.invite.usedAt != null,
        } : null,
        // 신규 참여자는 계정이 생기기 전이라 workerName이 없다 — 초대에 적어 둔 성명을 대신 보여준다.
        inviteWorkerName: p.invite?.workerName ?? null,
        trainees: p.trainees.map((t) => ({ id: t.trainee.id.toString(), name: t.trainee.name })),
      })),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/[sessionId] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { sessionId: raw } = await ctx.params;
    const id = parseBigInt(raw);
    if (!id) return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });

    const body = await req.json().catch(() => ({}));

    // ── 상태 전이 ────────────────────────────────────────────
    if (body?.status !== undefined) {
      const to = String(body.status) as PilotSessionStatus;
      if (!TRANSITIONS.includes(to)) {
        return NextResponse.json({ success: false, message: "알 수 없는 상태입니다." }, { status: 400 });
      }
      const r = await transitionPilotSession(id, to);
      if (!r.ok) {
        return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
      }
      await audit(scope, {
        entityType: "PilotSession", entityId: id, action: "update",
        summary: `파일럿 회차 상태 → ${to}`,
      });
      return NextResponse.json({ success: true, status: r.value.status });
    }

    // ── 설정 수정 ────────────────────────────────────────────
    const patch: Parameters<typeof updatePilotSession>[1] = {};
    if (body?.managerDisplayName !== undefined) {
      patch.managerDisplayName = String(body.managerDisplayName ?? "").trim() || null;
    }
    if (body?.startDate !== undefined) {
      const d = parseYmd(body.startDate);
      if (!d) return NextResponse.json({ success: false, message: "시작일 형식이 올바르지 않습니다." }, { status: 400 });
      patch.startDate = d;
    }
    if (body?.endDate !== undefined) {
      const d = parseYmd(body.endDate);
      if (!d) return NextResponse.json({ success: false, message: "종료일 형식이 올바르지 않습니다." }, { status: 400 });
      patch.endDate = d;
    }
    // ★agencyId는 생성 후 불변이다(lib/pilot/session.ts 참조 — 기관 발산 방지).
    if (body?.agencyId !== undefined) {
      return NextResponse.json(
        { success: false, message: "위탁기관은 회차 생성 후 변경할 수 없습니다. 새 회차를 만들어주세요.", reason: "IMMUTABLE_FIELD" },
        { status: 409 },
      );
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, message: "변경할 내용이 없습니다." }, { status: 400 });
    }

    const r = await updatePilotSession(id, patch);
    if (!r.ok) {
      return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
    }
    await audit(scope, {
      entityType: "PilotSession", entityId: id, action: "update",
      after: {
        startDate: patch.startDate?.toISOString().slice(0, 10),
        endDate: patch.endDate?.toISOString().slice(0, 10),
        managerDisplayName: patch.managerDisplayName,
      },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/[sessionId] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
