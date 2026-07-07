// lib/worker/homeSummary.ts
// 워커 홈 화면 통합 데이터 — 기존 4개 호출(/api/home/[id], site/current, notices, notification)
// + 미작성 일지 + 오늘 일지 상태를 한 번에 조립(클라이언트 워터폴 제거 + 홈 "할 일/놓친 일" 요약 제공).
// 서버 컴포넌트 프리페치와 /api/worker/home-summary 양쪽에서 사용.

import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { getWorkerPremiumStatus, getWorkerDocAccess } from "@/lib/planGuard";
import { getConfig } from "@/lib/systemConfig";
import { effectiveServiceStep, serviceStepToTrainingType, effectiveTrainingType } from "@/lib/serviceStep";

function getKstNowDate(): Date {
  const nowStr = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  return new Date(nowStr.replace(" ", "T"));
}

export interface HomeSummary {
  // 출퇴근 카드용 (구 /api/home/[workerId] data와 동일 키)
  home: {
    id: number | null;
    assignmentId: number | null;
    workerName: string;
    companyName: string;
    gpsLat: number | null;
    gpsLon: number | null;
    allowanceRange: number;
    pipelineGate: "AWAITING_CONTRACT" | "NOT_CONNECTED" | "LOCATION_NOT_CONFIRMED" | null;
    workType: string;
    commuteGuidanceIncluded: boolean;
    customWorkStart: string | null;
    customWorkEnd: string | null;
    trainees: { id: string; name: string; gender: string; status: string }[];
    serviceStep: string;
    trainingType: "PRE" | "FIELD" | "ADAPTATION";
    attendanceStatus: string;
    attendanceButtonExempt: boolean;
    attendanceId: string | null;
    startTime: string | null;
    endTime: string | null;
    actualStartTime: string | null;
    actualEndTime: string | null;
    isFinalClosed: boolean;
  };
  premiumAccess: boolean;
  premiumReason: string | null;
  premiumMessage: string | null;
  docAccess: boolean;
  notices: { id: string; title: string; body: string; type: string; kind: string; yearMonth: string | null; link: string | null; read: boolean; createdAt: string }[];
  unreadCount: number;
  alarm: { clockInAlertMinutes: number; clockOutAlertMinutes: number };
  // 출퇴근 카드 격려 문구(운영자 편집, SystemConfig). 상태별.
  homeMessages: { BEFORE: string; WORKING: string; DONE: string; CLOSED: string };
  // 놓친 업무
  missing: {
    count: number;
    items: { attendanceId: string; workDate: string; siteName: string; trainingType: "PRE" | "FIELD" | "ADAPTATION"; trainees: { id: string; name: string; gender: string }[] }[];
  };
  // 오늘 일지 상태
  today: { loggedTraineeIds: string[]; missingTraineeCount: number };
  // 퇴근 미실행(과거 출근만 하고 퇴근 안 누른 보정대기 건) — 사유와 함께 늦은 퇴근 처리 필요
  missedClockOuts: { attendanceId: string; workDate: string; siteName: string }[];
  // 배정 요청(REQUESTED) — 매니저가 보낸 요청, 워커가 수락(희망 근무형태 선택)/거절
  pendingRequests: { assignmentId: string; siteName: string; agencyName: string; requestedWorkTypes: string[]; replyDeadline: string | null }[];
  // 현재 선택된 배정(멀티 현장 스위처용) + 오늘 활성 배정 목록(2개 이상이면 로그인 선택·헤더 전환 노출)
  activeAssignmentId: string | null;
  activeAssignments: { assignmentId: string; siteId: string | null; siteName: string; agencyName: string; workType: string; traineeCount: number }[];
}

