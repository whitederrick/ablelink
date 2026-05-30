// admlink-admin/app/api/site/basepoint/propose/route.ts
// 직무지도원: 기준점(좌표) 보정 "제안/자동확정" API
// 정책:
// - <= allowanceRange(기본 100m): 즉시 확정(원본 gps_lat/gps_lon 반영) + APPROVED + base_point_confirmed=true
// - > allowanceRange: 정정요청(CORRECTION_REQUESTED)만 기록, 원본 gps_lat/gps_lon/confirmed/updated_at은 절대 변경하지 않음

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertValidGps } from "../../_utils";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

// Haversine (meters)
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();

    const {
      siteId,
      proposedLat,
      proposedLon,
      accuracyM, // optional
      memo,      // optional
      reason,    // optional (100m 초과/정정요청 사유)
    } = body;

    const workerId = session.workerId;

    if (!siteId) {
      return NextResponse.json(
        { success: false, message: "siteId가 누락되었습니다." },
        { status: 400 }
      );
    }

    // proposed 좌표 숫자 변환/검증
    const latNum =
      proposedLat === "" || proposedLat === null || proposedLat === undefined
        ? null
        : Number(proposedLat);
    const lonNum =
      proposedLon === "" || proposedLon === null || proposedLon === undefined
        ? null
        : Number(proposedLon);

    if (latNum === null || lonNum === null) {
      return NextResponse.json(
        { success: false, message: "proposedLat/proposedLon이 누락되었습니다." },
        { status: 400 }
      );
    }
    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      return NextResponse.json(
        { success: false, message: "proposedLat/proposedLon이 숫자가 아닙니다." },
        { status: 400 }
      );
    }
    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return NextResponse.json(
        { success: false, message: "proposedLat/proposedLon 범위가 올바르지 않습니다." },
        { status: 400 }
      );
    }

    // BigInt 변환
    let siteIdBig: bigint;
    let userIdBig: bigint;
    try {
      siteIdBig = BigInt(siteId);
      userIdBig = BigInt(workerId);
    } catch {
      return NextResponse.json(
        { success: false, message: "siteId 또는 workerId 형식이 올바르지 않습니다." },
        { status: 400 }
      );
    }

    // 세션 사용자가 해당 사이트에 배정되어 있는지 확인
    const assignment = await prisma.siteAssignment.findFirst({
      where: {
        workerId: userIdBig,
        siteId: siteIdBig,
        status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
      },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json(
        { success: false, message: "해당 현장에 배정되어 있지 않습니다." },
        { status: 403 }
      );
    }

    // site 조회(원본 좌표/허용범위 필요)
    const site = await prisma.site.findUnique({
      where: { id: siteIdBig },
      select: {
        id: true,
        gpsLat: true,
        gpsLon: true,
        allowanceRange: true, // meters
        basePointConfirmed: true,
        basePointUpdatedAt: true,
      },
    });

    if (!site) {
      return NextResponse.json(
        { success: false, message: "존재하지 않는 siteId입니다." },
        { status: 404 }
      );
    }

    // 원본 좌표 숫자화(Decimal -> number)
    const baseLat = Number(site.gpsLat);
    const baseLon = Number(site.gpsLon);

    // 거리 계산
    const distM = distanceMeters(baseLat, baseLon, latNum, lonNum);
    const allowanceM = Number(site.allowanceRange ?? 100);

    // Decimal 저장용 변환
    const { gpsLat: proposedLatDec, gpsLon: proposedLonDec } = assertValidGps(latNum, lonNum);

    const now = new Date();
    const distRounded = Math.round(distM);

    if (distM <= allowanceM) {
      // ✅ 허용 범위 이내: 즉시 확정(원본 gps 반영)
      await prisma.site.update({
        where: { id: siteIdBig },
        data: {
          // ✅ 정책 핵심: 원본 좌표 덮어씀(확정)
          gpsLat: proposedLatDec,
          gpsLon: proposedLonDec,

          basePointConfirmed: true,
          basePointSource: "DEVICE",
          basePointAccuracyM: accuracyM ?? null,

          basePointApprovalStatus: "APPROVED",
          basePointAuthority: "AGENCY", // 기본값 유지(스키마 default가 있어도 명시해도 무방)
          basePointUpdatedAt: now,

          // 감사/이력용: 제안값도 함께 남김
          basePointProposedLat: proposedLatDec,
          basePointProposedLon: proposedLonDec,
          basePointProposedByWorkerId: userIdBig,
          basePointProposedAt: now,

          // 결정 메타(자동 승인)
          basePointDecidedAt: now,
          basePointDecidedById: userIdBig,
          basePointDecisionMemo: `AUTO_APPROVED_WITHIN_${allowanceM}M (distance=${distRounded}m)`,

          basePointMemo: memo ?? null,
          basePointCorrectionReason: null,
        },
      });

      return NextResponse.json({
        success: true,
        status: "APPROVED",
        applied: true,
        distanceM: distRounded,
        allowanceM,
        message: "허용범위 이내(<= 허용거리)로 판단되어 보정 좌표가 즉시 반영(확정)되었습니다.",
      });
    }

    // ❌ 허용 범위 초과: 정정요청만 기록 (원본 gps/confirmed/updatedAt은 유지)
    const autoReason =
      reason ||
      `원본 좌표 대비 ${distRounded}m 차이로 허용범위(${allowanceM}m)를 초과합니다. 주소/GPS 정보 재확인이 필요합니다.`;

    await prisma.site.update({
      where: { id: siteIdBig },
      data: {
        // ✅ 감사/이력용: 제안값 저장
        basePointProposedLat: proposedLatDec,
        basePointProposedLon: proposedLonDec,
        basePointProposedByWorkerId: userIdBig,
        basePointProposedAt: now,

        basePointApprovalStatus: "CORRECTION_REQUESTED",
        basePointSource: "DEVICE",
        basePointAccuracyM: accuracyM ?? null,

        basePointMemo: memo ?? null,
        basePointCorrectionReason: autoReason,

        // ❗중요: 아래 3개는 "절대" 건드리지 않음
        // gpsLat/gpsLon (원본 유지)
        // basePointConfirmed (기존 확정 유지)
        // basePointUpdatedAt (확정 시점 유지)
        //
        // 또한, decidedAt/decidedBy/decisionMemo도 건드리지 않음(기존 확정 이력 보존)
      },
    });

    return NextResponse.json({
      success: true,
      status: "CORRECTION_REQUESTED",
      applied: false,
      distanceM: distRounded,
      allowanceM,
      message: "허용범위를 초과하여 정정 요청 상태로 전환되었습니다. (에이전시 확인 필요)",
    });
  } catch (error: any) {
    console.error("basepoint propose error:", error);
    return NextResponse.json(
      { success: false, message: "서버 오류" },
      { status: 500 }
    );
  }
}
