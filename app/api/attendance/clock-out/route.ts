// app/api/attendance/clock-out/route.ts
// 퇴근 처리 및 GPS 반경 검증 API (+ assignmentId/basePointId/거리증빙 저장)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

/**
 * 하버사인(Haversine) 공식을 이용한 두 좌표 사이의 거리 계산 함수 (단위: m)
 */
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 최종 종료 여부 판단 (스키마에 따라 필드명이 다를 수 있어 동적 체크)
 */
function isFinalizedAttendance(attendance: any) {
  return Boolean(
    attendance?.isFinalClosed === true ||
      attendance?.isFinalized === true ||
      attendance?.finalizedAt != null ||
      attendance?.closedAt != null
  );
}

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function toBigIntOrNull(v: any): bigint | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!isValidNumericId(s)) return null;
  return BigInt(s);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: “인증이 필요합니다.” }, { status: 401 });
    }

    const body = await request.json();

    // ✅ 확장 입력(선택): assignmentId/basePointId
    // - assignmentId/basePointId는 “증빙” 목적이며, 없으면 서버가 자동 산정/보강합니다.
    // - reconfirm: 퇴근 시간 재확인(END 시간/좌표 업데이트)
    // - finalize: 최종 업무 종료(이후 재확인 불가)
    // - confirmOutOfRange: 거리 밖 경고 확인 후 재요청 시 true
    const {
      latitude,
      longitude,
      isGpsModified,
      reconfirm,
      finalize,
      confirmOutOfRange,
      assignmentId: inputAssignmentId,
      basePointId: inputBasePointId,
    } = body;

    const action = finalize ? “FINALIZE” : reconfirm ? “RECONFIRM” : “CLOCK_OUT”;

    console.log(
      `[퇴근 요청] action=${action}, User=${session.userId}, lat=${latitude}, lon=${longitude}, 보정여부=${isGpsModified}, 거리예외확인=${confirmOutOfRange}, assignmentId=${inputAssignmentId ?? “auto”}, basePointId=${inputBasePointId ?? “auto”}`
    );

    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { success: false, message: “필수 정보(위치)가 누락되었습니다.” },
        { status: 400 }
      );
    }

    const userIdBig = BigInt(session.userId);

    // [STEP 1] 오늘 날짜의 출근 기록 찾기
    // - 최초 퇴근(CLOCK_OUT): WORKING 상태만 허용
    // - 재확인/최종종료(RECONFIRM/FINALIZE): DONE 상태에서만 허용
    const todayString = getKstDateString();

    const attendance = await prisma.dailyAttendance.findFirst({
      where: {
        userId: userIdBig,
        workDate: todayString,
        status: action === "CLOCK_OUT" ? "WORKING" : "DONE",
      },
      include: { site: true },
    });

    if (!attendance) {
      return NextResponse.json(
        {
          success: false,
          message:
            action === "CLOCK_OUT"
              ? "진행 중인 출근 기록을 찾을 수 없습니다."
              : "재확인/업무종료 가능한 퇴근 기록을 찾을 수 없습니다.",
        },
        { status: 404 }
      );
    }

    // 재확인/최종종료는 "최종 종료" 이후 불가
    if (action !== "CLOCK_OUT" && isFinalizedAttendance(attendance)) {
      return NextResponse.json(
        { success: false, message: "이미 최종 업무 종료 처리된 기록입니다. 재확인은 불가합니다." },
        { status: 409 }
      );
    }

    const site = attendance.site;

    if (!site) {
      return NextResponse.json(
        { success: false, message: "현장 정보를 찾을 수 없습니다." },
        { status: 409 }
      );
    }

    // ✅ 허용 반경: site.allowanceRange 우선, 없으면 100m
    const allowedRangeMeters = Number(site.allowanceRange ?? 100);

    // [STEP 2] (증빙) assignmentId 결정/보강
    // - 우선순위: body.assignmentId -> attendance.assignmentId -> 최신 유효 배정
    const inputAssignmentIdBig = toBigIntOrNull(inputAssignmentId);
    let decidedAssignmentId: bigint | null = inputAssignmentIdBig ?? (attendance.assignmentId ?? null);

    if (decidedAssignmentId) {
      // "내 배정" + 유효 상태인지 검증
      const a = await prisma.siteAssignment.findFirst({
        where: {
          id: decidedAssignmentId,
          userId: userIdBig,
          status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
        },
        select: { id: true, siteId: true },
      });

      if (!a) {
        return NextResponse.json(
          { success: false, message: "VALIDATION:assignmentId" },
          { status: 400 }
        );
      }

      // 출근 기록의 siteId와 배정의 siteId는 일치해야 함
      if (a.siteId !== attendance.siteId) {
        return NextResponse.json(
          { success: false, message: "FORBIDDEN" },
          { status: 403 }
        );
      }
      decidedAssignmentId = a.id;
    } else {
      // attendance.assignmentId가 없고 body에도 없으면 최신 유효 배정 보강
      const a = await prisma.siteAssignment.findFirst({
        where: {
          userId: userIdBig,
          siteId: attendance.siteId,
          status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
        },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      decidedAssignmentId = a?.id ?? null;
    }

    // [STEP 3] (증빙) basePointId 결정/보강
    // 우선순위: body.basePointId -> attendance.basePointId -> site.currentBasePointId -> 레거시(site.gpsLat/gpsLon)
    const inputBasePointIdBig = toBigIntOrNull(inputBasePointId);
    const effectiveBasePointId: bigint | null =
      inputBasePointIdBig ?? (attendance.basePointId ?? null) ?? (site.currentBasePointId ?? null);

    let baseLat: number | null = null;
    let baseLon: number | null = null;
    let decidedBasePointId: bigint | null = null;

    if (effectiveBasePointId) {
      const bp = await prisma.siteBasePoint.findFirst({
        where: { id: effectiveBasePointId, siteId: site.id },
        select: { id: true, lat: true, lon: true },
      });

      if (!bp) {
        return NextResponse.json(
          { success: false, message: "VALIDATION:basePointId" },
          { status: 400 }
        );
      }

      decidedBasePointId = bp.id;
      baseLat = Number(bp.lat);
      baseLon = Number(bp.lon);
    } else {
      // 레거시 기준점(호환)
      if (
        site.gpsLat === null ||
        site.gpsLon === null ||
        site.gpsLat === undefined ||
        site.gpsLon === undefined ||
        Number.isNaN(Number(site.gpsLat)) ||
        Number.isNaN(Number(site.gpsLon))
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "현장 기준점(GPS)이 설정되지 않았습니다. 현장 정보를 수정 후 다시 시도해주세요.",
          },
          { status: 409 }
        );
      }
      baseLat = Number(site.gpsLat);
      baseLon = Number(site.gpsLon);
    }

    // [STEP 4] GPS 위치 검증 (현장 기준 좌표와 allowanceRange 이내인지 확인)
    const distance = getDistance(
      Number(latitude),
      Number(longitude),
      Number(baseLat),
      Number(baseLon)
    );

    const distanceMeters = Math.round(distance);
    const withinRange = distance <= allowedRangeMeters;

    // ✅ 거리 밖이면 정책(B: 예외허용) - confirmOutOfRange 없으면 409로 경고 응답
    if (!withinRange && confirmOutOfRange !== true && confirmOutOfRange !== "true") {
      return NextResponse.json(
        {
          success: false,
          code: "OUT_OF_RANGE",
          message: `현장 반경(${allowedRangeMeters}m)을 벗어났습니다.`,
          action,
          distanceMeters,
          allowedRangeMeters,
        },
        { status: 409 }
      );
    }

    // ✅ 거리 밖 예외 진행이면 isGpsModified를 true로 강제(감사/표시 목적)
    const forceGpsModified =
      (!withinRange && (confirmOutOfRange === true || confirmOutOfRange === "true"))
        ? true
        : Boolean(isGpsModified);

    // [STEP 5] 퇴근 기록 업데이트
    // - CLOCK_OUT: WORKING -> DONE + endTime/endLoc + endDistanceM/withinRange/rangeM + 증빙ID 저장
    // - RECONFIRM: DONE 유지 + endTime/endLoc 재기록 + endDistanceM/withinRange/rangeM 갱신 + 증빙ID 보강
    // - FINALIZE: DONE 유지 + 최종 종료 플래그 기록
    //   ✅ 정책: "마감 시간은 마지막 endTime" → FINALIZE에서는 endTime/endLoc을 변경하지 않음
    let updatedAttendance: any;

    if (action === "FINALIZE") {
      updatedAttendance = await prisma.dailyAttendance.update({
        where: { id: attendance.id },
        data: {
          isFinalClosed: true,
          finalizedAt: attendance.endTime ?? new Date(),
          // 최종종료에서도 증빙 ID는 비어있으면 보강(선택)
          assignmentId: attendance.assignmentId ?? decidedAssignmentId,
          basePointId: attendance.basePointId ?? decidedBasePointId,
          // ✅ 거리 밖 예외 진행이면 isGpsModified를 true로 강제
          isGpsModified: attendance.isGpsModified || forceGpsModified,
        } as any,
      });
    } else {
      const baseUpdateData: any = {
        endTime: new Date(),
        endLocLat: Number(latitude),
        endLocLon: Number(longitude),
        status: "DONE",

        // ✅ 증빙/판정 저장
        assignmentId: attendance.assignmentId ?? decidedAssignmentId,
        basePointId: attendance.basePointId ?? decidedBasePointId,
        endDistanceM: distanceMeters,
        withinRange: withinRange,
        rangeM: allowedRangeMeters,

        // 출근 시 보정했거나 퇴근 시 보정했다면 true로 유지
        isGpsModified: attendance.isGpsModified || forceGpsModified,
      };

      updatedAttendance = await prisma.dailyAttendance.update({
        where: { id: attendance.id },
        data: baseUpdateData as any,
      });
    }

    const message =
      action === "CLOCK_OUT"
        ? `${site.companyName} 현장으로 퇴근 처리되었습니다.`
        : action === "RECONFIRM"
        ? `퇴근 시간이 재확인(업데이트)되었습니다.`
        : `업무가 최종 종료되었습니다.`;

    return NextResponse.json({
      success: true,
      message,
      action,

      // 기존 호환 + 메트릭
      distance: distanceMeters,
      distanceMeters,
      allowedRangeMeters,
      withinRange,

      // ✅ 증빙 반환
      assignmentId: (attendance.assignmentId ?? decidedAssignmentId) != null ? String(attendance.assignmentId ?? decidedAssignmentId) : null,
      basePointId: (attendance.basePointId ?? decidedBasePointId) != null ? String(attendance.basePointId ?? decidedBasePointId) : null,

      data: updatedAttendance,
    });
  } catch (error) {
    console.error("퇴근 처리 에러:", error);
    return NextResponse.json(
      {
        success: false,
        error: "서버 에러 발생",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