export async function buildHomeSummary(workerId: bigint, selectedAssignmentId?: bigint | null): Promise<HomeSummary> {
  const today = getKstDateString();
  const kstNow = getKstNowDate();

  // ── 자동 최종 마감 ──
  // 과거 날짜의 미퇴근(status=WORKING) 기록은 '퇴근 미실행(보정대기)'로 그대로 둔다.
  // (예전엔 여기서 endTime 없이 DONE+확정했으나, 그러면 출근부 퇴근시각이 비거나 잘못 박혀
  //  급여 게이트 원칙과 어긋남. 이제는 직무지도원이 사유와 함께 늦게 퇴근 처리하거나
  //  매니저가 표준시각으로 확정할 때까지 미확정으로 유지한다. 아래 missedClockOuts로 노출.)
  const AUTO_FINALIZE_MINUTES = Number(process.env.AUTO_FINALIZE_MINUTES ?? 60);
  const pendingFinalize = await prisma.dailyAttendance.findFirst({
    // ★시각이 하나라도 있는 행만 자동마감 대상. 시각이 전혀 없는 DONE 행(batch-save 소급 일지
    //   입력이 만든 행 — isFinalClosed:false로 두어 급여에서 빼는 게 원칙)을 workDate!==today 만으로
    //   확정하면, computeRun(isFinalClosed:true만 조회·시각가드 제거)이 이를 근무일로 세어 DAILY 일당·
    //   MONTHLY workedDays가 과지급된다. 시각 없는 행은 여기서 건드리지 않고 missedClockOuts/보정대기로 유지.
    where: {
      workerId, status: "DONE", isFinalClosed: false,
      OR: [{ actualEndTime: { not: null } }, { endTime: { not: null } }],
    },
    orderBy: [{ workDate: "desc" }, { endTime: "desc" }],
  });
  if (pendingFinalize) {
    const byDateChange = pendingFinalize.workDate !== today;
    // ✅ 자동 마감 경과시간은 "실제 퇴근 버튼 누른 시각(actualEndTime)" 기준.
    //    endTime은 근무형태별 표준 종료시각으로 고정 저장되므로 타임아웃 기준이 될 수 없음.
    //    (레거시 기록 호환: actualEndTime 없으면 endTime 폴백)
    const pressedEnd = pendingFinalize.actualEndTime ?? pendingFinalize.endTime;
    const byTimeout = !!pressedEnd && (Date.now() - new Date(pressedEnd).getTime() >= AUTO_FINALIZE_MINUTES * 60 * 1000);
    if (byDateChange || byTimeout) {
      await prisma.dailyAttendance.update({
        where: { id: pendingFinalize.id },
        // 마감 시각(finalizedAt)은 FINALIZE 액션과 동일하게 표준 종료시각(endTime) 기준 유지
        data: { isFinalClosed: true, finalizedAt: pendingFinalize.endTime ?? kstNow },
      });
    }
  }

  // ── 워커 + 현장 배정 + 오늘 출근 ──
  const userWithData = await prisma.worker.findUnique({
    where: { id: workerId },
    include: {
      assignments: {
        where: { status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
        include: { site: { include: { trainees: { where: { status: { in: ["TRAINING", "EMPLOYED"] } } }, agency: true } } },
      },
      attendances: { where: { workDate: today } },
    },
  });

  const allAssignments = userWithData?.assignments ?? [];
  // 오늘 활성(근무 가능) 배정 — 멀티 현장 선택/스위처 대상. status ACTIVE + 오늘 기간겹침(KST).
  const kstDateStr = (d: Date) => new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
  const todayActive = allAssignments.filter((a) =>
    (a as any).status === "ACTIVE" &&
    (!a.startDate || kstDateStr(a.startDate) <= today) &&
    (!a.endDate || kstDateStr(a.endDate) >= today)
  );
  // 선택 배정 = 쿠키 지정(오늘 활성 목록 내에서만 유효) → 없으면 오늘 활성 첫째 → 없으면 기존 폴백(assignments[0]).
  const selectedFromCookie = selectedAssignmentId != null
    ? todayActive.find((a) => a.id === selectedAssignmentId)
    : undefined;
  const activeAssignment = selectedFromCookie ?? todayActive[0] ?? allAssignments[0];
  const site = activeAssignment?.site;
  const trainees = site?.trainees ?? [];
  // 선택 배정의 오늘 출근 기록(멀티면 배정별로 여러 건 → 선택 배정 것만).
  const todayAttendances = userWithData?.attendances ?? [];
  const todayAttendance = activeAssignment
    ? todayAttendances.find((t) => t.assignmentId === activeAssignment.id)
    : todayAttendances[0];

  const [premiumStatus, docAccessStatus] = await Promise.all([
    getWorkerPremiumStatus(workerId),
    getWorkerDocAccess(workerId),
  ]);

  // ── 알림 + 알람설정 ──
  // 홈 알림 잔존 규칙: 미확인은 계속 노출, 확인(읽음)한 것은 5일까지만.
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const rawNotices: any[] = await (prisma as any).workerNotice.findMany({
    where: { workerId, OR: [{ readAt: null }, { readAt: { gte: fiveDaysAgo } }] },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, title: true, body: true, type: true, kind: true, yearMonth: true, link: true, readAt: true, createdAt: true },
  });
  const notices = rawNotices.map((n: any) => ({
    id: n.id.toString(), title: n.title, body: n.body, type: n.type, kind: n.kind ?? "NOTICE_INDIVIDUAL",
    yearMonth: n.yearMonth, link: n.link ?? null, read: n.readAt !== null, createdAt: n.createdAt.toISOString(),
  }));
  // 벨 미확인 수는 take 20 목록이 아니라 전체 기준으로 정확히 산출(>20건일 때 과소표기 방지)
  const unreadCount: number = await (prisma as any).workerNotice.count({ where: { workerId, readAt: null } });

  const setting = await prisma.workerNotificationSetting.findUnique({
    where: { workerId },
    select: { clockInAlertMinutes: true, clockOutAlertMinutes: true },
  });

  // ── 미완료 일지 (최근 3개월 출근기록 중 '완료된' 본인 일지 0건) ──
  // 캘린더(isCompleted 기준)·매니저 대시보드와 일치: 임시저장(draft)만 있는 날도 '놓친 업무'로 노출.
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const from = threeMonthsAgo.toISOString().slice(0, 10);
  const missingAttendances = await prisma.dailyAttendance.findMany({
    where: { workerId, workDate: { gte: from }, logs: { none: { writerId: workerId, isCompleted: true } } },
    include: {
      site: { select: { companyName: true, trainees: { where: { status: { in: ["TRAINING", "EMPLOYED"] } }, select: { id: true, name: true, gender: true } } } },
      assignment: { select: { serviceStep: true, adaptationStartDate: true } },
    },
    orderBy: { workDate: "desc" },
    take: 30,
  });
  const missingItems = missingAttendances.map(a => ({
    attendanceId: a.id.toString(),
    workDate: a.workDate,
    siteName: a.site.companyName,
    // 해당 출근일 기준으로 훈련/적응지도 판정(전환일 반영)
    trainingType: effectiveTrainingType((a.assignment as any)?.serviceStep, (a.assignment as any)?.adaptationStartDate, a.workDate),
    trainees: a.site.trainees.map(t => ({ id: t.id.toString(), name: t.name, gender: t.gender })),
  }));

  // ── 오늘 일지 상태 (오늘 출근기록에 '완료된' 일지가 있는 훈련생) ──
  // 임시저장(draft)은 미완료로 취급 → 캘린더(isCompleted)와 일치.
  let loggedTraineeIds: string[] = [];
  if (todayAttendance) {
    const todayLogs = await prisma.traineeLog.findMany({
      where: { writerId: workerId, attendanceId: todayAttendance.id, isCompleted: true },
      select: { traineeId: true },
    });
    loggedTraineeIds = todayLogs.map(l => l.traineeId.toString());
  }
  const missingTraineeCount = trainees.filter(t => !loggedTraineeIds.includes(t.id.toString())).length;

  // ── 퇴근 미실행 (과거 날짜 + 아직 WORKING = 퇴근 안 누름) ──
  const missedRows = await prisma.dailyAttendance.findMany({
    where: { workerId, status: "WORKING", workDate: { lt: today }, isFinalClosed: false },
    include: { site: { select: { companyName: true } } },
    orderBy: { workDate: "desc" },
    take: 30,
  });
  const missedClockOuts = missedRows.map(a => ({
    attendanceId: a.id.toString(),
    workDate: a.workDate,
    siteName: a.site?.companyName ?? "현장",
  }));

  // ── 배정 요청(REQUESTED) — 기한 미초과만 노출 ──
  const requestRows = await prisma.siteAssignment.findMany({
    where: { workerId, status: "REQUESTED", OR: [{ replyDeadline: null }, { replyDeadline: { gte: new Date() } }] },
    include: { site: { select: { companyName: true } }, agency: { select: { name: true } } },
    orderBy: { id: "desc" },
  });
  const pendingRequests = requestRows.map(a => ({
    assignmentId: a.id.toString(),
    siteName: a.site?.companyName ?? "현장",
    agencyName: a.agency?.name ?? "",
    requestedWorkTypes: (a.requestedWorkTypes ?? "").split(",").filter(Boolean),
    replyDeadline: a.replyDeadline ? a.replyDeadline.toISOString() : null,
  }));

  // 출퇴근 카드 격려 문구(운영자 편집 가능, 미설정 시 registry 기본값)
  const [msgBefore, msgWorking, msgDone, msgClosed] = await Promise.all([
    getConfig("HOME_MSG_BEFORE"),
    getConfig("HOME_MSG_WORKING"),
    getConfig("HOME_MSG_DONE"),
    getConfig("HOME_MSG_CLOSED"),
  ]);

  return {
    home: {
      id: site?.id ? Number(site.id) : null,
      assignmentId: activeAssignment?.id ? Number(activeAssignment.id) : null,
      workerName: userWithData?.workerName ?? "",
      companyName: site?.companyName || "배정된 현장 없음",
      gpsLat: site?.gpsLat ? Number(site.gpsLat) : null,
      gpsLon: site?.gpsLon ? Number(site.gpsLon) : null,
      allowanceRange: site?.allowanceRange ?? 100,
      // 파이프라인 게이트(assignment-pipeline-design.md): 출근 전 필요한 단계를 홈에서 사전 안내
      pipelineGate: !activeAssignment ? null
        : (activeAssignment as any).status === "ASSIGNED" ? "AWAITING_CONTRACT"
        : !(activeAssignment as any).connectedAt ? "NOT_CONNECTED"
        // 출퇴근 버튼 미적용(자동 기록) 배정은 GPS 출근이 없어 기준점 확정이 의미 없음 → 위치 게이트 제외
        : (!(activeAssignment as any).attendanceButtonExempt && !(activeAssignment as any).baseConfirmedAt) ? "LOCATION_NOT_CONFIRMED"
        : null,
      workType: activeAssignment?.workType || "FULL_DAY",
      commuteGuidanceIncluded: (activeAssignment as any)?.commuteGuidanceIncluded ?? true,
      customWorkStart: (activeAssignment as any)?.customWorkStart ?? null,
      customWorkEnd: (activeAssignment as any)?.customWorkEnd ?? null,
      trainees: trainees.map((t: any) => ({ id: t.id.toString(), name: t.name, gender: t.gender, status: t.status })),
      // 오늘 기준 실효 단계(전환일 지나면 적응지도)
      serviceStep: effectiveServiceStep((activeAssignment as any)?.serviceStep, (activeAssignment as any)?.adaptationStartDate, today),
      trainingType: serviceStepToTrainingType(effectiveServiceStep((activeAssignment as any)?.serviceStep, (activeAssignment as any)?.adaptationStartDate, today)),
      attendanceStatus: todayAttendance?.status ?? "BEFORE",
      attendanceButtonExempt: Boolean((activeAssignment as any)?.attendanceButtonExempt),
      attendanceId: todayAttendance?.id ? todayAttendance.id.toString() : null,
      startTime: todayAttendance?.startTime ? todayAttendance.startTime.toISOString() : null,
      endTime: todayAttendance?.endTime ? todayAttendance.endTime.toISOString() : null,
      // 실제 버튼 시각(화면 표시용). start/endTime은 출근부용 고정시각.
      actualStartTime: (todayAttendance as any)?.actualStartTime ? (todayAttendance as any).actualStartTime.toISOString() : null,
      actualEndTime: (todayAttendance as any)?.actualEndTime ? (todayAttendance as any).actualEndTime.toISOString() : null,
      isFinalClosed: Boolean(todayAttendance?.isFinalClosed),
    },
    premiumAccess: premiumStatus.premium,
    premiumReason: premiumStatus.reason ?? null,
    premiumMessage: premiumStatus.message ?? null,
    docAccess: docAccessStatus.allowed,
    notices,
    unreadCount,
    alarm: {
      clockInAlertMinutes: setting?.clockInAlertMinutes ?? 3,
      clockOutAlertMinutes: setting?.clockOutAlertMinutes ?? 3,
    },
    homeMessages: { BEFORE: msgBefore, WORKING: msgWorking, DONE: msgDone, CLOSED: msgClosed },
    missing: { count: missingItems.length, items: missingItems },
    today: { loggedTraineeIds, missingTraineeCount },
    missedClockOuts,
    pendingRequests,
    activeAssignmentId: activeAssignment?.id ? String(activeAssignment.id) : null,
    activeAssignments: todayActive.map((a) => ({
      assignmentId: String(a.id),
      siteId: a.site?.id ? String(a.site.id) : null,
      siteName: a.site?.companyName ?? "현장",
      agencyName: (a.site as any)?.agency?.name ?? "",
      workType: a.workType ?? "FULL_DAY",
      traineeCount: a.site?.trainees?.length ?? 0,
    })),
  };
}
