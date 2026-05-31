// scripts/test-recruit-autoassign.mts
// 데이터계층 E2E: 매칭 수락 → SiteAssignment 자동전환 (방향 A)
// 실제 PATCH 핸들러(app/api/admin/recruit-applications/[id]/route.ts)를 직접 호출.
// 실행: npx tsx scripts/test-recruit-autoassign.mts
// ⚠️ tsx가 Next의 `server-only`를 해석하지 못하므로, 빈 stub이 필요하다(node에서 동작 동일):
//    node_modules/server-only/{package.json,index.js} — npm install 시 실제 패키지로 대체됨.
import { readFileSync } from "node:fs";
// .env 수동 로드(dotenv 미설치)
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
import { PrismaClient } from "@prisma/client";
import { signManagerSessionToken, MANAGER_SESSION_COOKIE_NAME } from "../lib/managerSession";
import { PATCH } from "../app/api/admin/recruit-applications/[id]/route";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra ?? ""); }
}

async function callAccept(appId: bigint, token: string, action: "accept" | "reject") {
  const req = new Request(`http://localhost/api/admin/recruit-applications/${appId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: `${MANAGER_SESSION_COOKIE_NAME}=${token}` },
    body: JSON.stringify({ action }),
  });
  const res = await PATCH(req as any, { params: Promise.resolve({ id: String(appId) }) });
  return { status: res.status, body: await res.json() };
}

async function main() {
  // ── setup: 격리된 테스트 데이터 ─────────────────────────────
  const agency = await prisma.agency.create({
    data: { name: `테스트A_${Date.now()}`, phoneNumber: "02-0000-0000", address: "서울시 강남구", planType: "STANDARD", maxWorkers: 30, maxSites: 30, isActive: true },
  });
  const manager = await prisma.manager.create({
    data: { loginId: `mgr_${Date.now()}`, passwordHash: "x", displayName: "테스트매니저", agencyId: agency.id, isActive: true },
  });
  const mkWorker = (suffix: string) => prisma.worker.create({
    data: { loginId: `w_${Date.now()}_${suffix}`, password: "x", workerName: `테스트워커${suffix}`, phoneNumber: `010${Date.now()}`.slice(0, 11), status: "ACTIVE", planType: "FREE" },
  });
  const worker1 = await mkWorker("1");
  const worker2 = await mkWorker("2");
  const worker3 = await mkWorker("3");
  const allWorkerIds = [worker1.id, worker2.id, worker3.id];

  const token = await signManagerSessionToken({ sub: String(manager.id), agencyId: String(agency.id), loginId: manager.loginId });

  const created: { sites: bigint[]; posts: bigint[]; apps: bigint[]; assigns: bigint[] } = { sites: [], posts: [], apps: [], assigns: [] };

  try {
    // ── TEST 1: 에이전시 공고(좌표 O) 수락 → Site + SiteAssignment 자동 생성 ──
    console.log("\n[TEST 1] 에이전시 공고 수락 → 자동 배정");
    const post1 = await prisma.recruitPost.create({
      data: { title: "직무지도원 모집", companyName: "오토배정사업장", profession: "JOB_COACH", address: "서울시 마포구 합정동 1-1", lat: 37.549, lon: 126.913, headcount: 2, agencyId: agency.id, createdByManagerId: manager.id, status: "OPEN" },
    });
    created.posts.push(post1.id);
    const app1 = await prisma.recruitApplication.create({ data: { recruitPostId: post1.id, workerId: worker1.id, status: "PENDING" } });
    created.apps.push(app1.id);

    const r1 = await callAccept(app1.id, token, "accept");
    check("응답 success", r1.body.success === true, r1);
    check("autoAssigned=true", r1.body.autoAssigned === true, r1.body);

    const app1after = await prisma.recruitApplication.findUnique({ where: { id: app1.id } });
    check("신청 ACCEPTED", app1after?.status === "ACCEPTED");
    check("decidedAt 기록됨", app1after?.decidedAt != null);

    const post1after = await prisma.recruitPost.findUnique({ where: { id: post1.id } });
    check("RecruitPost.siteId 연계됨", post1after?.siteId != null);
    if (post1after?.siteId) created.sites.push(post1after.siteId);

    const site1 = post1after?.siteId ? await prisma.site.findUnique({ where: { id: post1after.siteId } }) : null;
    check("Site 생성됨", site1 != null);
    check("Site.companyName 공고와 일치", site1?.companyName === "오토배정사업장");
    check("Site.agencyId 일치", site1?.agencyId === agency.id);
    check("Site.requiredProfession=JOB_COACH", String(site1?.requiredProfession) === "JOB_COACH");
    check("Site 좌표 일치", Number(site1?.gpsLat) === 37.549 && Number(site1?.gpsLon) === 126.913);

    const assign1 = await prisma.siteAssignment.findFirst({ where: { siteId: post1after!.siteId!, workerId: worker1.id } });
    check("SiteAssignment 생성됨", assign1 != null);
    if (assign1) created.assigns.push(assign1.id);
    check("배정 status=ACTIVE", assign1?.status === "ACTIVE");
    check("배정 agencyId 일치", assign1?.agencyId === agency.id);
    check("배정 assignedByManagerId 일치", assign1?.assignedByManagerId === manager.id);
    check("배정 workType=FULL_DAY", assign1?.workType === "FULL_DAY");

    // ── TEST 2: 같은 공고 2번째 수락(headcount=2) → Site 재사용, 새 배정만 ──
    console.log("\n[TEST 2] 동일 공고 2번째 수락 → Site 재사용");
    const app2 = await prisma.recruitApplication.create({ data: { recruitPostId: post1.id, workerId: worker2.id, status: "PENDING" } });
    created.apps.push(app2.id);
    const r2 = await callAccept(app2.id, token, "accept");
    check("응답 success", r2.body.success === true, r2);
    check("autoAssigned=true", r2.body.autoAssigned === true);
    const sitesForPost = await prisma.recruitPost.findUnique({ where: { id: post1.id }, select: { siteId: true } });
    check("같은 Site 재사용(siteId 불변)", sitesForPost?.siteId === site1?.id);
    const siteCount = await prisma.site.count({ where: { companyName: "오토배정사업장" } });
    check("Site 중복 생성 안 됨(count=1)", siteCount === 1, { siteCount });
    const assign2 = await prisma.siteAssignment.findFirst({ where: { siteId: site1!.id, workerId: worker2.id } });
    check("worker2 배정 생성됨", assign2 != null);
    if (assign2) created.assigns.push(assign2.id);

    // ── TEST 3: 운영자(공단) 공고(agencyId=null) 수락 → 자동배정 X ──
    console.log("\n[TEST 3] 운영자 공고(agencyId 없음) → 자동배정 제외");
    // admin 세션이 필요하지만, 핵심은 'agencyId null이면 canAutoAssign=false' 분기.
    // manager가 만든 공고의 agencyId를 강제로 null로 한 케이스로 분기만 검증.
    const post3 = await prisma.recruitPost.create({
      data: { title: "운영자공고", companyName: "공단직접", profession: "JOB_COACH", address: "서울시 종로구", lat: 37.57, lon: 126.99, headcount: 1, agencyId: agency.id, createdByManagerId: manager.id, status: "OPEN" },
    });
    created.posts.push(post3.id);
    // agencyId를 raw로 null 처리(운영자 공고 시뮬레이션) — 단 권한 검증 통과 위해 createdByManagerId 유지
    await prisma.recruitPost.update({ where: { id: post3.id }, data: { agencyId: null } });
    const app3 = await prisma.recruitApplication.create({ data: { recruitPostId: post3.id, workerId: worker1.id, status: "PENDING" } });
    created.apps.push(app3.id);
    const r3 = await callAccept(app3.id, token, "accept");
    check("응답 success", r3.body.success === true, r3);
    check("autoAssigned=false (자동배정 제외)", r3.body.autoAssigned === false, r3.body);
    const app3after = await prisma.recruitApplication.findUnique({ where: { id: app3.id } });
    check("신청은 ACCEPTED 처리됨", app3after?.status === "ACCEPTED");
    const post3after = await prisma.recruitPost.findUnique({ where: { id: post3.id } });
    check("운영자 공고는 Site 미생성(siteId null)", post3after?.siteId == null);

    // ── TEST 4: reject → 자동배정 X ──
    console.log("\n[TEST 4] 반려 → 자동배정 X");
    const post4 = await prisma.recruitPost.create({
      data: { title: "반려테스트", companyName: "반려사업장", profession: "JOB_COACH", address: "서울시 강서구", lat: 37.55, lon: 126.85, headcount: 1, agencyId: agency.id, createdByManagerId: manager.id, status: "OPEN" },
    });
    created.posts.push(post4.id);
    const app4 = await prisma.recruitApplication.create({ data: { recruitPostId: post4.id, workerId: worker2.id, status: "PENDING" } });
    created.apps.push(app4.id);
    const r4 = await callAccept(app4.id, token, "reject");
    check("응답 success", r4.body.success === true, r4);
    check("autoAssigned=false", r4.body.autoAssigned === false);
    const app4after = await prisma.recruitApplication.findUnique({ where: { id: app4.id } });
    check("신청 REJECTED", app4after?.status === "REJECTED");
    const post4after = await prisma.recruitPost.findUnique({ where: { id: post4.id } });
    check("반려 시 Site 미생성", post4after?.siteId == null);

    // ── TEST 5: 비활성(PAUSED) 인력 수락 → 차단(409), 신청 PENDING 유지 ──
    console.log("\n[TEST 5] 비활성 인력 수락 → 차단");
    await prisma.worker.update({ where: { id: worker3.id }, data: { status: "PAUSED" } });
    const post5 = await prisma.recruitPost.create({
      data: { title: "비활성테스트", companyName: "비활성사업장", profession: "JOB_COACH", address: "서울시 송파구", lat: 37.51, lon: 127.1, headcount: 1, agencyId: agency.id, createdByManagerId: manager.id, status: "OPEN" },
    });
    created.posts.push(post5.id);
    const app5 = await prisma.recruitApplication.create({ data: { recruitPostId: post5.id, workerId: worker3.id, status: "PENDING" } });
    created.apps.push(app5.id);
    const r5 = await callAccept(app5.id, token, "accept");
    check("응답 차단(success=false)", r5.body.success === false, r5);
    check("상태 409", r5.status === 409);
    const app5after = await prisma.recruitApplication.findUnique({ where: { id: app5.id } });
    check("신청 PENDING 유지(수락 안 됨)", app5after?.status === "PENDING");
    const post5after = await prisma.recruitPost.findUnique({ where: { id: post5.id } });
    check("Site 미생성", post5after?.siteId == null);
    await prisma.worker.update({ where: { id: worker3.id }, data: { status: "ACTIVE" } }); // 복구

    // ── TEST 6: 인력 한도 초과 수락 → 차단(409) ──
    console.log("\n[TEST 6] 인력 한도 초과 → 차단");
    // 현재 agency에 ACTIVE 배정 2건(worker1,worker2). maxWorkers=2로 낮추면 신규 수락 차단되어야 함.
    await prisma.agency.update({ where: { id: agency.id }, data: { maxWorkers: 2 } });
    const app6 = await prisma.recruitApplication.create({ data: { recruitPostId: post5.id, workerId: worker3.id, status: "PENDING" } }).catch(async () => {
      // post5에 worker3 신청이 이미 있으면(unique) 재사용
      return prisma.recruitApplication.findFirst({ where: { recruitPostId: post5.id, workerId: worker3.id } });
    });
    const r6 = await callAccept(app6!.id, token, "accept");
    check("응답 차단(success=false)", r6.body.success === false, r6.body);
    check("상태 409", r6.status === 409);
    check("메시지에 '인력 한도'", typeof r6.body.message === "string" && r6.body.message.includes("인력 한도"), r6.body.message);
    await prisma.agency.update({ where: { id: agency.id }, data: { maxWorkers: 30 } }); // 복구

  } finally {
    // ── cleanup: 생성 데이터 전부 제거 ─────────────────────────
    console.log("\n[cleanup]");
    await prisma.siteAssignment.deleteMany({ where: { OR: [{ siteId: { in: created.sites } }, { workerId: { in: allWorkerIds } }] } });
    await prisma.recruitApplication.deleteMany({ where: { workerId: { in: allWorkerIds } } });
    await prisma.recruitPost.deleteMany({ where: { id: { in: created.posts } } });
    await prisma.site.deleteMany({ where: { id: { in: created.sites } } });
    await prisma.workerProfession.deleteMany({ where: { workerId: { in: allWorkerIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: allWorkerIds } } });
    await prisma.manager.delete({ where: { id: manager.id } }).catch(() => {});
    await prisma.agency.delete({ where: { id: agency.id } }).catch(() => {});
    console.log("  정리 완료");
  }

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
