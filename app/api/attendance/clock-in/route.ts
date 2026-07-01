// app/api/attendance/clock-in/route.ts
// 출근 처리 및 GPS 반경 검증 API (+ assignmentId/basePointId/거리증빙 저장)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { computeWorkTimes, kstWallTimeToInstant } from "@/lib/workSchedule";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

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

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();

    // ✅ 확장 입력: assignmentId/basePointId (없으면 서버가 자동 산정)
    const {
      siteId, // (옵션) 클라이언트가 같이 보내면 검증에 활용 가능
      assignmentId: inputAssignmentId,
      basePointId: inputBasePointId,
      latitude,
      longitude,
      isGpsModified,
      confirmOutOfRange,
    } = body;

    const userIdStr = session.workerId;
    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json({ success: false, message: "VALIDATION:location" }, { status: 400 });
    }

    const userIdBig = BigInt(userIdStr);
    const assignmentIdBig = toBigIntOrNull(inputAssignmentId);
    const basePointIdBig = toBigIntOrNull(inputBasePointId);
    const siteIdBig = toBigIntOrNull(siteId);

    console.log(
      `[출근 요청] workerId=${userIdStr}, assignmentId=${assignmentIdBig ?? "auto"}, basePointId=${basePointIdBig ?? "auto"}, confirmOutOfRange=${confirmOutOfRange}`
    );

    const todayString = getKstDateString();

    // [STEP 1] 유효 배정 조회 (중복 체크보다 먼저 — 멀티 배정에선 "오늘 이 배정" 기준으로 중복 판정해야 함)
    // - 클라이언트가 assignmentId를 주면 그 배정이 "내 것"인지 + (옵션) siteId 일치 검증
    // - 없으면 최신 유효 배정(ASSIGNED/CONFIRMED/ACTIVE) 1건을 선택
    const validStatuses = ["ASSIGNED", "CONFIRMED", "ACTIVE"] as const;

    const assignment = assignmentIdBig
      ? await prisma.siteAssignment.findFirst({
          where: {
            id: assignmentIdBig,
            workerId: userIdBig,
            status: { in: [...validStatuses] },
          },
          include: { site: true },
        })
      : await prisma.siteAssignment.findFirst({
          where: {
            workerId: userIdBig,
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

    // [STEP 1-2] 오늘 이 배정에 이미 출근 기록이 있는지 — **배정별** 판정.
    //   (DB 유니크가 assignmentId+workDate이므로, 멀티 현장이면 오전 A현장/오후 B현장을 같은 날 각각 기록 가능.
    //    단일 배정이면 그 배정 하나로 하루 1건 — 기존 동작과 동일.)
    const existingRecord = await prisma.dailyAttendance.findFirst({
      where: { assignmentId: assignment.id, workDate: todayString },
      select: { id: true },
    });
    if (existingRecord) {
      // 안정성: 클라이언트가 "이미 처리됨"으로 자가치유하도록 식별 코드 부여(중복요청/유실응답 대비).
      return NextResponse.json(
        { success: false, code: "ALREADY_CLOCKED_IN", message: "이미 오늘 이 현장 출근 기록이 있습니다." },
        { status: 400 }
      );
    }

    // 🔑 연결 게이트(assignment-pipeline-design.md §7): 기존 유저는 인증코드로 배정을 연결해야 출근 가능.
    //    (신규 유저는 임시비번 발급 시 connectedAt 자동 기록, 기존 운영 ACTIVE는 백필로 grandfather)
    if (!assignment.connectedAt) {
      return NextResponse.json(
        { success: false, message: "ASSIGNMENT_NOT_CONNECTED", assignmentId: String(assignment.id) },
        { status: 409 }
      );
    }

    // 🔑 위치확정 게이트(assignment-pipeline-design.md §8): 최초 현장 방문 위치확정 전에는 출근 불가.
    //    기준점이 미확정이면 거리·반경·범위밖 사유·GPS보정 검증이 전부 허수가 되므로 강제한다.
    //    단, 출퇴근 버튼 미적용(자동 기록) 배정은 GPS 출근이 없어 기준점 확정이 무의미 → 제외.
    if (!assignment.attendanceButtonExempt && !assignment.baseConfirmedAt) {
      return NextResponse.json(
        { success: false, message: "LOCATION_NOT_CONFIRMED", assignmentId: String(assignment.id), siteId: String(assignment.siteId) },
        { status: 409 }
      );
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

    // ✅ 출근 시각은 "실제 버튼 누른 시각"이 아니라 근무형태별 표준 시작시각으로 고정 저장한다.
    //    (출근부에 입력되는 값은 근무형태로 이미 정해져 있음 — 2026-06-08 정책)
    const workTimes = computeWorkTimes(
      assignment.workType,
      assignment.commuteGuidanceIncluded,
      assignment.customWorkStart,
      assignment.customWorkEnd,
    );
    const fixedStart = kstWallTimeToInstant(todayString, workTimes.start);

    // [STEP 5] 출근 기록 저장 (증빙 필드 포함)
    const newAttendance = await prisma.dailyAttendance.create({
      data: {
        workerId: userIdBig,
        siteId: site.id,
        assignmentId: assignment.id,              // ✅ 증빙
        basePointId: decidedBasePointId,          // ✅ 증빙(없을 수 있음)
        workDate: todayString,

        startTime: fixedStart,                    // 출근부(공단)용 근무형태 고정시각
        actualStartTime: new Date(),              // 실제 출근 버튼 시각(정상 출근 여부 확인용)
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
      { success: false, message: "서버 오류" },
      { status: 500 }
    );
  }
}
