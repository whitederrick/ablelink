// scripts/seed-e2e-rich.mts
// seed-e2e.mts(현장·직무지도원·훈련생) 위에 "풍부한 운영 데이터"를 얹는다.
// 근태(정상/지각/GPS이탈/퇴근누락/미출근) · 훈련일지(확정/미확정+과제) · 출근부 수정요청
// · 커스텀 휴무 · 시스템 공지 · 지원 요청. 모든 화면이 데이터로 살아있게.
// 실행:  npx tsx scripts/seed-e2e-rich.mts   (먼저 seed-e2e.mts 실행 필요)
// 제거:  npx tsx scripts/seed-e2e-rich.mts --clean
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");

function pad2(n: number) { return String(n).padStart(2, "0"); }
function kst(date: string, hhmm: string) { return new Date(`${date}T${hhmm}:00+09:00`); }
// 이번 달 평일(주말 제외), 오늘까지
function weekdaysThisMonth(): string[] {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const out: string[] = [];
  for (let d = 1; d <= now.getDate(); d++) {
    const dt = new Date(y, m, d);
    const dow = dt.getDay();
    if (dow !== 0 && dow !== 6) out.push(`${y}-${pad2(m + 1)}-${pad2(d)}`);
  }
  return out;
}
const HOURS: Record<string, [string, string]> = { AM: ["09:00", "12:00"], PM: ["13:00", "17:00"], FULL_DAY: ["09:00", "18:00"], CUSTOM: ["09:00", "18:00"] };

