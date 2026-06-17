// scripts/reseed-eval-demo.mts
// 초기화 후 재생성: 표준 근로계약서 기반 연결 데이터 + 배정(현장 근무) 단위 평가 워크리스트 검증 데이터.
//  · 기관·매니저(manager01)·현장(사업체담당자 포함)·직무지도원·배정(진행/종료)·표준계약(배정 연결)·평가표·샘플 평가요청.
//  · 평가 = 배정(현장) 단위. 근무 종료 = 배정 종료일(endDate) 경과.
// 실행: npx tsx scripts/reseed-eval-demo.mts
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
const prisma = new PrismaClient();
const day = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const ymd = (d: Date) => new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z");
const pad2 = (n: number) => String(n).padStart(2, "0");
const kst = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+09:00`);
const HOURS: Record<string, [string, string]> = { AM: ["09:00", "12:00"], PM: ["13:00", "17:00"], FULL_DAY: ["09:00", "18:00"], CUSTOM: ["09:00", "18:00"] };
// 최근 N일 평일(주말 제외, 오늘까지)
function recentWeekdays(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n + 10 && out.length < n; i++) {
    const dt = new Date(Date.now() - i * 86400000);
    const dow = dt.getDay();
    if (dow !== 0 && dow !== 6) out.push(`${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`);
  }
  return out.reverse();
}

async function main() {
  // 1) 기관 + 매니저(manager01 / Manager1234!)
  const agency = await prisma.agency.upsert({
    where: { name: "햇살장애인복지관" },
    update: {},
    create: {
      name: "햇살장애인복지관", phoneNumber: "02-1234-5678", address: "서울특별시 데모구 햇살로 10",
      representativeName: "김복지", businessNumber: "120-82-00001",
      planType: "PRO", maxWorkers: 0, maxSites: 0, isActive: true,
    },
  });
  const mgrHash = await bcrypt.hash("Manager1234!", 12);
  const manager = await prisma.manager.upsert({
    where: { loginId: "manager01" },
    update: { agencyId: agency.id, isActive: true },
    create: { loginId: "manager01", passwordHash: mgrHash, displayName: "햇살 매니저", agencyId: agency.id, isActive: true },
  });
  const AG = agency.id, MGR = manager.id;
  console.log(`✅ 기관/매니저: ${agency.name} · manager01 / Manager1234!`);

  // 2) 현장(사업체 담당자 포함)
  const SITES = [
    { key: "demo-site-1", name: "햇살카페", contact: "이사장", phone: "010-1000-0001" },
    { key: "demo-site-2", name: "행복마트", contact: "박점장", phone: "010-1000-0002" },
    { key: "demo-site-3", name: "푸른세탁소", contact: "최대표", phone: "010-1000-0003" },
    { key: "demo-site-4", name: "나눔도서관", contact: "정관장", phone: "010-1000-0004" },
  ];
  const siteIds: bigint[] = [];
  for (let i = 0; i < SITES.length; i++) {
    const s = SITES[i];
    const site = await prisma.site.upsert({
      where: { placeId: s.key },
      update: { companyName: s.name, agencyId: AG, ownerManagerId: MGR, businessContactName: s.contact, businessContactPhone: s.phone, isActive: true },
      create: {
        placeId: s.key, companyName: s.name, address: `서울특별시 데모구 나눔로 ${i + 1}`,
        gpsLat: 37.55 + i * 0.003, gpsLon: 126.97 + i * 0.003, allowanceRange: 100,
        agencyId: AG, ownerManagerId: MGR, businessContactName: s.contact, businessContactPhone: s.phone,
        isActive: true, basePointConfirmed: true,
        amCapacity: 1, pmCapacity: 1, fullDayCapacity: 1,
      },
    });
    siteIds.push(site.id);
  }
  console.log(`✅ 현장 ${SITES.length}개(사업체 담당자 포함)`);

  // 3) 직무지도원(worker01~05 / Worker1234!)
  const WK = [
    { id: "worker01", name: "강도윤" }, { id: "worker02", name: "서아린" },
    { id: "worker03", name: "유시현" }, { id: "worker04", name: "한도윤" }, { id: "worker05", name: "오세빈" },
  ];
  const wkHash = await bcrypt.hash("Worker1234!", 12);
  const wkIds: bigint[] = [];
  for (let i = 0; i < WK.length; i++) {
    const w = await prisma.worker.upsert({
      where: { loginId: WK[i].id },
      update: { workerName: WK[i].name, status: "ACTIVE" },
      create: { loginId: WK[i].id, password: wkHash, workerName: WK[i].name, phoneNumber: `010-2000-000${i + 1}`, birthDate: `199${i}-03-1${i + 1}`, status: "ACTIVE", planType: "FREE" },
    });
    wkIds.push(w.id);
  }
  console.log(`✅ 직무지도원 ${WK.length}명 · Worker1234!`);

  // 기존 데모 데이터 정리(재실행 idempotent)
  await prisma.satisfactionSurvey.deleteMany({ where: { agencyId: AG } });
  const oldLogIds = (await prisma.traineeLog.findMany({ where: { writerId: { in: wkIds } }, select: { id: true } })).map(l => l.id);
  if (oldLogIds.length) await prisma.traineeLogTask.deleteMany({ where: { logId: { in: oldLogIds } } });
  await prisma.traineeLog.deleteMany({ where: { writerId: { in: wkIds } } });
  await prisma.attendanceEditRequest.deleteMany({ where: { workerId: { in: wkIds } } });
  await prisma.dailyAttendance.deleteMany({ where: { workerId: { in: wkIds } } });
  await prisma.trainee.deleteMany({ where: { currentSiteId: { in: siteIds } } });
  await prisma.supportTicket.deleteMany({ where: { agencyId: AG } });
  await prisma.systemAnnouncement.deleteMany({ where: { title: "정기 시스템 점검 안내" } });
  await prisma.employmentContract.deleteMany({ where: { agencyId: AG } });
  await prisma.siteAssignment.deleteMany({ where: { agencyId: AG } });

  // 4) 배정 — 진행/종료 섞기. [worker, site, start(일), end(일|null=진행)]
  const PLAN: { w: number; s: number; start: number; end: number | null; wt: string }[] = [
    { w: 0, s: 0, start: -60,  end: 120, wt: "FULL_DAY" }, // 강도윤·햇살카페: 근무중
    { w: 1, s: 1, start: -120, end: -10, wt: "AM" },       // 서아린·행복마트: 근무 종료 → 평가 미요청
    { w: 2, s: 2, start: -100, end: -5,  wt: "PM" },        // 유시현·푸른세탁: 근무 종료 → (샘플 평가요청)
    { w: 3, s: 3, start: -90,  end: -20, wt: "FULL_DAY" }, // 한도윤·나눔도서관: 근무 종료 → 평가 미요청
    { w: 3, s: 0, start: -3,   end: 90,  wt: "AM" },        // 한도윤·햇살카페: 같은 사람 2번째 현장(근무중)
    { w: 4, s: 1, start: -30,  end: 60,  wt: "PM" },        // 오세빈·행복마트: 근무중
  ];
  const asgnIds: bigint[] = [];
  for (const p of PLAN) {
    const a = await prisma.siteAssignment.create({
      data: {
        siteId: siteIds[p.s], workerId: wkIds[p.w], agencyId: AG,
        status: "ACTIVE", serviceStep: "FIELD_TRAINING", workType: p.wt,
        commuteGuidanceIncluded: p.wt !== "FULL_DAY",
        startDate: ymd(day(p.start)), endDate: ymd(day(p.end ?? 9999)),
        connectedAt: new Date(), assignedByManagerId: MGR,
      },
    });
    asgnIds.push(a.id);
  }
  console.log(`✅ 배정 ${PLAN.length}건(근무중·근무종료 혼합)`);

  // 5) 표준 근로계약서(배정 연결). 계약기간 6개월 — 배정이 계약보다 먼저 끝나는 케이스 포함.
  for (let i = 0; i < PLAN.length; i++) {
    const p = PLAN[i];
    const cStart = ymd(day(p.start));
    const cEnd = ymd(day(p.start + 182)); // 6개월 — 배정 종료일과 무관(별개)
    await prisma.employmentContract.create({
      data: {
        agencyId: AG, workerId: wkIds[p.w], assignmentId: asgnIds[i],
        contractStart: cStart, contractEnd: cEnd,
        siteName: SITES[p.s].name, workType: p.wt, templateKey: "STANDARD",
        status: "SIGNED", signToken: randomUUID(), tokenExpiresAt: day(7),
        wageType: "MONTHLY", wageAmount: 2096270,
      } as any,
    });
  }
  console.log(`✅ 표준 근로계약서 ${PLAN.length}건(배정 연결, 6개월)`);

  // 6) 평가표(역량 평가표) 재시드 + 활성화
  const TITLE = "직무지도원 역량 평가표 (v1)";
  const CATS = [
    { name: "근태·성실성", q: [["약속한 출근·근무시간을 준수했다", 8], ["부재·일정 변경 시 사전에 충실히 공유했다", 7]] },
    { name: "장애 직무지도 전문성", q: [["훈련생의 장애 특성을 이해하고 그에 맞게 지도했다", 9], ["직무를 단계로 나눠 알기 쉽게 가르쳤다", 8], ["훈련생의 숙련·독립 수행이 향상되도록 도왔다", 8]] },
    { name: "대상자 관리·정서지원", q: [["훈련생을 존중하고 정서적으로 안정시켰다", 10], ["돌발 상황(행동·안전)에 침착하게 대응했다", 10]] },
    { name: "현장 협업·소통", q: [["사업체 담당자와 소통·협조가 원활했다", 10], ["현장 규칙·업무 흐름을 존중하고 맞췄다", 10]] },
    { name: "직업윤리·신뢰", q: [["비밀유지·개인정보 등 직업윤리를 지켰다", 5], ["책임감 있게 약속을 이행했다", 5]] },
    { name: "종합 추천", q: [["향후 우리 현장에 이 직무지도원을 다시 받고 싶다", 10]] },
  ];
  const existingForm = await prisma.jobCoachEvalForm.findFirst({ where: { title: TITLE } });
  if (!existingForm) {
    await prisma.jobCoachEvalForm.updateMany({ data: { isActive: false } });
    const form = await prisma.jobCoachEvalForm.create({ data: { title: TITLE, description: "장애인 직무지도원 현장 역량 평가(사업체 담당자 작성·운영자 관리)", includeOpinion: true, isActive: true } });
    for (let ci = 0; ci < CATS.length; ci++) {
      const cat = await prisma.jobCoachEvalCategory.create({ data: { formId: form.id, name: CATS[ci].name, sortOrder: ci } });
      for (let qi = 0; qi < CATS[ci].q.length; qi++) {
        await prisma.jobCoachEvalQuestion.create({ data: { categoryId: cat.id, text: String(CATS[ci].q[qi][0]), maxScore: Number(CATS[ci].q[qi][1]), sortOrder: qi } });
      }
    }
    console.log("✅ 역량 평가표 시드·활성화");
  } else {
    console.log("✅ 역량 평가표(기존)");
  }

  // 7) 샘플 평가 요청(유시현·푸른세탁 종료 배정 = PLAN[2]) → '평가 요청' 상태 데모
  await prisma.satisfactionSurvey.create({
    data: {
      agencyId: AG, workerId: wkIds[2], assignmentId: asgnIds[2],
      recipientName: SITES[2].contact, recipientPhone: SITES[2].phone, siteName: SITES[2].name,
      token: randomUUID(), status: "PENDING",
      expiresAt: day(30), createdByManagerId: MGR,
    } as any,
  });
  console.log("✅ 샘플 평가 요청 1건(유시현·푸른세탁 = 평가 요청 상태)");

  // ── 8) 훈련생(현장별 2명) ─────────────────────────────────────
  const TR_NAMES = ["김민수", "이서연", "박지호", "최예나", "정우진", "한소율", "윤도현", "임하준"];
  const traineeBySite = new Map<string, bigint[]>();
  let tn = 0;
  for (let si = 0; si < siteIds.length; si++) {
    const arr: bigint[] = [];
    for (let k = 0; k < 2; k++) {
      const t = await prisma.trainee.create({
        data: {
          currentSiteId: siteIds[si], name: TR_NAMES[tn % TR_NAMES.length], gender: tn % 2 === 0 ? "M" : "F",
          birthDate: `200${tn % 6}-0${(tn % 9) + 1}-1${k + 1}`, disabilityType: tn % 2 === 0 ? "지적장애" : "자폐성장애",
          severity: tn % 3 === 0 ? "중증" : "경증", status: "TRAINING",
        } as any,
      });
      arr.push(t.id); tn++;
    }
    traineeBySite.set(String(siteIds[si]), arr);
  }
  console.log(`✅ 훈련생 ${tn}명(현장별 2명)`);

  // ── 9) 근태 + 훈련일지 + 출근부 수정요청 ───────────────────────
  const weekdays = recentWeekdays(14);
  const todayStr = new Date().toISOString().slice(0, 10);
  let nAtt = 0, nLog = 0, nEdit = 0;
  for (let i = 0; i < PLAN.length; i++) {
    const p = PLAN[i];
    const asgnId = asgnIds[i], workerId = wkIds[p.w], siteId = siteIds[p.s];
    const startStr = ymd(day(p.start)).toISOString().slice(0, 10);
    const endStr = ymd(day(p.end ?? 9999)).toISOString().slice(0, 10);
    const [sH, eH] = HOURS[p.wt] ?? HOURS.FULL_DAY;
    const trs = traineeBySite.get(String(siteId)) ?? [];
    const dates = weekdays.filter(d => d >= startStr && d <= endStr && d <= todayStr);
    for (let di = 0; di < dates.length; di++) {
      const date = dates[di];
      const isLast = di === dates.length - 1 && endStr >= todayStr; // 진행 배정의 마지막 = 근무중
      const isLate = di === dates.length - 4, isGps = di === dates.length - 6, isAbsent = di === 1 && dates.length > 6;
      const start = kst(date, sH), end = kst(date, eH);
      let data: any = { rangeM: 100, withinRange: true, startDistanceM: 30, status: "DONE", isFinalClosed: true, finalizedAt: end, startTime: start, actualStartTime: start, endTime: end, actualEndTime: end, isGpsModified: false, payrollConfirmedAt: end };
      if (isAbsent) data = { status: "ABSENT", isFinalClosed: false, startTime: null, endTime: null, actualStartTime: null, actualEndTime: null };
      else if (isLast) data = { ...data, status: "WORKING", isFinalClosed: false, finalizedAt: null, endTime: null, actualEndTime: null };
      else if (isGps) data = { ...data, isGpsModified: true, withinRange: false, startDistanceM: 280 };
      else if (isLate) data = { ...data, actualStartTime: kst(date, "09:38"), payrollConfirmedAt: null };
      const att = await prisma.dailyAttendance.upsert({
        where: { assignmentId_workDate: { assignmentId: asgnId, workDate: date } },
        update: data, create: { workDate: date, siteId, workerId, assignmentId: asgnId, ...data },
      });
      nAtt++;
      if (!isAbsent && trs.length > 0 && di % 2 === 0) {
        await prisma.traineeLog.deleteMany({ where: { attendanceId: att.id } });
        const tr = trs[di % trs.length];
        const log = await prisma.traineeLog.create({
          data: { attendanceId: att.id, traineeId: tr, writerId: workerId, trainingType: p.wt === "AM" ? "FIELD" : "FIELD",
            content: `${date} 직무 적응 지도 — 작업 순서 숙지 및 반복 훈련 진행.`, evaluation: "출석", time1on1: 2, timeGroup: 1,
            totalRecognizedTime: p.wt === "FULL_DAY" ? 8 : 4, isCompleted: !isLast } as any,
        });
        await prisma.traineeLogTask.create({ data: { logId: log.id, taskName: "포장·정리 작업", performanceScore: 3 + (di % 3) } as any });
        nLog++;
      }
      if (isGps || isLate) {
        await prisma.attendanceEditRequest.create({
          data: { attendanceId: att.id, workerId, status: "PENDING",
            reason: isLate ? "교통 지연으로 늦게 도착했습니다. 실제 근무는 정상 수행했습니다." : "GPS 오차로 위치 이탈로 잡혔습니다. 현장에서 정상 근무했습니다.",
            ...(isLate ? { proposedStart: "09:00" } : {}) } as any,
        });
        nEdit++;
      }
    }
  }
  console.log(`✅ 근태 ${nAtt}건 · 훈련일지 ${nLog}건 · 출근부 수정요청 ${nEdit}건`);

  // ── 10) 지원 요청 + 시스템 공지 ───────────────────────────────
  const adminRow = await prisma.admin.findFirst({ where: { loginId: "admin" }, select: { id: true } });
  await prisma.supportTicket.create({ data: { agencyId: AG, managerId: MGR, category: "DATA_FIX", title: "출근 기록 수정 요청", body: "강도윤 직무지도원의 이번 달 초 출근 기록에 오류가 있어 확인 부탁드립니다.", status: "OPEN" } as any });
  await prisma.supportTicket.create({ data: { agencyId: AG, managerId: MGR, category: "BILLING", title: "결제 영수증 발급 문의", body: "지난달 구독 결제 영수증 발급이 가능한지 문의드립니다.", status: "REPLIED", reply: "영수증은 결제·구독 현황 화면에서 다운로드 가능합니다.", repliedBy: adminRow?.id, repliedAt: new Date() } as any });
  await prisma.systemAnnouncement.create({ data: { title: "정기 시스템 점검 안내", body: "이번 주말 02:00~04:00 시스템 점검이 예정되어 있습니다.", type: "MAINTENANCE", audience: "MANAGERS", adminId: adminRow?.id } as any });
  console.log(`✅ 지원 요청 2건 · 시스템 공지 1건`);

  console.log("\n🎉 재시드 완료. 로그인: manager01 / Manager1234!  ·  직무지도원: worker01~05 / Worker1234!");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
