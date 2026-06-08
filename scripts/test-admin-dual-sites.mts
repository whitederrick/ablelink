// scripts/test-admin-dual-sites.mts
// 데이터계층 E2E: dual 세션 전환 회귀 — /api/admin/sites·/assignments·/system/workers
// manager(에이전시) 기존 동작 유지 + admin(운영자) 신규 동작. 실행: npx tsx scripts/test-admin-dual-sites.mts
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { signManagerSessionToken, MANAGER_SESSION_COOKIE_NAME } from "../lib/managerSession";
import { signAdminSessionToken, ADMIN_SESSION_COOKIE_NAME } from "../lib/adminSession";
import { GET as sitesGET, POST as sitesPOST } from "../app/api/admin/sites/route";
import { POST as assignPOST } from "../app/api/admin/assignments/route";
import { GET as sysWorkersGET } from "../app/api/admin/system/workers/route";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra ?? ""); }
}
function req(url: string, cookie: string, method: string, body?: any) {
  return new NextRequest(`http://localhost${url}`, {
    method, headers: { "Content-Type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function main() {
  const ts = Date.now();
  const agency = await prisma.agency.create({ data: { name: `듀얼_${ts}`, phoneNumber: "02-9", address: "서울", planType: "STANDARD", maxWorkers: 30, maxSites: 30, isActive: true } });
  const manager = await prisma.manager.create({ data: { loginId: `mgr_${ts}`, passwordHash: "x", displayName: "매니저", agencyId: agency.id, isActive: true } });
  const admin = await prisma.admin.create({ data: { loginId: `adm_${ts}`, passwordHash: "x", displayName: "운영자", isActive: true } });
  const worker = await prisma.worker.create({ data: { loginId: `w_${ts}`, password: "x", workerName: "워커", phoneNumber: `010${ts}`.slice(0, 11), status: "ACTIVE", planType: "FREE" } });
  await prisma.workerProfession.create({ data: { workerId: worker.id, profession: "JOB_COACH", certNumber: "C1", experienceYears: 1, isPrimary: true, verifyStatus: "VERIFIED" } });

  const mgrCookie = `${MANAGER_SESSION_COOKIE_NAME}=${await signManagerSessionToken({ sub: String(manager.id), agencyId: String(agency.id), loginId: manager.loginId })}`;
  const admCookie = `${ADMIN_SESSION_COOKIE_NAME}=${await signAdminSessionToken({ sub: String(admin.id), loginId: admin.loginId })}`;

  const created: bigint[] = [];
  try {
    // ── TEST 1: manager 사이트 생성(기존 동작 유지) + 직종 저장 ──
    console.log("\n[TEST 1] manager 사이트 생성 + requiredProfession");
    const mSite = await (await sitesPOST(req("/api/admin/sites", mgrCookie, "POST", { companyName: `M현장_${ts}`, address: "서울 강남", gpsLat: "37.5", gpsLon: "127.0", businessContactName: "담당자", businessContactPhone: "01000000000", requiredProfession: "JOB_COACH" }))).json();
    check("manager 사이트 생성 success", mSite.success === true, mSite);
    check("requiredProfession 저장", mSite.item?.requiredProfession === "JOB_COACH", mSite.item);
    if (mSite.item?.id) created.push(BigInt(mSite.item.id));

    // ── TEST 2: admin 사이트 생성(운영자, body.agencyId) ──
    console.log("\n[TEST 2] admin(운영자) 사이트 생성");
    const aSite = await (await sitesPOST(req("/api/admin/sites", admCookie, "POST", { agencyId: String(agency.id), companyName: `A현장_${ts}`, address: "서울 마포", gpsLat: "37.55", gpsLon: "126.91", businessContactName: "담당자", businessContactPhone: "01000000000", requiredProfession: "JOB_COACH" }))).json();
    check("admin 사이트 생성 success", aSite.success === true, aSite);
    check("admin 사이트 agencyId 귀속", aSite.item?.agencyId === String(agency.id), aSite.item);
    const aSiteId = aSite.item?.id ? BigInt(aSite.item.id) : null;
    if (aSiteId) created.push(aSiteId);

    // ── TEST 3: admin 배정(assignedByManagerId=null) ──
    console.log("\n[TEST 3] admin 직무지도원 배정");
    const aAssign = await (await assignPOST(req("/api/admin/assignments", admCookie, "POST", { siteId: String(aSiteId), workerId: String(worker.id), workType: "FULL_DAY" }))).json();
    check("admin 배정 success", aAssign.success === true, aAssign);
    const aAssignRow = await prisma.siteAssignment.findFirst({ where: { siteId: aSiteId!, workerId: worker.id } });
    check("배정 ACTIVE", aAssignRow?.status === "ACTIVE");
    check("배정 agencyId=site의 agency", aAssignRow?.agencyId === agency.id);
    check("admin 배정 assignedByManagerId=null", aAssignRow?.assignedByManagerId === null, aAssignRow?.assignedByManagerId);

    // ── TEST 4: manager 배정(assignedByManagerId=manager.id) ──
    console.log("\n[TEST 4] manager 직무지도원 배정(기존 동작)");
    const mAssign = await (await assignPOST(req("/api/admin/assignments", mgrCookie, "POST", { siteId: mSite.item.id, workerId: String(worker.id), workType: "AM" }))).json();
    check("manager 배정 success", mAssign.success === true, mAssign);
    const mAssignRow = await prisma.siteAssignment.findFirst({ where: { siteId: BigInt(mSite.item.id), workerId: worker.id } });
    check("manager 배정 assignedByManagerId=manager.id", mAssignRow?.assignedByManagerId === manager.id, mAssignRow?.assignedByManagerId);

    // ── TEST 5: manager GET sites = 본인 agency만 ──
    console.log("\n[TEST 5] manager 사이트 목록(스코프)");
    const mList = await (await sitesGET(req("/api/admin/sites?pageSize=100", mgrCookie, "GET"))).json();
    check("manager 목록 success", mList.success === true);
    check("목록 전부 본인 agency", (mList.items ?? []).every((s: any) => s.agencyId === String(agency.id)), mList.items?.map((s: any) => s.agencyId));

    // ── TEST 6: system/workers 직종 필터 ──
    console.log("\n[TEST 6] system/workers 직종 필터");
    const wList = await (await sysWorkersGET(req("/api/admin/system/workers?profession=JOB_COACH", admCookie, "GET"))).json();
    check("필터 success", wList.success === true);
    check("결과에 JOB_COACH 워커 포함", (wList.workers ?? []).some((w: any) => w.id === String(worker.id)), "");
    const careList = await (await sysWorkersGET(req("/api/admin/system/workers?profession=CAREGIVER", admCookie, "GET"))).json();
    check("CAREGIVER 필터엔 미포함", !(careList.workers ?? []).some((w: any) => w.id === String(worker.id)));

  } finally {
    console.log("\n[cleanup]");
    await prisma.siteAssignment.deleteMany({ where: { workerId: worker.id } });
    await prisma.workerProfession.deleteMany({ where: { workerId: worker.id } });
    await prisma.site.deleteMany({ where: { id: { in: created } } });
    await prisma.worker.delete({ where: { id: worker.id } }).catch(() => {});
    await prisma.manager.delete({ where: { id: manager.id } }).catch(() => {});
    await prisma.admin.delete({ where: { id: admin.id } }).catch(() => {});
    await prisma.agency.delete({ where: { id: agency.id } }).catch(() => {});
    console.log("  정리 완료");
  }

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
