// app/api/admin/assignments/[id]/route.ts
// 배정 근무형태 수정 API

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession, requireAdminOrManagerSession } from "@/lib/managerScope";
import { VALID_WORK_TYPES, type WorkType, computeWorkTimes } from "@/lib/workSchedule";
import { audit, auditSnapshot } from "@/lib/audit";
import { findTimeConflict, assignmentsTimeConflict, OCCUPYING_STATUSES, isSameAgencyConflict } from "@/lib/assignmentOverlap";
import { withWorkerAssignmentLock, withSiteAndWorkersAssignmentLock } from "@/lib/assignmentLock";
import { checkSiteCapacity } from "@/lib/assignmentCapacity";

// 배정 취소(종료) — 위탁기관 담당자(매니저)·시스템 운영자 공통.
// 진행 중(REQUESTED/ACCEPTED/ASSIGNED/CONFIRMED/ACTIVE) 배정을 ENDED로 종료 → 재배정 가능.
const CANCELABLE = ["REQUESTED", "ACCEPTED", "ASSIGNED", "CONFIRMED", "ACTIVE"];
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;
    const assignmentId = BigInt(id);

    const existing = await prisma.siteAssignment.findUnique({
      where: { id: assignmentId },
      select: { agencyId: true, status: true },
    });
    if (!existing) return NextResponse.json({ success: false, message: "배정을 찾을 수 없습니다." }, { status: 404 });
    if (session.kind === "manager" && existing.agencyId !== session.agencyId) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }
    if (!CANCELABLE.includes(existing.status)) {
      return NextResponse.json({ success: false, message: "이미 종료된 배정입니다." }, { status: 409 });
    }

    let reason = "배정 취소";
    try { const b = await req.json(); if (b?.reason) reason = String(b.reason).trim() || reason; } catch { /* body 없음 */ }

    await prisma.siteAssignment.update({
      where: { id: assignmentId },
      data: { status: "ENDED", endedAt: new Date(), statusReason: reason },
    });
    await audit(session, { entityType: "SiteAssignment", entityId: assignmentId, action: "delete", summary: `배정 취소(종료): ${reason}` });
    return NextResponse.json({ success: true, message: "배정이 취소(종료)되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/assignments/[id] DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 듀얼: 매니저=본 기관 배정만, 운영자(x-admin-context)=전체. (출퇴근 면제·근무형태 수정)
    const session = await requireAdminOrManagerSession(req);
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

    // 매니저는 본 기관 배정만, 운영자는 전체
    const existing = await prisma.siteAssignment.findUnique({
      where: { id: assignmentId },
      select: { agencyId: true, siteId: true, workerId: true, status: true, startDate: true, endDate: true, workType: true, customWorkStart: true, customWorkEnd: true },
    });
    if (!existing) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });
    if (session.kind === "manager" && existing.agencyId !== session.agencyId) return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

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

    // ★멀티현장 시간겹침 방지: 변경 후 근무형태/기간이 같은 워커의 다른 진행중 배정과
    //   같은 날 반나절 슬롯(AM/PM)이 겹치면 차단(예: 한 현장 오전 + 다른 현장 종일).
    // #7: 겹침 재검사 → update를 워커 advisory 락 트랜잭션으로 직렬화(다른 6개 승격 경로와 통일).
    //  락이 없으면 이 PATCH의 검사~쓰기 사이에 respond/finalize 등 동시 승격을 놓쳐 이중배정이 샌다(TOCTOU).
    const auditBefore = await auditSnapshot("SiteAssignment", { id: assignmentId }, updateData);
    const lockResult = await withSiteAndWorkersAssignmentLock(existing.siteId, [existing.workerId], async (tx) => {
      const candidate = {
        workType, customWorkStart, customWorkEnd,
        startDate: updateData.startDate ?? existing.startDate,
        endDate: "endDate" in updateData ? updateData.endDate : existing.endDate,
      };
      // 이중배정 방지는 전역(크로스기관)으로 검사 — 타 기관 배정과도 시간이 겹치면 안 됨.
      //  타 기관 충돌은 현장명 비노출·일반 문구로 차단해 크로스테넌트 정보를 드러내지 않는다.
      // E3: ACCEPTED(최종확정 대기)도 점유로 포함(respond 경로와 통일).
      const others = await tx.siteAssignment.findMany({
        where: { workerId: existing.workerId, status: { in: [...OCCUPYING_STATUSES] }, NOT: { id: assignmentId } },
        select: { workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true, agencyId: true, site: { select: { companyName: true } } },
      });
      // W#6: '새로 생기는' 충돌만 차단 — 편집 전부터 겹치던 레거시 배정은 무관 필드(serviceStep·면제 등) 편집을 막지 않는다.
      const preEdit = { workType: existing.workType, customWorkStart: existing.customWorkStart, customWorkEnd: existing.customWorkEnd, startDate: existing.startDate, endDate: existing.endDate };
      const newConflict = others.find(o => assignmentsTimeConflict(candidate, o) && !assignmentsTimeConflict(preEdit, o));
      if (newConflict) {
        const msg = isSameAgencyConflict((newConflict as any).agencyId, existing.agencyId)
          ? `다른 현장(${(newConflict as any).site?.companyName ?? "-"}) 배정과 같은 날 근무시간이 겹칩니다. 근무형태(오전/오후/종일)를 조정해주세요.`
          : `이 직무지도원은 이미 다른 일정이 있어 해당 기간·근무형태로 변경할 수 없습니다. 근무형태(오전/오후/종일)를 조정해주세요.`;
        return { conflict: msg } as const;
      }
      // ★17차#3: 근무형태(workType) 변경 시 슬롯 정원을 재검사(finalize·respond·직접배정과 통일). 점유 상태
      //  (ASSIGNED/CONFIRMED/ACTIVE) 배정을 꽉 찬 슬롯으로 바꾸면 정원 초과가 됐다(주석 190의 미가드 경로 종결).
      //  미점유(REQUESTED/ACCEPTED)는 아직 슬롯을 소비하지 않으므로 제외(finalize 시점에 검사). 현장 락 안에서 원자.
      const isOccupying = (["ASSIGNED", "CONFIRMED", "ACTIVE"] as string[]).includes(existing.status);
      if (isOccupying && workType !== existing.workType) {
        // ★구조적 종결: 정원 재검사를 단일 chokepoint에 위임(자기 행 제외). 미점유·형태무변경은 검사 안 함(불필요 409 방지).
        const overflow = await checkSiteCapacity(tx, existing.siteId, { [workType]: 1 }, { excludeAssignmentId: assignmentId });
        if (overflow) {
          const slotLabel: Record<string, string> = { AM: "오전", PM: "오후", FULL_DAY: "전일", CUSTOM: "맞춤" };
          return { conflict: `${slotLabel[overflow.slot] ?? overflow.slot} 정원을 초과하여 근무형태를 변경할 수 없습니다. (모집 ${overflow.remaining}명)` } as const;
        }
      }
      const row = await tx.siteAssignment.update({
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
      return { row } as const;
    });

    if ("conflict" in lockResult) {
      return NextResponse.json({ success: false, message: lockResult.conflict }, { status: 409 });
    }
    const updated = lockResult.row;

    await audit(session, { entityType: "SiteAssignment", entityId: assignmentId, action: "update", before: auditBefore, after: updateData });

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
