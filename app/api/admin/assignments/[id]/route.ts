// app/api/admin/assignments/[id]/route.ts
// 배정 근무형태 수정 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";

const VALID_WORK_TYPES = ["AM", "PM", "FULL_DAY", "CUSTOM"] as const;
type WorkType = typeof VALID_WORK_TYPES[number];

function workTimes(wt: WorkType, customStart?: string | null, customEnd?: string | null) {
  if (wt === "AM")        return { start: "09:00", end: "12:00" };
  if (wt === "PM")        return { start: "13:00", end: "17:00" };
  if (wt === "FULL_DAY")  return { start: "09:00", end: "18:00" };
  return { start: customStart ?? "09:00", end: customEnd ?? "18:00" };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const scope = await requireAdminSession(req);
    const assignmentId = BigInt(params.id);

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
    const customWorkStart = workType === "CUSTOM" ? (body.customWorkStart ?? null) : null;
    const customWorkEnd   = workType === "CUSTOM" ? (body.customWorkEnd ?? null)   : null;
    if (workType === "CUSTOM") {
      if (!customWorkStart || !HH_MM.test(customWorkStart) || !customWorkEnd || !HH_MM.test(customWorkEnd)) {
        return NextResponse.json({ success: false, message: "CUSTOM 근무시간은 HH:MM 형식으로 입력해주세요." }, { status: 400 });
      }
    }

    // AGENCY 스코프: 자기 에이전시 배정만 수정 가능
    if (scope.role === "AGENCY") {
      const agencyId = requireAgencyScope(scope);
      const existing = await prisma.siteAssignment.findUnique({
        where: { id: assignmentId },
        select: { agencyId: true },
      });
      if (!existing) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });
      if (existing.agencyId !== agencyId) return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    }

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
