// scripts/test-marketplace-rework.mts
// 데이터계층 E2E: ① 관계기반 노출 게이트 ② 위치잠금 백엔드 강제 ③ 방향 B 수락 배정
// 실제 라우트 핸들러를 직접 호출. 실행: npx tsx scripts/test-marketplace-rework.mts
// ⚠️ tsx가 Next `server-only`를 해석 못하므로 node_modules/server-only 빈 stub 필요(npm install시 실제로 대체).
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { signWorkerToken, WORKER_COOKIE } from "../app/worker/_lib/session";
import { signManagerSessionToken, MANAGER_SESSION_COOKIE_NAME } from "../lib/managerSession";
import { GET as postsGET } from "../app/api/recruit/posts/route";
import { GET as postDetailGET } from "../app/api/recruit/posts/[id]/route";
import { POST as applyPOST } from "../app/api/worker/recruit/apply/route";
import { PATCH as offersPATCH } from "../app/api/worker/recruit/offers/route";
import { POST as offerPOST } from "../app/api/admin/talent/offer/route";
import { POST as proposePOST } from "../app/api/site/basepoint/propose/route";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra ?? ""); }
}

function workerReq(url: string, token: string, method: string, body?: any) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: `${WORKER_COOKIE}=${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function mgrReq(url: string, token: string, method: string, body?: any) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: `${MANAGER_SESSION_COOKIE_NAME}=${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function main() {
  const ts = Date.now();
  const agencyA = await prisma.agency.create({ data: { name: `게이트A_${ts}`, phoneNumber: "02-1", address: "서울", planType: "STANDARD", maxWorkers: 30, maxSites: 30, isActive: true } });
  const agencyB = await prisma.agency.create({ data: { name: `게이트B_${ts}`, phoneNumber: "02-2", address: "서울", planType: "STANDARD", maxWorkers: 30, maxSites: 30, isActive: true } });
  const managerA = await prisma.manager.create({ data: { loginId: `mgrA_${ts}`, passwordHash: "x", displayName: "매니저A", agencyId: agencyA.id, isActive: true } });
  const admin = await prisma.admin.create({ data: { loginId: `adm_${ts}`, passwordHash: "x", displayName: "운영자", isActive: true } });

  const mkWorker = (s: string) => prisma.worker.create({ data: { loginId: `w_${ts}_${s}`, password: "x", workerName: `워커${s}`, phoneNumber: `010${ts}`.slice(0, 11), status: "ACTIVE", planType: "FREE", openToOffers: true } });
  const workerW = await mkWorker("H");   // agencyA 배정 이력 보유
  const workerN = await mkWorker("N");   // 이력 없음(신규)
  const allWorkerIds = [workerW.id, workerN.id];

  const tokenW = await signWorkerToken({ workerId: String(workerW.id), workerName: workerW.workerName, isTemporary: false });
  const tokenN = await signWorkerToken({ workerId: String(workerN.id), workerName: workerN.workerName, isTemporary: false });
  const mgrTokenA = await signManagerSessionToken({ sub: String(managerA.id), agencyId: String(agencyA.id), loginId: managerA.loginId });

  const sites: bigint[] = [];
  try {
    // workerW에게 agencyA 배정 이력 부여(히스토리 site)
    const histSite = await prisma.site.create({ data: { companyName: `이력현장_${ts}`, address: "서울 강남", gpsLat: 37.5, gpsLon: 127.0, agencyId: agencyA.id, requiredProfession: "JOB_COACH", isActive: true, basePointConfirmed: true } });
    sites.push(histSite.id);
    await prisma.siteAssignment.create({ data: { siteId: histSite.id, workerId: workerW.id, agencyId: agencyA.id, status: "ACTIVE", startDate: new Date(), workType: "FULL_DAY", commuteGuidanceIncluded: false } });

    // 공고 3종
    const pAdmin = await prisma.recruitPost.create({ data: { title: "운영자공고", companyName: "공단직접", profession: "JOB_COACH", address: "서울 종로", headcount: 1, createdByAdminId: admin.id, status: "OPEN" } });
    const pA = await prisma.recruitPost.create({ data: { title: "A공고", companyName: "A사업장", profession: "JOB_COACH", address: "서울 마포", lat: 37.55, lon: 126.91, headcount: 1, agencyId: agencyA.id, createdByManagerId: managerA.id, status: "OPEN" } });
    const pB = await prisma.recruitPost.create({ data: { title: "B공고", companyName: "B사업장", profession: "JOB_COACH", address: "서울 송파", headcount: 1, agencyId: agencyB.id, status: "OPEN" } });

    // ── TEST 1: 노출 게이트 ──
    console.log("\n[TEST 1] 관계기반 노출 게이트");
    const listW = await (await postsGET(workerReq("/api/recruit/posts", tokenW, "GET"))).json();
    const idsW = new Set((listW.posts ?? []).map((p: any) => p.id));
    check("workerW: 운영자 공고 노출", idsW.has(String(pAdmin.id)), [...idsW]);
    check("workerW: 이력 에이전시(A) 공고 노출", idsW.has(String(pA.id)));
    check("workerW: 비이력 에이전시(B) 공고 비노출", !idsW.has(String(pB.id)));
    const pAItem = (listW.posts ?? []).find((p: any) => p.id === String(pA.id));
    check("A공고 agencyName 표시", pAItem?.agencyName === agencyA.name, pAItem?.agencyName);
    const pAdminItem = (listW.posts ?? []).find((p: any) => p.id === String(pAdmin.id));
    check("운영자 공고 agencyName=null", pAdminItem?.agencyName === null, pAdminItem?.agencyName);

    const listN = await (await postsGET(workerReq("/api/recruit/posts", tokenN, "GET"))).json();
    const idsN = new Set((listN.posts ?? []).map((p: any) => p.id));
    check("workerN(신규): 운영자 공고만 노출", idsN.has(String(pAdmin.id)) && !idsN.has(String(pA.id)) && !idsN.has(String(pB.id)), [...idsN]);

    const detailB = await postDetailGET(workerReq(`/api/recruit/posts/${pB.id}`, tokenW, "GET"), { params: Promise.resolve({ id: String(pB.id) }) });
    check("상세: 비노출 공고(B) → 404", detailB.status === 404, detailB.status);
    const detailA = await postDetailGET(workerReq(`/api/recruit/posts/${pA.id}`, tokenW, "GET"), { params: Promise.resolve({ id: String(pA.id) }) });
    check("상세: 노출 공고(A) → 200", detailA.status === 200);

    const applyB = await applyPOST(workerReq("/api/worker/recruit/apply", tokenW, "POST", { recruitPostId: String(pB.id), certNumber: "T1" }));
    check("신청: 비노출 공고(B) → 403", applyB.status === 403, applyB.status);
    const applyA = await applyPOST(workerReq("/api/worker/recruit/apply", tokenW, "POST", { recruitPostId: String(pA.id), certNumber: "T2" }));
    const applyAbody = await applyA.json();
    check("신청: 노출 공고(A) → success", applyAbody.success === true, applyAbody);

    // ── TEST 2: 위치잠금 백엔드 강제 ──
    console.log("\n[TEST 2] 위치잠금 백엔드 강제");
    // 확정된 site에 workerW 배정(propose는 배정 필요). 허용범위 내(동일 좌표) propose.
    const lockedSite = await prisma.site.create({ data: { companyName: `잠금현장_${ts}`, address: "서울", gpsLat: 37.5665, gpsLon: 126.9780, allowanceRange: 200, agencyId: agencyA.id, isActive: true, basePointConfirmed: true } });
    sites.push(lockedSite.id);
    await prisma.siteAssignment.create({ data: { siteId: lockedSite.id, workerId: workerW.id, agencyId: agencyA.id, status: "ACTIVE", startDate: new Date(), workType: "FULL_DAY", commuteGuidanceIncluded: false } });
    const lockRes = await (await proposePOST(workerReq("/api/site/basepoint/propose", tokenW, "POST", { siteId: String(lockedSite.id), proposedLat: 37.5666, proposedLon: 126.9781 }))).json();
    check("확정 site: applied=false(덮어쓰기 안 됨)", lockRes.applied === false, lockRes);
    check("확정 site: locked=true", lockRes.locked === true, lockRes);
    check("확정 site: status=CORRECTION_REQUESTED", lockRes.status === "CORRECTION_REQUESTED");
    const lockedAfter = await prisma.site.findUnique({ where: { id: lockedSite.id } });
    check("확정 site: 원본 좌표 불변", Number(lockedAfter?.gpsLat) === 37.5665 && Number(lockedAfter?.gpsLon) === 126.9780, { lat: lockedAfter?.gpsLat, lon: lockedAfter?.gpsLon });

    // 미확정 site → 허용범위 내 propose는 기존대로 즉시 확정(덮어씀)
    const unconfSite = await prisma.site.create({ data: { companyName: `미확정현장_${ts}`, address: "서울", gpsLat: 37.5665, gpsLon: 126.9780, allowanceRange: 200, agencyId: agencyA.id, isActive: true, basePointConfirmed: false } });
    sites.push(unconfSite.id);
    await prisma.siteAssignment.create({ data: { siteId: unconfSite.id, workerId: workerW.id, agencyId: agencyA.id, status: "ACTIVE", startDate: new Date(), workType: "FULL_DAY", commuteGuidanceIncluded: false } });
    const unconfRes = await (await proposePOST(workerReq("/api/site/basepoint/propose", tokenW, "POST", { siteId: String(unconfSite.id), proposedLat: 37.5666, proposedLon: 126.9781 }))).json();
    check("미확정 site: applied=true(최초 확정)", unconfRes.applied === true, unconfRes);
    check("미확정 site: status=APPROVED", unconfRes.status === "APPROVED");
    const unconfAfter = await prisma.site.findUnique({ where: { id: unconfSite.id } });
    check("미확정 site: 좌표 갱신됨", Number(unconfAfter?.gpsLat) === 37.5666, { lat: unconfAfter?.gpsLat });
    check("미확정 site: confirmed=true 전환", unconfAfter?.basePointConfirmed === true);

    // ── TEST 3: 방향 B 수락 배정 ──
    console.log("\n[TEST 3] 방향 B 제안 수락 → 자동 배정");
    const offerSite = await prisma.site.create({ data: { companyName: `제안현장_${ts}`, address: "서울 영등포", gpsLat: 37.52, gpsLon: 126.9, agencyId: agencyA.id, requiredProfession: "JOB_COACH", isActive: true, basePointConfirmed: true } });
    sites.push(offerSite.id);
    // manager가 현장 연결 제안
    const offerRes = await (await offerPOST(mgrReq("/api/admin/talent/offer", mgrTokenA, "POST", { workerId: String(workerN.id), profession: "JOB_COACH", siteId: String(offerSite.id), message: "제안합니다" }))).json();
    check("제안 전송 success", offerRes.success === true, offerRes);
    const offerWithSite = await prisma.talentOffer.findFirst({ where: { workerId: workerN.id, siteId: offerSite.id } });
    check("offer.siteId 저장됨", offerWithSite?.siteId === offerSite.id);
    // workerN 수락 → 자동 배정
    const tokenN2 = await signWorkerToken({ workerId: String(workerN.id), workerName: workerN.workerName, isTemporary: false });
    const acceptRes = await (await offersPATCH(workerReq("/api/worker/recruit/offers", tokenN2, "PATCH", { id: offerWithSite!.id.toString(), action: "accept" }))).json();
    check("수락 success", acceptRes.success === true, acceptRes);
    check("autoAssigned=true", acceptRes.autoAssigned === true, acceptRes);
    const bAssign = await prisma.siteAssignment.findFirst({ where: { siteId: offerSite.id, workerId: workerN.id } });
    check("SiteAssignment ACTIVE 생성", bAssign?.status === "ACTIVE");
    check("배정 agencyId=site의 agency", bAssign?.agencyId === agencyA.id);

    // 사이트 미연결 제안 → 수락해도 autoAssigned=false
    const offer2 = await prisma.talentOffer.create({ data: { workerId: workerW.id, agencyId: agencyA.id, createdByManagerId: managerA.id, profession: "JOB_COACH", siteName: "텍스트만", status: "PENDING" } });
    const accept2 = await (await offersPATCH(workerReq("/api/worker/recruit/offers", tokenW, "PATCH", { id: offer2.id.toString(), action: "accept" }))).json();
    check("미연결 제안: success", accept2.success === true, accept2);
    check("미연결 제안: autoAssigned=false", accept2.autoAssigned === false, accept2);

  } finally {
    console.log("\n[cleanup]");
    await prisma.siteAssignment.deleteMany({ where: { OR: [{ siteId: { in: sites } }, { workerId: { in: allWorkerIds } }] } });
    await prisma.talentOffer.deleteMany({ where: { workerId: { in: allWorkerIds } } });
    await prisma.recruitApplication.deleteMany({ where: { workerId: { in: allWorkerIds } } });
    await prisma.recruitPost.deleteMany({ where: { OR: [{ agencyId: { in: [agencyA.id, agencyB.id] } }, { createdByAdminId: admin.id }] } });
    await prisma.workerProfession.deleteMany({ where: { workerId: { in: allWorkerIds } } });
    await prisma.site.deleteMany({ where: { id: { in: sites } } });
    await prisma.worker.deleteMany({ where: { id: { in: allWorkerIds } } });
    await prisma.manager.delete({ where: { id: managerA.id } }).catch(() => {});
    await prisma.admin.delete({ where: { id: admin.id } }).catch(() => {});
    await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } }).catch(() => {});
    console.log("  정리 완료");
  }

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
