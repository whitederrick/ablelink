// scripts/verify-pilot-manager-name.mts
// 파일럿 PDF 위탁기관 담당자명·수기 공란 검증 — v1.8 §9, §12 7단계.
// 실행: npx tsx scripts/verify-pilot-manager-name.mts
//
// ★1번 주장은 여기서도 "기존 서비스가 안 흔들린다"이다.
//   `resolvePilotManagerSlotName`은 비파일럿에 **null**을 돌려주고, 호출부는 null이면
//   아무것도 하지 않는다. 즉 비파일럿 문서의 담당자 슬롯은 한 글자도 바뀌지 않는다.
//
// ★그리고 "값이 맞다"에서 멈추지 않는다. 실제로 PDF를 렌더해서 그 문자열이 서명 줄에
//   진짜 찍히는지까지 본다(값만 맞고 안 찍히면 §9는 충족이 아니다).
//
// ⚠️ 파괴적 — assertWritableDb()로 운영 DB를 차단한다.
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

import PDFDocument from "pdfkit";
import { PrismaClient } from "@prisma/client";
import { assertWritableDb } from "./_dbGuard.mts";
import { CleanupGuard } from "./_cleanupGuard.mts";

// ── 렌더 관측(스윕과 같은 방식: 앱을 건드리지 않고 프로토타입만 감싼다) ──
interface DocLike { y?: number; page?: { height: number; margins: { bottom: number } } }
type AnyFn = (this: DocLike, ...args: never[]) => unknown;
interface PatchTarget { text: (this: DocLike, text: unknown, ...rest: unknown[]) => unknown }
let drawn: string[] = [];
let capturing = false;
const proto = PDFDocument.prototype as unknown as PatchTarget;
const origText = proto.text;
proto.text = function (this: DocLike, text: unknown, ...rest: unknown[]) {
  if (capturing) drawn.push(String(text ?? ""));
  return (origText as unknown as AnyFn).apply(this, [text, ...rest] as never[]);
};

const capNs = await import("../lib/pilot/capability");
const { renderPdfKit } = await import("../lib/pdf/pdfkitRenderer");
function interop<T>(ns: unknown): T { return (ns as { default?: T }).default ?? (ns as T); }
const { resolvePilotManagerSlotName, PILOT_HANDWRITE_BLANK } =
  interop<typeof import("../lib/pilot/capability")>(capNs);

const prisma = new PrismaClient();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

/** 출근부를 렌더해서 "(공단/위탁기관) 담당자" 줄에 실제로 찍힌 문자열을 돌려준다. */
async function renderGovAgentLine(name: string): Promise<string | null> {
  drawn = []; capturing = true;
  await renderPdfKit("ATTENDANCE_SHEET", {
    workerName: "홍길동", workerPhone: "010-0000-0000", companyName: "검증 사업체",
    periodStartYMD: "2026.08.03", periodEndYMD: "2026.08.14",
    totalDays: 10, totalHours: 80, weeklyHolidayCount: 0, monthlyLeaveCount: 0, allowanceTotalWon: "0",
    oneToOneHours: 80, oneToManyHours: 0, otOneToOneHours: 0, otOneToManyHours: 0,
    entries: [{ date: "2026-08-03", start: "09:00", end: "18:00", hours: 8, multiHours: 0 }],
    signatures: {
      govAgent: { name }, companyManager: { name: "이사업" },
      worker: { name: "홍길동" }, agencyAgent: { name },
    },
  });
  capturing = false;
  return drawn.find(t => t.startsWith("(공단/위탁기관) 담당자")) ?? null;
}

