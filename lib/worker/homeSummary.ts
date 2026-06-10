// lib/worker/homeSummary.ts
// 워커 홈 화면 통합 데이터 — 기존 4개 호출(/api/home/[id], site/current, notices, notification)
// + 미작성 일지 + 오늘 일지 상태를 한 번에 조립(클라이언트 워터폴 제거 + 홈 "할 일/놓친 일" 요약 제공).
// 서버 컴포넌트 프리페치와 /api/worker/home-summary 양쪽에서 사용.

import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { getWorkerPremiumStatus, getWorkerDocAccess } from "@/lib/planGuard";

function getKstNowDate(): Date {
  const nowStr = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  return new Date(nowStr.replace(" ", "T"));
}

function serviceStepToTrainingType(step: string | null | undefined): "PRE" | "FIELD" | "ADAPTATION" {
  return step === "PRE_TRAINING" ? "PRE" : step === "ADAPTATION" ? "ADAPTATION" : "FIELD";
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
  // 놓친 업무
  missing: {
    count: number;
    items: { attendanceId: string; workDate: string; siteName: string; trainingType: "PRE" | "FIELD" | "ADAPTATION"; trainees: { id: string; name: string; gender: string }[] }[];
  };
  // 오늘 일지 상태
  today: { loggedTraineeIds: string[]; missingTraineeCount: number };
}

export async function buildHomeSummary(workerId: bigint): Promise<HomeSummary> {
  const today = getKstDateString();
  const kstNow = getKstNowDate();

  // ── 자동 최종 마감 (구 /api/home/[workerId] 로직 이식) ──
  const staleWorking = await prisma.dailyAttendance.findFirst({
    where: { workerId, status: "WORKING", workDate: { lt: today } },
  });
  if (staleWorking) {
    await prisma.dailyAttendance.update({
      where: { id: staleWorking.id },
      data: { status: "DONE", isFinalClosed: true, finalizedAt: kstNow },
    });
  }
  const AUTO_FINALIZE_MINUTES = Number(process.env.AUTO_FINALIZE_MINUTES ?? 60);
  const pendingFinalize = await prisma.dailyAttendance.findFirst({
    where: { workerId, status: "DONE", isFinalClosed: false },
    orderBy: [{ workDate: "desc" }, { endTime: "desc" }],
  });
  if (pendingFinalize) {
    const byDateChange = pendingFinalize.workDate !== today;
    const end = pendingFinalize.endTime;
    const byTimeout = !!end && (Date.now() - new Date(end).getTime() >= AUTO_FINALIZE_MINUTES * 60 * 1000);
    if (byDateChange || byTimeout) {
      await prisma.dailyAttendance.update({
        where: { id: pendingFinalize.id },
        data: { isFinalClosed: true, finalizedAt: end ?? kstNow },
      });
    }
  }

  // ── 워커 + 현장 배정 + 오늘 출근 ──
  const userWithData = await prisma.worker.findUnique({
    where: { id: workerId },
    include: {
      assignments: {
        where: { status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
        include: { site: { include: { trainees: true, agency: true } } },
      },
      attendances: { where: { workDate: today } },
    },
  });

  const activeAssignment = userWithData?.assignments[0];
  const site = activeAssignment?.site;
  const trainees = site?.trainees ?? [];
  const todayAttendance = userWithData?.attendances[0];

  const [premiumStatus, docAccessStatus] = await Promise.all([
    getWorkerPremiumStatus(workerId),
    getWorkerDocAccess(workerId),
  ]);

  // ── 알림 + 알람설정 ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const unreadCount = rawNotices.filter((n: any) => !n.readAt).length;

  const setting = await prisma.workerNotificationSetting.findUnique({
    where: { workerId },
    select: { clockInAlertMinutes: true, clockOutAlertMinutes: true },
  });

  // ── 미작성 일지 (최근 3개월 출근기록 중 본인 일지 0건) ──
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const from = threeMonthsAgo.toISOString().slice(0, 10);
  const missingAttendances = await prisma.dailyAttendance.findMany({
    where: { workerId, workDate: { gte: from }, logs: { none: { writerId: workerId } } },
    include: {
      site: { select: { companyName: true, trainees: { where: { status: "TRAINING" }, select: { id: true, name: true, gender: true } } } },
      assignment: { select: { serviceStep: true } },
    },
    orderBy: { workDate: "desc" },
    take: 30,
  });
  const missingItems = missingAttendances.map(a => ({
    attendanceId: a.id.toString(),
    workDate: a.workDate,
    siteName: a.site.companyName,
    trainingType: serviceStepToTrainingType((a.assignment as any)?.serviceStep),
    trainees: a.site.trainees.map(t => ({ id: t.id.toString(), name: t.name, gender: t.gender })),
  }));

  // ── 오늘 일지 상태 (오늘 출근기록에 작성된 훈련생) ──
  let loggedTraineeIds: string[] = [];
  if (todayAttendance) {
    const todayLogs = await prisma.traineeLog.findMany({
      where: { writerId: workerId, attendanceId: todayAttendance.id },
      select: { traineeId: true },
    });
    loggedTraineeIds = todayLogs.map(l => l.traineeId.toString());
  }
  const missingTraineeCount = trainees.filter(t => !loggedTraineeIds.includes(t.id.toString())).length;

  return {
    home: {
      id: site?.id ? Number(site.id) : null,
      assignmentId: activeAssignment?.id ? Number(activeAssignment.id) : null,
      workerName: userWithData?.workerName ?? "",
      companyName: site?.companyName || "배정된 현장 없음",
      gpsLat: site?.gpsLat ? Number(site.gpsLat) : null,
      gpsLon: site?.gpsLon ? Number(site.gpsLon) : null,
      allowanceRange: site?.allowanceRange ?? 100,
      workType: activeAssignment?.workType || "FULL_DAY",
      commuteGuidanceIncluded: (activeAssignment as any)?.commuteGuidanceIncluded ?? true,
      customWorkStart: (activeAssignment as any)?.customWorkStart ?? null,
      customWorkEnd: (activeAssignment as any)?.customWorkEnd ?? null,
      trainees: trainees.map((t: any) => ({ id: t.id.toString(), name: t.name, gender: t.gender, status: t.status })),
      serviceStep: (activeAssignment as any)?.serviceStep || "FIELD_TRAINING",
      trainingType: serviceStepToTrainingType((activeAssignment as any)?.serviceStep),
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
    missing: { count: missingItems.length, items: missingItems },
    today: { loggedTraineeIds, missingTraineeCount },
  };
}
