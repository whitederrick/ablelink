// app/api/admin/assignments/[id]/route.ts
// 배정 근무형태 수정 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { VALID_WORK_TYPES, type WorkType, computeWorkTimes } from "@/lib/workSchedule";

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

    // 수동 계약기간(전자계약서 PRO 전용 대비) — 배정 기간이 접근 판정의 계약기간 역할
    const updateData: any = { workType, commuteGuidanceIncluded, customWorkStart, customWorkEnd };
    if (body.attendanceButtonExempt !== undefined) updateData.attendanceButtonExempt = body.attendanceButtonExempt === true;
    if (body.startDate !== undefined && body.startDate) updateData.startDate = new Date(body.startDate);
    if (body.endDate !== undefined)  updateData.endDate  = body.endDate ? new Date(body.endDate) : null;
    // 서비스 단계 전환(지원고용 ↔ 적응지도). 미지정 시 기존값 유지.
    const VALID_STEPS = ["PRE_TRAINING", "FIELD_TRAINING", "ADAPTATION"];
    if (body.serviceStep !== undefined) {
      const step = String(body.serviceStep).trim();
      if (!VALID_STEPS.includes(step)) {
        return NextResponse.json({ success: false, message: "유효하지 않은 서비스 단계입니다." }, { status: 400 });
      }
      updateData.serviceStep = step;
    }
    // 적응지도 전환일(선택) — 빈값/없음이면 null(단건), 날짜면 분할 배정
    if (body.adaptationStartDate !== undefined) {
      updateData.adaptationStartDate = body.adaptationStartDate ? new Date(body.adaptationStartDate) : null;
    }

    const updated = await prisma.siteAssignment.update({
      where: { id: assignmentId },
      data: updateData,
      select: {
        id: true,
        workType: true,
        commuteGuidanceIncluded: true,
        customWorkStart: true,
        customWorkEnd: true,
        serviceStep: true,
      },
    });

    const times = computeWorkTimes(workType, commuteGuidanceIncluded, customWorkStart, customWorkEnd);

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
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
