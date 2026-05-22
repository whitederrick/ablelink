// app/api/site/register/route.ts
// 직무지도 현장 등록 API 엔드포인트

export const runtime = "nodejs";

import { assertValidGps } from "../_utils";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      userId,
      companyName,
      address,
      gpsLat,
      gpsLon, // [추가] 프론트엔드에서 전달한 좌표
      agencyName,
      managerName,
      managerEmail,
      managerPhone,
      noPreTraining,
      noFieldTraining,
      preTrainingStart,
      preTrainingEnd,
      fieldTrainingStart,
      fieldTrainingEnd,
      trainees,
    } = body;

    // ✅ (필수) noPre / noField 정의 (문자열 'true'도 허용)
    const noPre = noPreTraining === true || noPreTraining === "true";
    const noField = noFieldTraining === true || noFieldTraining === "true";

    // ✅ 최소 필수값 검증(서버에서도 방어)
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "userId가 누락되었습니다." },
        { status: 400 }
      );
    }
    if (!companyName || !address || !managerName || !managerEmail) {
      return NextResponse.json(
        {
          success: false,
          message:
            "필수 항목(companyName, address, managerName, managerEmail)이 누락되었습니다.",
        },
        { status: 400 }
      );
    }

    // ✅ trainees 방어 + (정책상) 최소 1명 필요하면 아래 체크 유지
    const traineeArr = Array.isArray(trainees) ? trainees : [];
    if (traineeArr.length === 0) {
      return NextResponse.json(
        { success: false, message: "훈련생(trainees)은 최소 1명 이상 필요합니다." },
        { status: 400 }
      );
    }

    // ✅ gpsLat/gpsLon 안전 변환 + 필수/0값/범위 검증 (기본값 주입 금지)
    const latNum =
      gpsLat === undefined || gpsLat === null || gpsLat === ""
        ? null
        : Number(gpsLat);
    const lonNum =
      gpsLon === undefined || gpsLon === null || gpsLon === ""
        ? null
        : Number(gpsLon);

    if (latNum === null || lonNum === null) {
      return NextResponse.json(
        {
          success: false,
          message:
            "좌표(gpsLat, gpsLon)가 누락되었습니다. 주소 검색 기반으로 위치를 선택해주세요.",
        },
        { status: 400 }
      );
    }
    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      return NextResponse.json(
        { success: false, message: "좌표(gpsLat, gpsLon)가 숫자가 아닙니다." },
        { status: 400 }
      );
    }
    if (latNum === 0 || lonNum === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "좌표(gpsLat, gpsLon)가 0으로 설정되었습니다. 올바른 위치를 다시 선택해주세요.",
        },
        { status: 400 }
      );
    }
    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return NextResponse.json(
        { success: false, message: "좌표(gpsLat, gpsLon) 범위가 올바르지 않습니다." },
        { status: 400 }
      );
    }

    // ✅ (추가) Decimal 변환 + 최종 방어 (null/NaN/범위)
    const { gpsLat: gpsLatDec, gpsLon: gpsLonDec } = assertValidGps(
      latNum,
      lonNum
    );

    // ✅ userId BigInt 변환 방어
    let userIdBig: bigint;
    try {
      userIdBig = BigInt(userId);
    } catch {
      return NextResponse.json(
        { success: false, message: "userId 형식이 올바르지 않습니다." },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. 주관기관(Agency) 처리
      const agency = await tx.agency.upsert({
        where: { name: agencyName || "미지정 기관" },
        update: {},
        create: { name: agencyName || "미지정 기관" },
      });

      // 2. 주관기관 담당자(AgencyManager) 생성
      const manager = await tx.agencyManager.create({
        data: {
          agencyId: agency.id,
          name: managerName,
          email: managerEmail,
          phoneNumber: managerPhone,
        },
      });

      // 3. 직무지도 Site 생성
      const newSite = await tx.site.create({
        data: {
          companyName,
          address,
          agencyId: agency.id,
          managerId: manager.id,

          // ✅ 없음 플래그 저장
          noPreTraining: noPre,
          noFieldTraining: noField,

          // ✅ 없음이면 날짜 null (없음이 아니어도 값이 없으면 null)
          preTrainingStart: noPre
            ? null
            : preTrainingStart
            ? new Date(preTrainingStart)
            : null,
          preTrainingEnd: noPre
            ? null
            : preTrainingEnd
            ? new Date(preTrainingEnd)
            : null,

          fieldTrainingStart: noField
            ? null
            : fieldTrainingStart
            ? new Date(fieldTrainingStart)
            : null,
          fieldTrainingEnd: noField
            ? null
            : fieldTrainingEnd
            ? new Date(fieldTrainingEnd)
            : null,

          // ✅ 전달받은 좌표 저장 (Decimal로 통일)
          gpsLat: gpsLatDec,
          gpsLon: gpsLonDec,

          // ✅ (추가) 기준점 메타 기본 세팅
          basePointConfirmed: body.basePointConfirmed ?? false,
          basePointSource: body.basePointSource ?? "ADDRESS",
          basePointAccuracyM: body.basePointAccuracyM ?? null,
          basePointUpdatedAt: new Date(),
          basePointMemo: body.basePointMemo ?? null,

          trainees: {
            create: traineeArr.map((t: any) => ({
              name: t.name,
              gender:
                t.gender === "남"
                  ? "M"
                  : t.gender === "여"
                  ? "F"
                  : t.gender, // ✅ 이미 'M'/'F'로 오면 그대로 저장
              birthDate: t.birthDate, // YYYYMMDD 기대
              phoneNumber: t.phoneNumber,
              guardianPhoneNumber: t.guardianPhoneNumber ?? null,
              disabilityType: "미지정",
              severity: "중증",
              status: "TRAINING",
            })),
          },
        },
      });

      // 5. 직무지도원(User) - Site 배정
      await tx.siteAssignment.create({
        data: {
          userId: userIdBig,
          siteId: newSite.id,
          status: "ACTIVE",
          startDate: new Date(),
        },
      });

      return newSite;
    });

    return NextResponse.json({ success: true, siteId: result.id.toString() });
  } catch (error: any) {
    console.error("저장 실패 상세:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