async function main() {
  const manager = await prisma.manager.findFirst({ where: { loginId: "manager01" }, select: { id: true, agencyId: true } });
  if (!manager) throw new Error("manager01 없음 — seed-e2e.mts 먼저 실행");

  // e2e 배정 로드(워커·현장·assignmentId·workType·step) + 현장별 훈련생
  const asgns = await prisma.siteAssignment.findMany({
    where: { user: { loginId: { startsWith: "e2e-worker-" } }, status: "ACTIVE" },
    select: { id: true, workerId: true, siteId: true, workType: true, serviceStep: true,
              user: { select: { workerName: true } }, site: { select: { companyName: true } } },
  });
  if (asgns.length === 0) throw new Error("e2e 배정 없음 — seed-e2e.mts 먼저 실행");
  const e2eWorkerIds = asgns.map(a => a.workerId);
  const attIds = (await prisma.dailyAttendance.findMany({ where: { workerId: { in: e2eWorkerIds } }, select: { id: true } })).map(a => a.id);

  if (CLEAN) {
    await prisma.attendanceEditRequest.deleteMany({ where: { workerId: { in: e2eWorkerIds } } });
    await prisma.traineeLog.deleteMany({ where: { writerId: { in: e2eWorkerIds } } });
    await prisma.dailyAttendance.deleteMany({ where: { workerId: { in: e2eWorkerIds } } });
    await prisma.siteHoliday.deleteMany({ where: { assignmentId: { in: asgns.map(a => a.id) } } });
    await prisma.systemAnnouncement.deleteMany({ where: { title: { startsWith: "[E2E]" } } });
    await prisma.supportTicket.deleteMany({ where: { title: { startsWith: "[E2E]" } } });
    console.log("풍부한 E2E 운영데이터 제거 완료.");
    return;
  }

  const days = weekdaysThisMonth();
  let nAtt = 0, nLog = 0, nIssue = 0;
  // 현장별 훈련생
  const traineesBySite = new Map<string, { id: bigint; name: string }[]>();
  for (const a of asgns) {
    if (!traineesBySite.has(a.siteId.toString()))
      traineesBySite.set(a.siteId.toString(), await prisma.trainee.findMany({ where: { currentSiteId: a.siteId, note: "[E2E]" }, select: { id: true, name: true } }));
  }

  for (const a of asgns) {
    const [sH, eH] = HOURS[a.workType ?? "FULL_DAY"] ?? HOURS.FULL_DAY;
    const trs = traineesBySite.get(a.siteId.toString()) ?? [];

    for (let i = 0; i < days.length; i++) {
      const date = days[i];
      const isLast = i === days.length - 1, isGps = i === days.length - 3, isLate = i === days.length - 5, isAbsent = i === Math.max(0, days.length - 7);
      const start = kst(date, sH), end = kst(date, eH);
      let data: any = {
        rangeM: 100, withinRange: true, startDistanceM: 35,
        status: "DONE", isFinalClosed: true, finalizedAt: end,
        startTime: start, actualStartTime: start, endTime: end, actualEndTime: end,
        isGpsModified: false, payrollConfirmedAt: end,
      };
      if (isAbsent) data = { status: "ABSENT", isFinalClosed: false, startTime: null, endTime: null, actualStartTime: null, actualEndTime: null };
      else if (isLast) data = { ...data, status: "WORKING", isFinalClosed: false, finalizedAt: null, endTime: null, actualEndTime: null };
      else if (isGps) data = { ...data, isGpsModified: true, withinRange: false, startDistanceM: 320 };
      else if (isLate) data = { ...data, actualStartTime: kst(date, "09:42"), payrollConfirmedAt: null };

      const att = await prisma.dailyAttendance.upsert({
        where: { assignmentId_workDate: { assignmentId: a.id, workDate: date } },
        update: data,
        create: { workDate: date, siteId: a.siteId, workerId: a.workerId, assignmentId: a.id, ...data },
      });
      nAtt++;

      // 훈련일지: 출근한 날 중 일부(짝수 인덱스), 최근 1건은 미확정
      if (!isAbsent && trs.length > 0 && i % 2 === 0) {
        const tr = trs[i % trs.length];
        await prisma.traineeLog.deleteMany({ where: { attendanceId: att.id } });
        const log = await prisma.traineeLog.create({
          data: {
            attendanceId: att.id, traineeId: tr.id, writerId: a.workerId,
            trainingType: a.serviceStep === "ADAPTATION" ? "ADAPTATION" : "FIELD",
            content: `${tr.name} 훈련생 ${date} 직무 적응 지도. 작업 순서 숙지 및 반복 훈련 진행.`,
            evaluation: "출석", time1on1: 2, timeGroup: 1, totalRecognizedTime: a.workType === "FULL_DAY" ? 8 : 4,
            isCompleted: !isLast,
          },
        });
        await prisma.traineeLogTask.create({ data: { logId: log.id, taskName: "포장·정리 작업", performanceScore: 3 + (i % 3) } });
        nLog++;
      }

      // 출근부 수정요청(PENDING): 지각/GPS 날에 1건
      if (isGps || isLate) {
        await prisma.attendanceEditRequest.create({
          data: { attendanceId: att.id, workerId: a.workerId, status: "PENDING",
            reason: isLate ? "교통 지연으로 늦게 도착했습니다. 실제 근무는 정상 수행했습니다." : "GPS 오차로 위치가 이탈로 잡혔습니다. 현장에서 정상 근무했습니다.",
            proposedStart: isLate ? "09:00" : undefined },
        });
        nIssue++;
      }
    }

    // 커스텀 휴무 1건(이번 달 첫 평일)
    if (days[1]) {
      await prisma.siteHoliday.upsert({
        where: { assignmentId_date: { assignmentId: a.id, date: days[1] } },
        update: { reason: "사업장 정기 휴무", countAsWorkday: false },
        create: { assignmentId: a.id, date: days[1], reason: "사업장 정기 휴무", countAsWorkday: false },
      });
    }
  }

  // 시스템 공지 2건
  const admin = await prisma.admin.findFirst({ where: { loginId: "admin" }, select: { id: true } });
  await prisma.systemAnnouncement.deleteMany({ where: { title: { startsWith: "[E2E]" } } });
  await prisma.systemAnnouncement.create({ data: { title: "[E2E] 정기 시스템 점검 안내", body: "이번 주말 02:00~04:00 시스템 점검이 예정되어 있습니다.", type: "MAINTENANCE", audience: "MANAGERS", adminId: admin?.id } });
  await prisma.systemAnnouncement.create({ data: { title: "[E2E] 긴급 — 출근 기록 확인 요청", body: "전체 직무지도원께서는 금일 출근 기록을 확인해 주세요.", type: "URGENT", audience: "ALL", adminId: admin?.id, sentCount: 5 } });

  // 지원 요청 2건(다음미래)
  await prisma.supportTicket.deleteMany({ where: { title: { startsWith: "[E2E]" } } });
  await prisma.supportTicket.create({ data: { agencyId: manager.agencyId, managerId: manager.id, category: "DATA_FIX", title: "[E2E] 출근 기록 수정 요청", body: "강도윤 직무지도원의 6월 초 출근 기록에 오류가 있어 확인 부탁드립니다.", status: "OPEN" } });
  await prisma.supportTicket.create({ data: { agencyId: manager.agencyId, managerId: manager.id, category: "BILLING", title: "[E2E] 결제 영수증 발급 문의", body: "지난달 구독 결제 영수증 발급이 가능한지 문의드립니다.", status: "REPLIED", reply: "영수증은 결제·구독 현황 화면에서 다운로드 가능합니다.", repliedBy: admin?.id, repliedAt: new Date() } });

  console.log(`근태 ${nAtt}건 · 훈련일지 ${nLog}건 · 출근부 수정요청 ${nIssue}건 · 커스텀휴무/시스템공지2/지원요청2 생성 완료.`);
  console.log("이번 달 평일 데이터: 대부분 정상(확정) + 지각(보정대기)·GPS이탈·퇴근누락·미출근 변형 포함.");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
