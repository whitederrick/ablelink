// scripts/seed-all.mts
// ─────────────────────────────────────────────────────────────────────────────
// 종합 시드 — 3개 역할(시스템운영자 admin · 위탁기관담당자 manager · 직무지도원 worker)이
// 각자의 모든 메뉴를 풍부한 데이터로 테스트할 수 있게 한다.
//
// 동작:
//   1) admins(시스템운영자 계정) + _prisma_migrations 만 보존하고 나머지 전체 백업 후 TRUNCATE.
//   2) 3개 위탁기관(에이전시) + 담당자 + 직무지도원 + 현장 + 배정 + 훈련생 생성(대용량).
//   3) 근태·훈련일지·수정요청·휴무·문서·계약·만족도·급여기준·배정요청·인재풀·모집공고·
//      공지·알림·지원요청·역량평가표·시스템설정 등 모든 화면용 데이터 생성.
//
// 실행:  npx tsx scripts/seed-all.mts
//
// ⚠️  파괴적: 현재 DB의 admins 외 모든 데이터를 삭제한다(실행 전 backups/ 에 JSON 백업).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";

// .env 로드(운영 DB) — 다른 스크립트와 동일 패턴
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

import { PrismaClient } from "@prisma/client";
import { assertWritableDb } from "./_dbGuard.mts";
const prisma = new PrismaClient();
assertWritableDb("종합 시드(admins 외 전체 wipe)");

