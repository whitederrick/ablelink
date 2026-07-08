// app/api/home/[workerId]/route.ts
// 홈 화면용 유저 정보 및 현장 배정 데이터 API (1:多 지도 모드 판정 포함)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { effectiveServiceStep, serviceStepToTrainingType } from "@/lib/serviceStep";

// ✅ KST 기준 "현재 시각" Date 생성 (서버 TZ와 무관하게 안전하게)
function getKstNowDate() {
  // Node 런타임에서 timeZone 옵션 사용
  const nowStr = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // "YYYY-MM-DD HH:mm:ss"
  // "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss"
  return new Date(nowStr.replace(" ", "T"));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workerId: string }> }
) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;

    // 본인 데이터만 접근 가능
    if (session.workerId !== resolvedParams.workerId) {
      return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    const workerId = BigInt(resolvedParams.workerId);

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

    // 과거 날짜의 미퇴근(status=WORKING) 기록은 '퇴근 미실행(보정대기)'로 그대로 둔다.
    // (예전엔 endTime 없이 DONE+확정했으나 급여 게이트 원칙과 어긋나 제거. 직무지도원의 늦은 퇴근
    //  처리 또는 매니저 표준시각 확정 전까지 미확정 유지. 노출은 home-summary의 missedClockOuts.)

    const pendingFinalize = await prisma.dailyAttendance.findFirst({
      where: {
        workerId,
        status: 'DONE',
        isFinalClosed: false,
        // ★시각 없는 소급행(batch-save DONE·endTime/actualEndTime null)은 자동마감 대상에서 제외 —
        //  R4-1 불변식(homeSummary와 동일). 없으면 날짜변경만으로 마감돼 급여 과지급.
        OR: [{ actualEndTime: { not: null } }, { endTime: { not: null } }],
      },
      orderBy: [
        { workDate: 'desc' },
        { endTime: 'desc' },
      ],
    });

    if (pendingFinalize) {
      const byDateChange = pendingFinalize.workDate !== today;

      // ✅ 경과시간은 "실제 퇴근 버튼 누른 시각(actualEndTime)" 기준으로 판단.
      //    endTime은 근무형태별 표준 종료시각으로 고정 저장되므로 타임아웃 기준이 될 수 없음.
      //    (레거시 기록 호환: actualEndTime 없으면 endTime 폴백)
      const pressedEnd = pendingFinalize.actualEndTime ?? pendingFinalize.endTime;
      const byTimeout =
        !!pressedEnd &&
        (new Date().getTime() - new Date(pressedEnd).getTime() >= AUTO_FINALIZE_MINUTES * 60 * 1000);

      if (byDateChange || byTimeout) {
        await prisma.dailyAttendance.update({
          where: { id: pendingFinalize.id },
          data: {
            isFinalClosed: true,
            // 마감 시각(finalizedAt)은 표준 종료시각(endTime) 기준 유지
            finalizedAt: pendingFinalize.endTime ?? kstNow,
          },
        });
      }
    }
    // =========================================================

    // 2. 유저 정보, 현장 정보 및 '오늘의 출근 기록' 조회
    const userWithData = await prisma.worker.findUnique({
      where: { id: workerId },
      include: {
        assignments: {
          where: { status: { in: ['ASSIGNED', 'CONFIRMED', 'ACTIVE'] } },
          include: {
            site: {
              include: {
                trainees: true,
                agency: true,
                contacts: { where: { isActive: true }, select: { name: true, phoneNumber: true, email: true, role: true }, orderBy: { id: "asc" } },
              },
            },
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

    // 현장 담당자 전체(대표 사업체담당자 먼저, 이어서 활성 추가담당자) — 워커 표시용(읽기전용)
    const siteContacts = [
      ...(site?.businessContactName
        ? [{
            name: site.businessContactName,
            phone: site.businessContactPhone ?? null,
            email: site.businessContactEmail ?? null,
            role: "대표",
            isPrimary: true,
          }]
        : []),
      ...((site?.contacts ?? []).map((c: any) => ({
        name: c.name,
        phone: c.phoneNumber ?? null,
        email: c.email ?? null,
        role: c.role ?? null,
        isPrimary: false,
      }))),
    ];

    const workType = activeAssignment?.workType || "";
    const commuteGuidanceIncluded: boolean = activeAssignment?.commuteGuidanceIncluded ?? true;

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
    if (workType === "AM" || workType === "PM") {
      isMultipleMode = trainees.length >= 2;
    } else {
      isMultipleMode = trainees.length > 2;
    }

    return NextResponse.json({
      success: true,
      data: {
        id: site?.id ? Number(site.id) : null,
        assignmentId: activeAssignment?.id ? Number(activeAssignment.id) : null,

        address: site?.address ?? "",
        detailAddress: site?.detailAddress ?? "",
        workerName: userWithData.workerName,

        companyName: site?.companyName || "배정된 현장 없음",
        gpsLat: site?.gpsLat ? Number(site.gpsLat) : null,
        gpsLon: site?.gpsLon ? Number(site.gpsLon) : null,
        allowanceRange: site?.allowanceRange ?? 100,

        agencyName: site?.agency?.name ?? "",
        managerName: site?.businessContactName ?? "",
        managerEmail: site?.businessContactEmail ?? "",
        managerPhone: site?.businessContactPhone ?? "",
        siteContacts,

        // ✅ 훈련기간은 SiteAssignment.stepStart/stepEnd 기준
        preTrainingStart: activeAssignment?.stepStart ?? null,
        preTrainingEnd: activeAssignment?.stepEnd ?? null,
        fieldTrainingStart: activeAssignment?.startDate ?? null,
        fieldTrainingEnd: activeAssignment?.endDate ?? null,

        workType: workType || "FULL_DAY",
        commuteGuidanceIncluded,
        customWorkStart: activeAssignment?.customWorkStart ?? null,
        customWorkEnd: activeAssignment?.customWorkEnd ?? null,

        trainees: trainees.map((t: any) => ({
          id: t.id.toString(),
          name: t.name,
          gender: t.gender,
          status: t.status,
        })),
        serviceStep: effectiveServiceStep(activeAssignment?.serviceStep, activeAssignment?.adaptationStartDate, today),
        trainingType: serviceStepToTrainingType(effectiveServiceStep(activeAssignment?.serviceStep, activeAssignment?.adaptationStartDate, today)),
        attendanceStatus: attendanceStatus,
        attendanceId: todayAttendance?.id ? todayAttendance.id.toString() : null,
        startTime: todayAttendance?.startTime ?? null,
        endTime: todayAttendance?.endTime ?? null,
        // 실제 버튼 시각(화면 표시용). startTime/endTime은 출근부용 고정시각.
        actualStartTime: (todayAttendance as any)?.actualStartTime ?? null,
        actualEndTime: (todayAttendance as any)?.actualEndTime ?? null,
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
