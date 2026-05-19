// app/api/attendance/clock-in/route.ts
// 출근 처리 및 GPS 반경 검증 API (+ assignmentId/basePointId/거리증빙 저장)

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";

/**
 * 하버사인(Haversine) 거리(m) 계산
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

function isValidNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

function toBigIntOrNull(v: any): bigint | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!isValidNumericId(s)) return null;
  return BigInt(s);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // ✅ 확장 입력: assignmentId/basePointId (없으면 서버가 자동 산정)
    const {
      userId,
      siteId, // (옵션) 클라이언트가 같이 보내면 검증에 활용 가능
      assignmentId: inputAssignmentId,
      basePointId: inputBasePointId,
      latitude,
      longitude,
      accuracyM, // (옵션) 클라 제공 정확도
      isGpsModified,
      confirmOutOfRange,
    } = body;

    const userIdStr = String(userId ?? "").trim();
    if (!isValidNumericId(userIdStr)) {
      return NextResponse.json({ success: false, message: "VALIDATION:userId" }, { status: 400 });
    }
    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json({ success: false, message: "VALIDATION:location" }, { status: 400 });
    }

    const userIdBig = BigInt(userIdStr);
    const assignmentIdBig = toBigIntOrNull(inputAssignmentId);
    const basePointIdBig = toBigIntOrNull(inputBasePointId);
    const siteIdBig = toBigIntOrNull(siteId);

    console.log(
      `[출근 요청] userId=${userIdStr}, lat=${latitude}, lon=${longitude}, assignmentId=${assignmentIdBig ?? "auto"}, basePointId=${basePointIdBig ?? "auto"}, confirmOutOfRange=${confirmOutOfRange}`
    );

    // [STEP 1] 오늘 중복 출근 체크
    const todayString = getKstDateString();
    const existingRecord = await prisma.dailyAttendance.findFirst({
      where: {
        userId: userIdBig,
        workDate: todayString,
      },
      select: { id: true },
    });

    if (existingRecord) {
      return NextResponse.json(
        { success: false, message: "이미 오늘 출근 기록이 있습니다." },
        { status: 400 }
      );
    }

    // [STEP 2] 유효 배정 조회
    // - 클라이언트가 assignmentId를 주면 그 배정이 "내 것"인지 + (옵션) siteId 일치 검증
    // - 없으면 최신 유효 배정(ASSIGNED/CONFIRMED/ACTIVE) 1건을 선택
    const validStatuses = ["ASSIGNED", "CONFIRMED", "ACTIVE"] as const;

    const assignment = assignmentIdBig
      ? await prisma.siteAssignment.findFirst({
          where: {
            id: assignmentIdBig,
            userId: userIdBig,
            status: { in: [...validStatuses] },
          },
          include: { site: true },
        })
      : await prisma.siteAssignment.findFirst({
          where: {
            userId: userIdBig,
            status: { in: [...validStatuses] },
          },
          orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
          include: { site: true },
        });

    if (!assignment || !assignment.site) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });
    }

    // (옵션) client가 siteId를 보냈으면 일치 검증
    if (siteIdBig && assignment.siteId !== siteIdBig) {
      return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    }

    const site = assignment.site;

    // [STEP 3] 기준점(BasePoint) 결정
    // 우선순위: body.basePointId -> site.currentBasePointId -> (레거시) site.gpsLat/Lon
    let baseLat: number | null = null;
    let baseLon: number | null = null;
    let decidedBasePointId: bigint | null = null;

    const effectiveBasePointId = basePointIdBig ?? (site.currentBasePointId ?? null);

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
      // 레거시 기준점
      if (
        site.gpsLat === null ||
        site.gpsLon === null ||
        site.gpsLat === undefined ||
        site.gpsLon === undefined ||
        Number.isNaN(Number(site.gpsLat)) ||
        Number.isNaN(Number(site.gpsLon))
      ) {
        return NextResponse.json(
          { success: false, message: "현장 기준점(GPS)이 설정되지 않았습니다. 현장 정보를 수정 후 다시 시도해주세요." },
          { status: 409 }
        );
      }
      baseLat = Number(site.gpsLat);
      baseLon = Number(site.gpsLon);
    }

    // [STEP 4] 거리/범위 판정
    const allowedRangeMeters = Number(site.allowanceRange ?? 100);

    const distance = getDistance(
      Number(latitude),
      Number(longitude),
      Number(baseLat),
      Number(baseLon)
    );

    const distanceMeters = Math.round(distance);
    const withinRange = distance <= allowedRangeMeters;

    // 정책(B): 반경 밖이면 confirmOutOfRange 없을 때 409 경고
    if (!withinRange && confirmOutOfRange !== true && confirmOutOfRange !== "true") {
      return NextResponse.json(
        {
          success: false,
          code: "OUT_OF_RANGE",
          message: `현장 반경(${allowedRangeMeters}m)을 벗어났습니다.`,
          distanceMeters,
          allowedRangeMeters,
        },
        { status: 409 }
      );
    }

    // 반경 밖 예외 진행이면 isGpsModified true로 강제(감사/표시 목적)
    const forceGpsModified =
      (!withinRange && (confirmOutOfRange === true || confirmOutOfRange === "true"))
        ? true
        : Boolean(isGpsModified);

    // [STEP 5] 출근 기록 저장 (증빙 필드 포함)
    const newAttendance = await prisma.dailyAttendance.create({
      data: {
        userId: userIdBig,
        siteId: site.id,
        assignmentId: assignment.id,              // ✅ 증빙
        basePointId: decidedBasePointId,          // ✅ 증빙(없을 수 있음)
        workDate: todayString,

        startTime: new Date(),
        startLocLat: Number(latitude),
        startLocLon: Number(longitude),

        startDistanceM: distanceMeters,           // ✅ 증빙
        withinRange: withinRange,                 // ✅ 증빙
        rangeM: allowedRangeMeters,               // ✅ 증빙

        isGpsModified: forceGpsModified,
        status: "WORKING",
        // accuracyM를 DB에 별도 저장하는 필드가 없다면 여기선 보관하지 않음
      },
    });

    return NextResponse.json({
      success: true,
      message: `${site.companyName} 현장으로 출근 처리되었습니다.`,
      distance: distanceMeters, // 기존 호환 유지
      distanceMeters,
      allowedRangeMeters,
      withinRange,
      assignmentId: String(assignment.id),
      basePointId: decidedBasePointId != null ? String(decidedBasePointId) : null,
      data: newAttendance,
    });
  } catch (error) {
    console.error("출근 처리 에러:", error);
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
