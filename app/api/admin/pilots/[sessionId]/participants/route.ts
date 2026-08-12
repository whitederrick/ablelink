// POST /api/admin/pilots/[sessionId]/participants — 참여자 셋업(기존/신규 Worker 공통)
//
// 시스템 운영자 전용. 기존 Worker면 배정·담당 관계까지 서비스가 한 트랜잭션에서 만든다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { createPilotParticipant } from "@/lib/pilot/participant";
import { VALID_WORK_TYPES } from "@/lib/workSchedule";
import { audit } from "@/lib/audit";
import type { ServiceStep } from "@prisma/client";

const SERVICE_STEPS = ["PRE_TRAINING", "FIELD_TRAINING", "ADAPTATION"] as const;

function parseYmd(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await requireAdminSession(req);
    const { sessionId: raw } = await ctx.params;
    const pilotSessionId = parseBigInt(raw);
    if (!pilotSessionId) {
      return NextResponse.json({ success: false, message: "잘못된 회차 ID입니다." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const siteId = parseBigInt(body?.siteId);
    const workerId = body?.workerId != null ? parseBigInt(body.workerId) : null;
    const start = parseYmd(body?.assignmentStartDate);
    const end = parseYmd(body?.assignmentEndDate);
    const workType = String(body?.workType ?? "").trim();
    const serviceStep = String(body?.serviceStep ?? "FIELD_TRAINING").trim();
    const traineeIdsRaw = Array.isArray(body?.traineeIds) ? body.traineeIds : [];

    if (!siteId) {
      return NextResponse.json({ success: false, message: "사업체를 선택해주세요." }, { status: 400 });
    }
    if (body?.workerId != null && !workerId) {
      return NextResponse.json({ success: false, message: "직무지도원 ID가 올바르지 않습니다." }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json({ success: false, message: "배정 기간(YYYY-MM-DD)을 올바르게 입력해주세요." }, { status: 400 });
    }
    if (!VALID_WORK_TYPES.includes(workType as (typeof VALID_WORK_TYPES)[number])) {
      return NextResponse.json({ success: false, message: "근무형태가 올바르지 않습니다." }, { status: 400 });
    }
    if (!SERVICE_STEPS.includes(serviceStep as (typeof SERVICE_STEPS)[number])) {
      return NextResponse.json({ success: false, message: "업무 단계가 올바르지 않습니다." }, { status: 400 });
    }

    const traineeIds: bigint[] = [];
    for (const t of traineeIdsRaw) {
      const id = parseBigInt(t);
      if (!id) return NextResponse.json({ success: false, message: "훈련생 ID가 올바르지 않습니다." }, { status: 400 });
      traineeIds.push(id);
    }
    if (traineeIds.length === 0) {
      return NextResponse.json({ success: false, message: "담당 훈련생을 1명 이상 선택해주세요." }, { status: 400 });
    }
    if (new Set(traineeIds.map(String)).size !== traineeIds.length) {
      return NextResponse.json({ success: false, message: "훈련생이 중복 선택되었습니다." }, { status: 400 });
    }

    const r = await createPilotParticipant({
      pilotSessionId,
      siteId,
      workerId,
      traineeIds,
      assignmentStartDate: start,
      assignmentEndDate: end,
      serviceStep: serviceStep as ServiceStep,
      workType,
      commuteGuidanceIncluded: body?.commuteGuidanceIncluded !== false,
      customWorkStart: body?.customWorkStart ?? null,
      customWorkEnd: body?.customWorkEnd ?? null,
    });
    if (!r.ok) {
      return NextResponse.json({ success: false, message: r.message, reason: r.code }, { status: r.status });
    }

    await audit(scope, {
      entityType: "PilotParticipant", entityId: r.value.participantId, action: "create",
      after: { pilotSessionId: pilotSessionId.toString(), siteId: siteId.toString(), workerId: workerId?.toString() ?? null },
    });

    return NextResponse.json({
      success: true,
      participantId: r.value.participantId.toString(),
      assignmentId: r.value.assignmentId?.toString() ?? null,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[admin/pilots/[sessionId]/participants POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