// ── helpers ──────────────────────────────────────────────────────────────────
const KEEP = new Set(["admins", "_prisma_migrations"]);
const bigReplacer = (_k: string, v: any) => (typeof v === "bigint" ? v.toString() : v);
const pad2 = (n: number) => String(n).padStart(2, "0");
const dayFromNow = (n: number) => new Date(Date.now() + n * 86400000);
const kst = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+09:00`);
function weekdaysThisMonth(backDays = 999): string[] {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const out: string[] = [];
  for (let d = 1; d <= now.getDate(); d++) {
    const dt = new Date(y, m, d);
    const dow = dt.getDay();
    if (dow !== 0 && dow !== 6) out.push(`${y}-${pad2(m + 1)}-${pad2(d)}`);
  }
  return out.slice(-backDays);
}
const HOURS: Record<string, [string, string]> = {
  AM: ["09:00", "12:00"], PM: ["13:00", "17:00"], FULL_DAY: ["09:00", "18:00"], CUSTOM: ["09:00", "18:00"],
};

const NAMES = ["강도윤","서아린","유시현","한도윤","오세빈","문지환","조하영","배준호","신가람","권태오","홍서우","유라온","장하민","노을찬","천보경","민서후","남도진","구하늘","범지후","백하랑","엄지오","표은성","피서진","하람"];
const TRAINEE_NAMES = ["정해성","문가은","김도하","이서진","박지율","최예나","정시윤","강하람","윤도경","임채원","한별","오주아","서담","문지효","조하준","배은교","신아라","유찬","권보검","민유라"];
const DTYPES = ["지적장애","자폐성장애","발달장애","지체장애","청각장애"];
const BIZTYPES = ["제조","서비스","유통","요식","물류","돌봄","제과","세탁","원예","사무"];
const WTYPES = ["FULL_DAY", "AM", "PM"];
const STEPS = ["FIELD_TRAINING", "ADAPTATION"];
const DOC_TYPES = ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG", "TRAINEE_COMPREHENSIVE_EVAL"];
const SIGN_STAGES = ["SUBMITTED", "CONFIRMED", "MANAGER_SIGNED", "CHANGES_REQUESTED"];

// 에이전시 정의: agency 1 = 대용량(주력 테스트), 2·3 = 중간(운영자 가로지르기용)
const AGENCIES = [
  { name: "햇살장애인복지관", mgr: "manager01", mgrName: "김햇살", workers: 8, attDays: 999, plan: "PRO" },
  { name: "푸른나래복지재단", mgr: "manager02", mgrName: "이나래", workers: 6, attDays: 8, plan: "STANDARD" },
  { name: "나눔장애인종합복지관", mgr: "manager03", mgrName: "박나눔", workers: 5, attDays: 8, plan: "STARTER" },
];

async function main() {
  // ── 1) 백업 + wipe(admins 보존) ─────────────────────────────────────────────
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );
  const allTables = tables.map(t => t.tablename);
  const backup: Record<string, any[]> = {};
  for (const t of allTables) backup[t] = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "${t}"`);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `db-backup-${ts}.json`), JSON.stringify(backup, bigReplacer, 0));
  const totalRows = Object.values(backup).reduce((a, r) => a + r.length, 0);
  console.log(`✅ 백업 완료: backups/db-backup-${ts}.json (테이블 ${allTables.length} · ${totalRows}행)`);

  const targets = allTables.filter(t => !KEEP.has(t));
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${targets.map(t => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`🧹 초기화: ${targets.length}개 테이블 TRUNCATE (보존: ${[...KEEP].join(", ")})`);

  // 보존된 운영자 — 없으면 생성(admin/admin1234!)
  let admin = await prisma.admin.findFirst({ where: { loginId: "admin" }, select: { id: true } });
  if (!admin) {
    admin = await prisma.admin.create({
      data: { loginId: "admin", passwordHash: await bcrypt.hash("admin1234!", 12), displayName: "시스템 관리자", isActive: true },
      select: { id: true },
    });
    console.log("👤 운영자 admin 신규 생성(admin1234!)");
  } else {
    console.log("👤 운영자 admin 보존(기존 아이디/비밀번호 유지)");
  }
  const adminId = admin.id;

  // ── 2) 운영자 전역 설정 ──────────────────────────────────────────────────────
  for (const [key, value] of Object.entries({
    LATE_THRESHOLD_MIN: "15", PAYROLL_HOLD_DAY: "2", ATTENDANCE_REVERIFY_MIN: "180",
    HOME_GREETING: "오늘도 좋은 하루 되세요",
  })) {
    await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  // 공지 카테고리(운영자 전역)
  const CATS = [
    { name: "일반 안내", tone: "sky" }, { name: "긴급", tone: "rose" },
    { name: "정산/결제", tone: "amber" }, { name: "교육/안내", tone: "emerald" },
  ];
  const catIds: bigint[] = [];
  for (let i = 0; i < CATS.length; i++) {
    const c = await prisma.announcementCategory.create({ data: { name: CATS[i].name, tone: CATS[i].tone, sortOrder: i } });
    catIds.push(c.id);
  }

  // 직무지도원 역량 평가표(운영자 소유) — 배점 합계 100
  const EVAL_CATS = [
    { name: "근태·성실성", q: [["약속한 출근·근무시간을 준수했다", 8], ["부재·일정 변경 시 사전에 충실히 공유했다", 7]] },
    { name: "장애 직무지도 전문성", q: [["훈련생의 장애 특성을 이해하고 지도했다", 9], ["직무를 단계로 나눠 알기 쉽게 가르쳤다", 8], ["숙련·독립 수행이 향상되도록 도왔다", 8]] },
    { name: "대상자 관리·정서지원", q: [["훈련생을 존중하고 정서적으로 안정시켰다", 10], ["돌발 상황에 침착하게 대응했다", 10]] },
    { name: "현장 협업·소통", q: [["사업체 담당자와 소통·협조가 원활했다", 10], ["현장 규칙·업무 흐름을 존중하고 맞췄다", 10]] },
    { name: "직업윤리·신뢰", q: [["직업윤리(비밀유지·개인정보)를 지켰다", 5], ["책임감 있게 약속을 이행했다", 5]] },
    { name: "종합 추천", q: [["향후 우리 현장에 이 직무지도원을 다시 받고 싶다", 10]] },
  ];
  const evalForm = await prisma.jobCoachEvalForm.create({
    data: { title: "직무지도원 역량 평가표 (v1)", description: "장애인 직무지도원 현장 역량 평가. 사업체 담당자가 근무 종료 시 작성.", includeOpinion: true, isActive: true },
  });
  for (let ci = 0; ci < EVAL_CATS.length; ci++) {
    const cat = await prisma.jobCoachEvalCategory.create({ data: { formId: evalForm.id, name: EVAL_CATS[ci].name, sortOrder: ci } });
    for (let qi = 0; qi < EVAL_CATS[ci].q.length; qi++) {
      const [text, maxScore] = EVAL_CATS[ci].q[qi] as [string, number];
      await prisma.jobCoachEvalQuestion.create({ data: { categoryId: cat.id, text, maxScore, sortOrder: qi } });
    }
  }
  console.log("⚙️  시스템 설정·공지 카테고리·역량 평가표 생성");

  const workerPw = await bcrypt.hash("worker1234!", 12);
  const mgrPw = await bcrypt.hash("Manager1234!", 12);

  let nameIdx = 0, trIdx = 0, phoneSeq = 70000000;
  type Asg = { id: bigint; workerId: bigint; siteId: bigint; workType: string; step: string; workerName: string; siteName: string };
  const agencyActiveAsg: Asg[][] = [];        // 에이전시별 활성 배정
  const agencyMeta: { id: bigint; mgrId: bigint; name: string }[] = [];

  // ── 3) 에이전시 × (담당자·워커·현장·배정·훈련생) ─────────────────────────────
  for (let ai = 0; ai < AGENCIES.length; ai++) {
    const A = AGENCIES[ai];
    const agency = await prisma.agency.create({
      data: { name: A.name, phoneNumber: `02-${pad2(700 + ai)}-1234`, address: `서울특별시 ${["성동구","마포구","노원구"][ai]} 복지로 ${ai + 1}`, planType: A.plan as any, maxWorkers: 50, maxSites: 50, isActive: true },
    });
    const manager = await prisma.manager.create({
      data: { loginId: A.mgr, passwordHash: mgrPw, displayName: A.mgrName, agencyId: agency.id, isActive: true },
    });
    agencyMeta.push({ id: agency.id, mgrId: manager.id, name: A.name });
    const active: Asg[] = [];

    for (let w = 0; w < A.workers; w++) {
      const wName = NAMES[nameIdx % NAMES.length]; nameIdx++;
      const phone = `010-${String(phoneSeq).slice(0, 4)}-${String(phoneSeq).slice(4)}`; phoneSeq++;
      const workType = WTYPES[w % WTYPES.length];
      const step = STEPS[w % STEPS.length];

      const worker = await prisma.worker.create({
        data: {
          loginId: phone.replace(/-/g, ""), password: workerPw, workerName: wName, phoneNumber: phone,
          status: "ACTIVE", openToOffers: w % 4 === 0, planType: w % 3 === 0 ? "PRO" : "FREE",
          bankName: ["국민","신한","우리","하나","농협"][w % 5], accountNumber: `1234${pad2(w)}5678${pad2(ai)}`, accountHolder: wName,
          birthDate: `19${85 + (w % 12)}-0${(w % 8) + 1}-1${w % 9}`, residenceAddress: `서울특별시 ${["성동구","마포구","노원구"][ai]} 행복로 ${w + 1}`,
        },
      });
      await prisma.workerProfession.create({ data: { workerId: worker.id, profession: "JOB_COACH", isPrimary: true, experienceYears: 1 + (w % 7), verifyStatus: w % 3 === 0 ? "PENDING" : "VERIFIED" } });

      const site = await prisma.site.create({
        data: {
          companyName: `${A.name.slice(0, 2)} ${["카페","마트","세탁소","도서관","베이커리","공방","물류센터","사무센터"][w % 8]}`,
          address: `서울특별시 ${["성동구","마포구","노원구"][ai]} 일터로 ${w + 1}`, gpsLat: 37.5 + w * 0.004, gpsLon: 126.97 + ai * 0.01 + w * 0.003,
          allowanceRange: 200, agencyId: agency.id, ownerManagerId: manager.id, businessType: BIZTYPES[w % BIZTYPES.length],
          businessContactName: `${["김","이","박","최"][w % 4]}담당`, businessContactPhone: `010-9${pad2(ai)}${pad2(w)}-0000`,
          isActive: true, isVerified: true, basePointConfirmed: true,
        },
      });

      const asg = await prisma.siteAssignment.create({
        data: {
          workerId: worker.id, siteId: site.id, agencyId: agency.id, assignedByManagerId: manager.id,
          status: "ACTIVE", serviceStep: step as any, workType, attendanceMode: "APP_GPS",
          commuteGuidanceIncluded: workType !== "FULL_DAY", startDate: dayFromNow(-90), isMainWorker: true, connectedAt: dayFromNow(-88),
        },
      });
      active.push({ id: asg.id, workerId: worker.id, siteId: site.id, workType, step, workerName: wName, siteName: site.companyName });

      // 훈련생 1~2명/현장
      const trCount = 1 + (w % 2);
      for (let t = 0; t < trCount; t++) {
        const tName = TRAINEE_NAMES[trIdx % TRAINEE_NAMES.length]; trIdx++;
        const tr = await prisma.trainee.create({
          data: { name: tName, gender: t % 2 === 0 ? "M" : "F", disabilityType: DTYPES[trIdx % DTYPES.length], severity: t % 2 === 0 ? "심한" : "심하지않은", currentSiteId: site.id, status: "TRAINING" },
        });
        // 현장배치 이력(ACTIVE) — 급여 1:多·출근부 표기·목록·캘린더 근거. 배정 시작일과 동일.
        await prisma.traineePlacement.create({
          data: { traineeId: tr.id, siteId: site.id, startDate: dayFromNow(-90), status: "ACTIVE" },
        });
      }
    }
    agencyActiveAsg.push(active);
    console.log(`🏢 ${A.name}: 담당자 ${A.mgr} · 워커 ${A.workers} · 현장 ${A.workers} · 배정 ${active.length}`);
  }

  // ── 3b) 다중 기관 이력 워커 — 3개 기관에 과거/현재 배정(매칭에서 여러 위탁기관 공고 + 마켓플레이스 동시 노출 검증용) ──
  const multiWorker = await prisma.worker.create({
    data: { loginId: "01077777777", password: workerPw, workerName: "다기관경력", phoneNumber: "010-7777-7777",
      status: "ACTIVE", openToOffers: true, planType: "PRO",
      bankName: "국민", accountNumber: "7777000077", accountHolder: "다기관경력",
      birthDate: "1988-03-15", residenceAddress: "서울특별시 중구 다기관로 1" },
  });
  await prisma.workerProfession.create({ data: { workerId: multiWorker.id, profession: "JOB_COACH", isPrimary: true, experienceYears: 6, verifyStatus: "VERIFIED" } });
  for (let mi = 0; mi < agencyMeta.length; mi++) {
    const am = agencyMeta[mi];
    const site = await prisma.site.create({
      data: { companyName: `${am.name.slice(0, 2)} 이전현장`, address: `서울특별시 중구 경력로 ${mi + 1}`, gpsLat: 37.56 + mi * 0.003, gpsLon: 126.98 + mi * 0.003,
        allowanceRange: 200, agencyId: am.id, ownerManagerId: am.mgrId, businessType: BIZTYPES[mi % BIZTYPES.length],
        businessContactName: "김담당", businessContactPhone: "010-9999-0000", isActive: true, isVerified: true, basePointConfirmed: true },
    });
    await prisma.siteAssignment.create({
      data: { workerId: multiWorker.id, siteId: site.id, agencyId: am.id, assignedByManagerId: am.mgrId,
        status: mi === 0 ? "ACTIVE" : "ENDED", serviceStep: "FIELD_TRAINING" as any, workType: "FULL_DAY", attendanceMode: "APP_GPS",
        startDate: dayFromNow(-200 + mi * 30), isMainWorker: true, connectedAt: dayFromNow(-198 + mi * 30) },
    });
  }
  console.log(`👥 다중 기관 이력 워커: coach-multi (010-7777-7777) · ${agencyMeta.length}개 기관 배정`);

  // ── 4) 근태 + 훈련일지 + 수정요청 + 휴무 ─────────────────────────────────────
  let nAtt = 0, nLog = 0, nEdit = 0, nHol = 0;
  for (let ai = 0; ai < AGENCIES.length; ai++) {
    const days = weekdaysThisMonth(AGENCIES[ai].attDays);
    const ag = agencyMeta[ai];
    for (const a of agencyActiveAsg[ai]) {
      const [sH, eH] = HOURS[a.workType] ?? HOURS.FULL_DAY;
      const trainees = await prisma.trainee.findMany({ where: { currentSiteId: a.siteId }, select: { id: true, name: true } });

      for (let i = 0; i < days.length; i++) {
        const date = days[i];
        const isLast = i === days.length - 1, isGps = i === days.length - 3, isLate = i === days.length - 5, isAbsent = i === Math.max(0, days.length - 7);
        const start = kst(date, sH), end = kst(date, eH);
        let data: any = {
          rangeM: 100, withinRange: true, startDistanceM: 35, status: "DONE", isFinalClosed: true, finalizedAt: end,
          startTime: start, actualStartTime: start, endTime: end, actualEndTime: end, isGpsModified: false, payrollConfirmedAt: end,
        };
        if (isAbsent) data = { status: "ABSENT", isFinalClosed: false, startTime: null, endTime: null, actualStartTime: null, actualEndTime: null };
        else if (isLast) data = { ...data, status: "WORKING", isFinalClosed: false, finalizedAt: null, endTime: null, actualEndTime: null };
        else if (isGps) data = { ...data, isGpsModified: true, withinRange: false, startDistanceM: 320 };
        else if (isLate) data = { ...data, actualStartTime: kst(date, "09:42"), payrollConfirmedAt: null };

        const att = await prisma.dailyAttendance.upsert({
          where: { assignmentId_workDate: { assignmentId: a.id, workDate: date } },
          update: data, create: { workDate: date, siteId: a.siteId, workerId: a.workerId, assignmentId: a.id, ...data },
        });
        nAtt++;

        if (!isAbsent && trainees.length > 0 && i % 2 === 0) {
          const tr = trainees[i % trainees.length];
          const log = await prisma.traineeLog.create({
            data: {
              attendanceId: att.id, traineeId: tr.id, writerId: a.workerId,
              trainingType: a.step === "ADAPTATION" ? "ADAPTATION" : "FIELD",
              content: `${tr.name} 훈련생 ${date} 직무 적응 지도. 작업 순서 숙지 및 반복 훈련 진행.`,
              evaluation: "출석", time1on1: 2, timeGroup: 1, totalRecognizedTime: a.workType === "FULL_DAY" ? 8 : 4, isCompleted: !isLast,
            },
          });
          await prisma.traineeLogTask.create({ data: { logId: log.id, taskName: "포장·정리 작업", performanceScore: 3 + (i % 3) } });
          nLog++;
        }
        if (isGps || isLate) {
          await prisma.attendanceEditRequest.create({
            data: { attendanceId: att.id, workerId: a.workerId, status: "PENDING",
              reason: isLate ? "교통 지연으로 늦게 도착했습니다. 실제 근무는 정상 수행했습니다." : "GPS 오차로 위치 이탈로 잡혔습니다. 정상 근무했습니다.",
              proposedStart: isLate ? "09:00" : undefined },
          });
          nEdit++;
        }
      }
      if (days[1]) {
        await prisma.siteHoliday.upsert({
          where: { assignmentId_date: { assignmentId: a.id, date: days[1] } },
          update: { reason: "사업장 정기 휴무", countAsWorkday: false },
          create: { assignmentId: a.id, date: days[1], reason: "사업장 정기 휴무", countAsWorkday: false },
        });
        nHol++;
      }
    }
  }
  console.log(`📅 근태 ${nAtt} · 훈련일지 ${nLog} · 출근부 수정요청 ${nEdit} · 커스텀휴무 ${nHol}`);

  // ── 5) 배정 종료 임박(agency1 3건) ───────────────────────────────────────────
  const a1 = agencyActiveAsg[0];
  for (let i = 0; i < Math.min(3, a1.length); i++) {
    await prisma.siteAssignment.update({ where: { id: a1[i].id }, data: { endDate: dayFromNow([3, 6, 9][i]) } });
  }
  console.log("⏳ 배정 종료 임박 3건(D-3/6/9)");

  // ── 6) 문서(DocumentRun + Version) ───────────────────────────────────────────
  let nDoc = 0;
  for (let ai = 0; ai < AGENCIES.length; ai++) {
    const ag = agencyMeta[ai];
    const ps = new Date(`${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-01T00:00:00+09:00`);
    const pe = dayFromNow(0);
    for (let k = 0; k < agencyActiveAsg[ai].length; k++) {
      const a = agencyActiveAsg[ai][k];
      // 워커당 2건: 일지관리(govStatus NONE) + 공단제출내역(govStatus SUBMITTED)
      for (const variant of [0, 1]) {
        const stage = SIGN_STAGES[(k + variant) % SIGN_STAGES.length];
        const govStatus = variant === 1 ? "SUBMITTED" : (k % 4 === 0 ? "RESUBMIT" : "NONE");
        const run = await prisma.documentRun.create({
          data: {
            agencyId: ag.id, assignmentId: a.id, siteId: a.siteId, workerId: a.workerId,
            docType: DOC_TYPES[(k + variant) % DOC_TYPES.length] as any, periodStart: ps, periodEnd: pe, openAt: ps, dueAt: pe,
            signStage: stage, govStatus, ...(govStatus === "SUBMITTED" ? { govSubmittedAt: dayFromNow(-2), govSubmitCount: 1 } : {}),
            workerSignedAt: dayFromNow(-3),
          },
        });
        const ver = await prisma.documentVersion.create({ data: { runId: run.id, versionNo: 1, stage: "FINAL", pdfUrl: "", sourceData: {}, createdByWorkerId: a.workerId } });
        await prisma.documentRun.update({ where: { id: run.id }, data: { currentVersionId: ver.id } });
        nDoc++;
      }
    }
  }
  console.log(`📄 제출 문서 ${nDoc}건(일지관리·공단제출내역 분포)`);

  // ── 7) 근로계약서 + 만족도조사 + 급여기준 ────────────────────────────────────
  const CONTRACT_STATUS = ["PENDING", "SIGNED", "COMPLETED"];
  let nContract = 0, nSurvey = 0, nPay = 0;
  for (let ai = 0; ai < AGENCIES.length; ai++) {
    const ag = agencyMeta[ai];
    for (let k = 0; k < agencyActiveAsg[ai].length; k++) {
      const a = agencyActiveAsg[ai][k];
      await prisma.employmentContract.create({
        data: {
          agencyId: ag.id, workerId: a.workerId, assignmentId: a.id, contractStart: dayFromNow(-90), contractEnd: dayFromNow(275),
          siteName: a.siteName, workType: a.workType, signToken: `seed-contract-${ag.id}-${a.workerId}`, tokenExpiresAt: dayFromNow(14),
          status: CONTRACT_STATUS[k % CONTRACT_STATUS.length] as any, workerSignedAt: k % 3 === 0 ? null : dayFromNow(-80),
          employerBizName: ag.name, employerRepName: "홍길동",
        },
      });
      nContract++;

      const responded = k % 2 === 0;
      await prisma.satisfactionSurvey.create({
        data: {
          agencyId: ag.id, workerId: a.workerId, recipientName: `${a.siteName} 담당자`, recipientPhone: "01000000000", siteName: a.siteName,
          token: `seed-survey-${ag.id}-${a.workerId}`, status: responded ? "RESPONDED" : "PENDING", expiresAt: dayFromNow(14), sentAt: dayFromNow(-7), createdByManagerId: ag.mgrId,
          ...(responded ? { respondedAt: dayFromNow(-3), overallScore: (k % 5) + 1, scores: { professionalism: (k % 5) + 1, diligence: ((k + 1) % 5) + 1, communication: ((k + 2) % 5) + 1, support: ((k + 3) % 5) + 1 }, comment: "성실하게 잘 지도해 주셨습니다." } : {}),
        },
      });
      nSurvey++;

      await prisma.payContract.create({
        data: { agencyId: ag.id, workerId: a.workerId, workerType: "EXTERNAL", payType: "HOURLY", baseAmount: 10320, currency: "KRW", incomeType: "EMPLOYMENT", hourlyRate2Plus: Math.round(10320 * 1.2), weeklyHolidayPay: 10320 * 8, effectiveFrom: dayFromNow(-150), effectiveTo: null },
      });
      nPay++;
    }
  }
  console.log(`📝 근로계약서 ${nContract} · 만족도조사 ${nSurvey} · 급여기준 ${nPay}`);

  // ── 8) 배정 요청(agency1, /manager/assignment-selection) ─────────────────────
  const A1 = agencyMeta[0];
  const REQ_SITES = ["A","B","C","D","E","F"].map((s, i) => ({ name: `[모집] 데모현장 ${s}`, cap: i }));
  const reqSiteIds: bigint[] = [];
  for (let i = 0; i < REQ_SITES.length; i++) {
    const s = await prisma.site.create({
      data: { companyName: REQ_SITES[i].name, address: `서울특별시 성동구 요청로 ${i + 1}`, gpsLat: 37.55 + i * 0.003, gpsLon: 127.02 + i * 0.003, agencyId: A1.id, ownerManagerId: A1.mgrId,
        amCapacity: i % 3 === 0 ? 2 : 1, pmCapacity: i % 2, fullDayCapacity: i % 3 === 2 ? 1 : 0, isActive: true, basePointConfirmed: true },
    });
    reqSiteIds.push(s.id);
  }
  const REQ_PLAN: { site: number; status: string; wt: string; dl: number }[] = [
    { site: 0, status: "REQUESTED", wt: "PM", dl: 1 }, { site: 0, status: "REQUESTED", wt: "PM", dl: 1 },
    { site: 1, status: "REQUESTED", wt: "AM", dl: 2 }, { site: 1, status: "ACCEPTED", wt: "AM", dl: 2 },
    { site: 2, status: "ACCEPTED", wt: "AM", dl: 3 }, { site: 2, status: "REJECTED", wt: "AM", dl: 3 },
    { site: 3, status: "REQUESTED", wt: "AM,PM", dl: 4 }, { site: 3, status: "REQUESTED", wt: "AM", dl: 4 },
    { site: 4, status: "REQUESTED", wt: "AM", dl: 5 }, { site: 5, status: "ACCEPTED", wt: "FULL_DAY", dl: 6 },
    { site: 5, status: "DROPPED", wt: "FULL_DAY", dl: 6 }, { site: 5, status: "REQUESTED", wt: "FULL_DAY", dl: -1 },
  ];
  let nReq = 0;
  for (let i = 0; i < REQ_PLAN.length; i++) {
    const p = REQ_PLAN[i];
    const cand = await prisma.worker.create({
      data: { loginId: `0104${pad2(i)}00${pad2(i)}000`, password: workerPw, workerName: NAMES[(nameIdx + i) % NAMES.length], phoneNumber: `010-4${pad2(i)}00-${pad2(i)}000`, status: "ACTIVE", openToOffers: true },
    });
    const accepted = p.status === "ACCEPTED", closed = ["REJECTED", "DROPPED", "EXPIRED"].includes(p.status), wt0 = p.wt.split(",")[0];
    await prisma.siteAssignment.create({
      data: { siteId: reqSiteIds[p.site], workerId: cand.id, agencyId: A1.id, status: p.status as any, requestedWorkTypes: p.wt, replyDeadline: dayFromNow(p.dl),
        workType: accepted || p.status === "DROPPED" ? wt0 : null, commuteGuidanceIncluded: accepted ? wt0 !== "FULL_DAY" : true, connectedAt: accepted ? new Date() : null,
        assignedByManagerId: A1.mgrId, rejectedAt: closed ? new Date() : null, statusReason: p.status === "REJECTED" ? "후보 거절" : p.status === "DROPPED" ? "담당자 탈락" : "[SEED] 배정요청" },
    });
    nReq++;
  }
  console.log(`🤝 배정 요청 ${nReq}건(현장 ${REQ_SITES.length}) — 배정 확정 화면`);

  // ── 9) 인재풀(구직 워커) + 모집공고 + 인재 제안 ──────────────────────────────
  const TALENT = [
    { name: "김지훈", region: "서울특별시 강남구", years: 5, verify: "VERIFIED", avg: 4.8, cnt: 12, pro: true },
    { name: "이수민", region: "경기도 성남시 분당구", years: 3, verify: "VERIFIED", avg: 4.5, cnt: 8 },
    { name: "박준영", region: "인천광역시 부평구", years: 7, verify: "VERIFIED", avg: 4.9, cnt: 20, pro: true },
    { name: "최은영", region: "서울특별시 노원구", years: 1, verify: "PENDING", avg: 0, cnt: 0 },
    { name: "정민재", region: "부산광역시 해운대구", years: 4, verify: "VERIFIED", avg: 4.2, cnt: 6 },
    { name: "한서연", region: "대구광역시 수성구", years: 2, verify: "PENDING", avg: 4.0, cnt: 3 },
    { name: "오태경", region: "경기도 고양시 일산동구", years: 6, verify: "VERIFIED", avg: 4.7, cnt: 15, pro: true },
  ];
  const talentIds: bigint[] = [];
  for (let i = 0; i < TALENT.length; i++) {
    const s = TALENT[i];
    const w = await prisma.worker.create({
      data: { loginId: `01045${pad2(i)}0${pad2(i)}000`, password: workerPw, workerName: s.name, phoneNumber: `010-45${pad2(i)}0-${pad2(i)}000`, status: "ACTIVE", openToOffers: true,
        residenceAddress: s.region, bio: `${s.region} 기반 직무지도 ${s.years}년. 현장훈련·출퇴근 지도·문서화 경험.`, birthDate: `199${i % 9}-0${(i % 8) + 1}-1${i % 9}`, ratingAvg: s.avg, ratingCount: s.cnt, planType: s.pro ? "PRO" : "FREE" },
    });
    await prisma.workerProfession.create({ data: { workerId: w.id, profession: "JOB_COACH", isPrimary: true, isActive: true, experienceYears: s.years, verifyStatus: s.verify as any } });
    if (s.cnt > 0) {
      await prisma.workerReview.createMany({ data: Array.from({ length: Math.min(s.cnt, 5) }, (_, k) => ({ workerId: w.id, rating: Math.max(3, Math.round(s.avg)), comment: ["성실하고 소통이 원활했습니다.","훈련생 적응을 꼼꼼히 도왔습니다.","문서가 정확했습니다."][k % 3], createdAt: dayFromNow(-30 - k * 10), updatedAt: dayFromNow(-30 - k * 10) })) });
    }
    talentIds.push(w.id);
  }
  // 모집공고(매니저 등록=위탁기관 공고 + 운영자 등록=마켓플레이스). 비운영자 공고는 3개 기관에 분산.
  let nRecruit = 0, agRot = 0;
  for (let i = 0; i < 8; i++) {
    const byAdmin = i % 3 === 0;
    const link = byAdmin
      ? { createdByAdminId: adminId }
      : (() => { const ag = agencyMeta[agRot++ % agencyMeta.length]; return { agencyId: ag.id, createdByManagerId: ag.mgrId }; })();
    await prisma.recruitPost.create({
      data: { title: `${["카페 바리스타 보조","물류 포장","사무 보조","제과 보조","세탁 보조"][i % 5]} 직무지도 모집`, companyName: `모집사업체 ${i + 1}`, profession: "JOB_COACH",
        address: `서울특별시 ${["성동구","마포구","노원구","강남구"][i % 4]} 모집로 ${i + 1}`, region: ["성동구","마포구","노원구","강남구"][i % 4], workHours: "09:00~18:00", workDays: "월~금",
        payInfo: "시급 10,320원", serviceStart: dayFromNow(7), serviceEnd: dayFromNow(180), headcount: 1 + (i % 2), description: "지원고용 현장훈련 직무지도원을 모집합니다.", status: "OPEN",
        ...link, contactName: "담당자", contactPhone: "02-0000-0000" },
    });
    nRecruit++;
  }
  // 인재 제안(agency1 → talent)
  let nOffer = 0;
  for (let i = 0; i < Math.min(5, talentIds.length); i++) {
    await prisma.talentOffer.create({
      data: { workerId: talentIds[i], agencyId: A1.id, createdByManagerId: A1.mgrId, profession: "JOB_COACH", siteName: `${A1.name} 제안현장 ${i + 1}`, message: "현장 직무지도 제안드립니다.",
        serviceStart: dayFromNow(10), serviceEnd: dayFromNow(190), status: (["PENDING", "ACCEPTED", "DECLINED"] as const)[i % 3] },
    });
    nOffer++;
  }
  console.log(`🔎 인재풀 ${TALENT.length} · 모집공고 ${nRecruit} · 인재 제안 ${nOffer}`);

  // ── 10) 공지/알림/지원요청 ───────────────────────────────────────────────────
  // 위탁기관 공지(agency1)
  for (let i = 0; i < 6; i++) {
    await prisma.agencyAnnouncement.create({
      data: { agencyId: A1.id, title: `${["월례 회의 안내","근무 일정 변경","문서 제출 마감 안내","교육 일정","현장 점검 안내","휴무 안내"][i]}`, body: "위탁기관 공지 본문입니다. 자세한 내용은 담당자에게 문의하세요.", categoryId: catIds[i % catIds.length], pinned: i === 0, createdByManagerId: A1.mgrId },
    });
  }
  // 시스템 공지(운영자 → 매니저/전체)
  const SYS = [
    { title: "정기 시스템 점검 안내", type: "MAINTENANCE", audience: "MANAGERS", showInTicker: false },
    { title: "긴급 — 출근 기록 확인 요청", type: "URGENT", audience: "ALL", showInTicker: true },
    { title: "신규 기능 안내: 근태 인박스 개선", type: "INFO", audience: "MANAGERS", showInTicker: true },
    { title: "공단 제출 서식 업데이트", type: "INFO", audience: "MANAGERS", showInTicker: true },
  ];
  for (const s of SYS) await prisma.systemAnnouncement.create({ data: { title: s.title, body: `${s.title} 관련 안내입니다.`, type: s.type, audience: s.audience as any, showInTicker: s.showInTicker, adminId, sentCount: s.audience === "ALL" ? 19 : 0 } });

  // 지원 요청(매니저 → 운영자)
  const TICKETS = [
    { ai: 0, cat: "DATA_FIX", title: "출근 기록 수정 요청", status: "OPEN" },
    { ai: 0, cat: "BILLING", title: "결제 영수증 발급 문의", status: "REPLIED" },
    { ai: 1, cat: "ACCOUNT", title: "담당자 계정 추가 문의", status: "OPEN" },
    { ai: 2, cat: "ETC", title: "문서 양식 관련 문의", status: "OPEN" },
    { ai: 0, cat: "ETC", title: "현장 등록 오류 문의", status: "REPLIED" },
  ];
  let nTicket = 0;
  for (const t of TICKETS) {
    const ag = agencyMeta[t.ai];
    const ticket = await prisma.supportTicket.create({
      data: { agencyId: ag.id, managerId: ag.mgrId, category: t.cat as any, title: t.title, body: `${t.title} 내용입니다. 확인 부탁드립니다.`, status: t.status as any,
        ...(t.status === "REPLIED" ? { reply: "확인 후 처리해 드렸습니다. 추가 문의는 회신 바랍니다.", repliedBy: adminId, repliedAt: dayFromNow(-1) } : {}) },
    });
    if (t.status === "REPLIED") await prisma.managerNotice.create({ data: { managerId: ag.mgrId, ticketId: ticket.id, title: "지원요청 회신 도착", body: `'${t.title}' 문의에 운영자 회신이 도착했습니다.`, link: "/manager/support" } });
    nTicket++;
  }
  // 워커 알림 — agency1 워커 일부
  for (let i = 0; i < Math.min(5, a1.length); i++) {
    await prisma.workerNotice.create({ data: { workerId: a1[i].workerId, agencyId: A1.id, title: "근태 확인 요청", body: "출근 기록을 확인해 주세요.", type: "INFO", kind: "NOTICE_INDIVIDUAL", link: "/worker/review/attendance" } });
  }
  console.log(`📢 위탁기관공지 6 · 시스템공지 ${SYS.length} · 지원요청 ${nTicket} · 알림 생성`);

  // ── 대시보드 광고(운영자 관리). 티커는 시스템 공지(showInTicker)에서 관리. ──
  await prisma.dashboardPromo.createMany({ data: [
    { kind: "AD", badge: "광고", title: "이 자리에 광고를 노출하세요", body: "제휴·광고 문의는 운영팀에 연락 주세요.", sortOrder: 1 },
  ]});

  // ── 요약 ────────────────────────────────────────────────────────────────────
  console.log("\n========== 시드 완료 — 테스트 계정 ==========");
  console.log("시스템 운영자 : admin / admin1234!  (보존됨)");
  console.log("위탁기관 담당자: manager01 · manager02 · manager03 / Manager1234!");
  console.log("직무지도원    : 전화번호 로그인, 비번 worker1234!  (목록은 운영자/담당자 화면 참조)");
  console.log("=============================================");
}

main().catch(e => { console.error("시드 실패:", e); process.exit(1); }).finally(() => prisma.$disconnect());