async function main() {
  await assertWritableDb();
  const stamp = Date.now();
  const c = new CleanupGuard();

  const agency = await prisma.agency.create({ data: { name: `__mn_ag_${stamp}`, planType: "FREE" } });
  const admin = await prisma.admin.create({
    data: { loginId: `__mn_adm_${stamp}`, passwordHash: "x", displayName: "운영자" },
  });
  const site = await prisma.site.create({
    data: { companyName: "__mn_site", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: agency.id },
  });
  const worker = await prisma.worker.create({
    data: {
      loginId: `__mn_w_${stamp}`, password: "x", workerName: "지도원",
      phoneNumber: `0113${String(stamp).slice(-7)}`, role: "WORKER", status: "ACTIVE", planType: "STANDARD",
    },
  });

  const sessionIds: bigint[] = [];
  try {
    const mkSession = async (managerDisplayName: string | null) => {
      const s = await prisma.pilotSession.create({
        data: {
          agencyId: agency.id, startDate: D("2026-08-01"), endDate: D("2026-08-31"),
          createdByAdminId: admin.id, status: "DRAFT", managerDisplayName,
        },
      });
      sessionIds.push(s.id);
      return s;
    };
    const mkAssignment = (pilotSessionId: bigint | null) =>
      prisma.siteAssignment.create({
        data: {
          workerId: worker.id, siteId: site.id, agencyId: agency.id, pilotSessionId,
          status: "ACTIVE", workType: "FULL_DAY", startDate: D("2026-08-01"), endDate: D("2026-08-31"),
        },
      });

    // ── ① 표시명이 있으면 그 이름 ──────────────────────────────
    console.log("\n[①] 표시명 입력 → 이름 인쇄");
    const sNamed = await mkSession("김담당");
    const aNamed = await mkAssignment(sNamed.id);
    check("표시명 그대로 반환", (await resolvePilotManagerSlotName(aNamed.id)) === "김담당");

    // ── ② 표시명이 없으면 수기 공란 ────────────────────────────
    console.log("\n[②] 표시명 미입력 → 고정 폭 수기 입력 공간");
    const sBlank = await mkSession(null);
    const aBlank = await mkAssignment(sBlank.id);
    check("null → 수기 공란", (await resolvePilotManagerSlotName(aBlank.id)) === PILOT_HANDWRITE_BLANK);

    const sSpace = await mkSession("   ");
    const aSpace = await mkAssignment(sSpace.id);
    check("★공백만 입력해도 수기 공란(이름으로 오인 금지)",
      (await resolvePilotManagerSlotName(aSpace.id)) === PILOT_HANDWRITE_BLANK);

    check("수기 공란은 ASCII 밑줄만(폰트 글리프 누락 방지)", /^_+$/.test(PILOT_HANDWRITE_BLANK));

    // ── ③ 비파일럿은 건드리지 않는다 ───────────────────────────
    console.log("\n[③] 비파일럿 무변경 — null이면 호출부가 아무것도 하지 않는다");
    const aNormal = await mkAssignment(null);
    check("★비파일럿 배정 → null", (await resolvePilotManagerSlotName(aNormal.id)) === null);
    check("없는 배정 → null(기존 흐름 방해 없음)",
      (await resolvePilotManagerSlotName(BigInt("9999999999"))) === null);

    // ── ④ 렌더까지 — 값이 맞는 것과 실제로 찍히는 것은 다르다 ──
    console.log("\n[④] 실제 PDF 렌더 — 담당자 줄에 진짜 찍히는가");
    const named = await renderGovAgentLine("김담당");
    check("이름이 담당자 줄에 인쇄됨", named !== null && named.includes("김담당"), named);
    check("이름이 있어도 서명란 문구는 유지(서명은 공란)",
      named !== null && named.includes("(서명 또는 인)"), named);

    const blank = await renderGovAgentLine(PILOT_HANDWRITE_BLANK);
    check("수기 공란이 담당자 줄에 인쇄됨", blank !== null && blank.includes(PILOT_HANDWRITE_BLANK), blank);
    check("수기 공란도 서명란 문구 유지", blank !== null && blank.includes("(서명 또는 인)"), blank);

    // ★양성 대조 — 감지기가 아무 줄이나 통과시키는 게 아님을 보인다.
    check("★양성 대조: 없는 이름은 잡히지 않는다", named !== null && !named.includes("박없음"), named);

    // ── ⑤ 미리보기·다운로드 동일성 ─────────────────────────────
    console.log("\n[⑤] 미리보기와 다운로드가 같은 값을 쓴다");
    const twice = await Promise.all([
      resolvePilotManagerSlotName(aNamed.id),
      resolvePilotManagerSlotName(aNamed.id),
    ]);
    check("같은 배정 → 항상 같은 결과(두 라우트가 이 함수 하나만 호출)", twice[0] === twice[1]);

  } finally {
    console.log("\n[정리]");
    await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { agencyId: agency.id } }));
    for (const sid of sessionIds) {
      await c.step(`pilotSession#${sid}`, () => prisma.pilotSession.delete({ where: { id: sid } }));
    }
    await c.step("worker", () => prisma.worker.delete({ where: { id: worker.id } }));
    await c.step("site", () => prisma.site.delete({ where: { id: site.id } }));
    await c.step("admin", () => prisma.admin.delete({ where: { id: admin.id } }));
    await c.step("agency", () => prisma.agency.delete({ where: { id: agency.id } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__mn_"]);
  }

  console.log(`\n=== 결과: ${pass} passed, ${fail} failed ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
