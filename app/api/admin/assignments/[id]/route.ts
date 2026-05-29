// app/api/admin/assignments/[id]/route.ts
// 배정 근무형태 수정 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

const VALID_WORK_TYPES = ["AM", "PM", "FULL_DAY", "CUSTOM"] as const;
type WorkType = typeof VALID_WORK_TYPES[number];

// 기본 근무시간 (관리자 미설정 시)
const DEFAULT_TIMES: Record<WorkType, { start: string; end: string }> = {
  AM:       { start: "09:00", end: "13:00" },
  PM:       { start: "13:00", end: "17:00" },
  FULL_DAY: { start: "09:00", end: "18:00" },  // 점심 1H 공제 → 8H 인정
  CUSTOM:   { start: "09:00", end: "18:00" },
};

function workTimes(wt: WorkType, customStart?: string | null, customEnd?: string | null) {
  const def = DEFAULT_TIMES[wt];
  return { start: customStart ?? def.start, end: customEnd ?? def.end };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const assignmentId = BigInt(id);

    const body = await req.json();

    const rawWorkType = String(body.workType ?? "").trim();
    if (!VALID_WORK_TYPES.includes(rawWorkType as WorkType)) {
      return NextResponse.json({ success: false, message: "유효하지 않은 근무형태입니다." }, { status: 400 });
    }
    const workType = rawWorkType as WorkType;

    // FULL_DAY: 법적 8시간 초과 금지 → 출퇴근 지도 강제 false
    const commuteGuidanceIncluded = workType === "FULL_DAY"
      ? false
      : (body.commuteGuidanceIncluded !== false);

    const HH_MM = /^\d{2}:\d{2}$/;
    // 모든 근무형태에서 관리자가 시간을 직접 설정 가능 (미입력 시 기본값 사용)
    const rawStart = body.customWorkStart ?? null;
    const rawEnd   = body.customWorkEnd   ?? null;
    const customWorkStart = (rawStart && HH_MM.test(rawStart)) ? rawStart : null;
    const customWorkEnd   = (rawEnd   && HH_MM.test(rawEnd))   ? rawEnd   : null;
    if (workType === "CUSTOM" && (!customWorkStart || !customWorkEnd)) {
      return NextResponse.json({ success: false, message: "직접입력 근무시간은 HH:MM 형식으로 입력해주세요." }, { status: 400 });
    }

    // 자기 에이전시 배정만 수정 가능
    const agencyId = scope.agencyId;
    const existing = await prisma.siteAssignment.findUnique({
      where: { id: assignmentId },
      select: { agencyId: true },
    });
    if (!existing) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });
    if (existing.agencyId !== agencyId) return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const updated = await prisma.siteAssignment.update({
      where: { id: assignmentId },
      data: { workType, commuteGuidanceIncluded, customWorkStart, customWorkEnd },
      select: {
        id: true,
        workType: true,
        commuteGuidanceIncluded: true,
        customWorkStart: true,
        customWorkEnd: true,
      },
    });

    const times = workTimes(workType, customWorkStart, customWorkEnd);

    return NextResponse.json({
      success: true,
      item: {
        ...updated,
        id: String(updated.id),
        workStart: times.start,
        workEnd: times.end,
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/assignments/[id]]", e);
    return NextResponse.json({ success: false, message: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}
