// app/api/worker/site/register/route.ts
// 직무지도원 현장 등록 API (세션 기반 workerId 자동 주입)
// 🔐 보안: JWT 세션에서 workerId 추출 (클라이언트에서 workerId 직접 전달 차단)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    // 🔐 세션에서 workerId 추출 (클라이언트 위변조 차단)
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const workerId = BigInt(session.workerId);
    const body = await request.json();

    const {
      companyName, address, gpsLat, gpsLon,
      agencyName, managerName, managerEmail, managerPhone,
      noPreTraining, noFieldTraining,
      preTrainingStart, preTrainingEnd,
      fieldTrainingStart, fieldTrainingEnd,
      trainees,
    } = body;

    // 입력값 검증
    if (!companyName?.trim()) return NextResponse.json({ success: false, message: "사업체명을 입력해주세요." }, { status: 400 });
    if (!address?.trim()) return NextResponse.json({ success: false, message: "주소를 입력해주세요." }, { status: 400 });
    if (!managerName?.trim()) return NextResponse.json({ success: false, message: "담당자 이름을 입력해주세요." }, { status: 400 });
    if (!managerEmail?.trim()) return NextResponse.json({ success: false, message: "담당자 이메일을 입력해주세요." }, { status: 400 });

    const latNum = Number(gpsLat);
    const lonNum = Number(gpsLon);
    if (!latNum || !lonNum || isNaN(latNum) || isNaN(lonNum)) {
      return NextResponse.json({ success: false, message: "GPS 좌표가 올바르지 않습니다." }, { status: 400 });
    }

    const traineeArr = Array.isArray(trainees) ? trainees : [];
    if (traineeArr.length === 0) {
      return NextResponse.json({ success: false, message: "훈련생을 최소 1명 이상 추가해주세요." }, { status: 400 });
    }

    const noPre = noPreTraining === true || noPreTraining === "true";
    const noField = noFieldTraining === true || noFieldTraining === "true";

    const result = await prisma.$transaction(async (tx) => {
      // 1. Agency upsert
      const agency = await tx.agency.upsert({
        where: { name: agencyName?.trim() || "미지정 기관" },
        update: {},
        create: { name: agencyName?.trim() || "미지정 기관" },
      });

      // 2. AgencyManager 생성
      const manager = await tx.agencyManager.create({
        data: {
          agencyId: agency.id,
          name: managerName.trim(),
          email: managerEmail.trim(),
          phoneNumber: managerPhone?.trim() || null,
        },
      });

      // 3. Site 생성
      const site = await tx.site.create({
        data: {
          companyName: companyName.trim(),
          address: address.trim(),
          gpsLat: latNum,
          gpsLon: lonNum,
          agencyId: agency.id,
          managerId: manager.id,
          basePointConfirmed: false,
          basePointSource: "ADDRESS",
          basePointUpdatedAt: new Date(),
          trainees: {
            create: traineeArr.map((t: any) => ({
              name: String(t.name).trim(),
              gender: t.gender === "남" ? "M" : t.gender === "여" ? "F" : String(t.gender),
              birthDate: String(t.birthDate).replace(/\D/g, ""),
              phoneNumber: String(t.phoneNumber).replace(/-/g, ""),
              guardianPhoneNumber: t.guardianPhoneNumber ? String(t.guardianPhoneNumber).replace(/-/g, "") : null,
              disabilityType: "미지정",
              severity: "중증",
              status: "TRAINING",
            })),
          },
        },
      });

      // 4. SiteAssignment 생성 — 근무형태는 관리자가 나중에 설정
      await tx.siteAssignment.create({
        data: {
          workerId,
          siteId: site.id,
          agencyId: agency.id,
          status: "ACTIVE",
          startDate: fieldTrainingStart ? new Date(fieldTrainingStart) : new Date(),
          endDate: fieldTrainingEnd ? new Date(fieldTrainingEnd) : null,
          workType: "FULL_DAY",           // 관리자가 확인 후 수정
          commuteGuidanceIncluded: false, // FULL_DAY 기본값
        },
      });

      return site;
    });

    return NextResponse.json({ success: true, siteId: result.id.toString() });
  } catch (error: any) {
    console.error("[worker/site/register]", error);
    return NextResponse.json(
      { success: false, message: error.message || "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
