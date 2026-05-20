// app/api/home/[userId]/route.ts
// 홈 화면용 유저 정보 및 현장 배정 데이터 API (1:多 지도 모드 판정 포함)

export const runtime = "nodejs";

import { NextResponse } from 'next/server';
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";

// ✅ KST 기준 "현재 시각" Date 생성 (서버 TZ와 무관하게 안전하게)
function getKstNowDate() {
  // Node 런타임에서 timeZone 옵션 사용
  const nowStr = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // "YYYY-MM-DD HH:mm:ss"
  // "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss"
  return new Date(nowStr.replace(" ", "T"));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const resolvedParams = await params;
    const userId = BigInt(resolvedParams.userId);

    // 1. 오늘 날짜 구하기 (YYYY-MM-DD)
    const today = getKstDateString();

    // =========================================================
    // ✅ [추가] 자동 최종 마감 로직
    // - DONE 상태지만 isFinalClosed=false 인 가장 최근 기록을 확인
    // - (1) 날짜가 오늘과 다르면: 자동 마감
    // - (2) 같은 날짜라도 endTime 이후 N분 경과면: 자동 마감
    // - 마감 시간은 "마지막 endTime"을 그대로 마감 시간으로 간주하므로 endTime은 변경하지 않음
    // =========================================================
    const AUTO_FINALIZE_MINUTES = Number(process.env.AUTO_FINALIZE_MINUTES ?? 60); // 기본 60분 후 자동 확정
    const kstNow = getKstNowDate();

    const pendingFinalize = await prisma.dailyAttendance.findFirst({
      where: {
        userId,
        status: 'DONE',
        isFinalClosed: false,
      },
      orderBy: [
        { workDate: 'desc' },
        { endTime: 'desc' },
      ],
    });

    if (pendingFinalize) {
      const byDateChange = pendingFinalize.workDate !== today;

      // endTime이 "마지막 퇴근 업데이트 시간" 역할을 하므로 이를 기준으로 경과시간 판단
      const end = pendingFinalize.endTime;
      const byTimeout =
        !!end &&
        (new Date().getTime() - new Date(end).getTime() >= AUTO_FINALIZE_MINUTES * 60 * 1000);

      if (byDateChange || byTimeout) {
        await prisma.dailyAttendance.update({
          where: { id: pendingFinalize.id },
          data: {
            isFinalClosed: true,
            // finalizedAt은 "마감된 시간"으로 쓸지, "마감 처리된 시각"으로 쓸지 정책 선택이 필요함.
            // 요구사항이 "마지막 퇴근시간을 마감으로 간주"이므로 endTime을 넣는 방식이 가장 직관적입니다.
            finalizedAt: end ?? kstNow,
          },
        });
      }
    }
    // =========================================================

    // 2. 유저 정보, 현장 정보 및 '오늘의 출근 기록' 조회
    const userWithData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        assignments: {
          where: { status: 'ACTIVE' },
          include: {
            site: { include: { trainees: true, agency: true, agencyManager: true } }
          }
        },
        // 오늘의 출근 기록 확인
        attendances: { where: { workDate: today } }
      }
    });

    if (!userWithData) {
      return NextResponse.json({ success: false, message: "유저를 찾을 수 없습니다." }, { status: 404 });
    }

    const activeAssignment = userWithData.assignments[0];
    const site = activeAssignment?.site;
    const trainees = site?.trainees || [];

    // ✅ workType, isExtraTime은 SiteAssignment에 있음 (Site 모델에서 제거됨)
    const workType = activeAssignment?.workType || (site as any)?.workType || "";
    const isExtraTime = activeAssignment?.isExtraTime ?? (site as any)?.isExtraTime ?? false;

    // 3. 출근 상태 판정
    const todayAttendance = userWithData.attendances[0];
    let attendanceStatus = 'BEFORE';
    if (todayAttendance) {
      attendanceStatus = todayAttendance.status;
    }

    const isFinalClosed = Boolean(todayAttendance?.isFinalClosed);
    const finalizedAt = todayAttendance?.finalizedAt ?? null;

    // 4. 1:多 지도 현장 여부 판정
    let isMultipleMode = false;
    if (workType.includes('4H')) {
      isMultipleMode = trainees.length >= 2;
    } else if (workType.includes('8H')) {
      isMultipleMode = trainees.length > 2;
    }

    return NextResponse.json({
      success: true,
      data: {
        id: site?.id ? Number(site.id) : null,
        assignmentId: activeAssignment?.id ? Number(activeAssignment.id) : null,

        address: site?.address ?? "",
        detailAddress: site?.detailAddress ?? "",
        userName: userWithData.userName,

        companyName: site?.companyName || "배정된 현장 없음",
        gpsLat: site?.gpsLat ? Number(site.gpsLat) : null,
        gpsLon: site?.gpsLon ? Number(site.gpsLon) : null,
        allowanceRange: site?.allowanceRange ?? 100,

        agencyName: site?.agency?.name ?? "",
        managerName: site?.agencyManager?.name ?? "",
        managerEmail: site?.agencyManager?.email ?? "",
        managerPhone: site?.agencyManager?.phoneNumber ?? "",

        // ✅ 훈련기간은 SiteAssignment.stepStart/stepEnd 기준
        preTrainingStart: (activeAssignment as any)?.stepStart ?? null,
        preTrainingEnd: (activeAssignment as any)?.stepEnd ?? null,
        fieldTrainingStart: activeAssignment?.startDate ?? null,
        fieldTrainingEnd: activeAssignment?.endDate ?? null,

        isExtraTime: Boolean(isExtraTime),
        workType: workType,

        trainees: trainees.map((t: any) => ({
          id: t.id.toString(),
          name: t.name,
          gender: t.gender,
          status: t.status,
        })),
        serviceStep: (activeAssignment as any)?.serviceStep || "FIELD_TRAINING",
        trainingType: (activeAssignment as any)?.serviceStep === "PRE_TRAINING"
          ? "PRE"
          : (activeAssignment as any)?.serviceStep === "ADAPTATION"
          ? "ADAPTATION"
          : "FIELD",
        attendanceStatus: attendanceStatus,
        attendanceId: todayAttendance?.id ? todayAttendance.id.toString() : null,
        startTime: todayAttendance?.startTime ?? null,
        endTime: todayAttendance?.endTime ?? null,
        isFinalClosed: isFinalClosed,
        finalizedAt: finalizedAt,
        isMultipleMode: isMultipleMode,
      }
    });
  } catch (error) {
    console.error("Home Data Error:", error);
    return NextResponse.json({ success: false, message: "데이터 로딩 실패" }, { status: 500 });
  }
}
