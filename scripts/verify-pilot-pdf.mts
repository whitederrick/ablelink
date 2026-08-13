// scripts/verify-pilot-pdf.mts
// 파일럿 전용 PDF 스윕 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §9
//
// 실행:
//   npx tsx scripts/verify-pilot-pdf.mts --baseline   # 관측값을 baseline으로 기록(시각검증 통과 후에만)
//   npx tsx scripts/verify-pilot-pdf.mts              # baseline 대비 악화 검사
//   npx tsx scripts/verify-pilot-pdf.mts --scan       # 공란 개수 후보를 훑어 필요한 폭을 확보한다
//
// ★★기존 자산과 완전히 분리한다.
//  `scripts/verify-pdf-sweep.mts` 와 `scripts/pdf-sweep-baseline.json` 은 **읽지도 쓰지도 않는다.**
//  그 둘은 파일럿과 무관한 운영 회귀 감시 자산이고, 이름이 "김담당"(한글 3자)로 하드코딩돼 있어
//  파일럿 변형(공백 15개)과는 폭이 완전히 달라 같은 baseline 으로 비교할 수 없다.
//
// ★무엇을 보는가 — 공란이 서명 줄을 **wrap** 시키는가.
//  `pdfkitRenderer:112` 의 페이지 분할 가드는 서명 블록 높이를 `rows.length * 24` 로 계산한다.
//  한 행이 2줄로 흐르면 실제 높이를 과소평가해 블록이 페이지 하단을 넘는다
//  (`3792360`·2026-07-20 서명부 분할 사고와 같은 클래스).
//
// ★위험원은 공란만이 아니다. 파일럿은 같은 블록에서 **두 줄이 동시에 길어진다** —
//  govAgent 에 공란이 들어가고, companyManager 에 없던 사업체 담당자명이 들어간다(F25b).
//  그래서 담당자명 길이 변형까지 함께 돌린다.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import PDFDocument from "pdfkit";

const BASELINE = "scripts/pilot-pdf-baseline.json";
const MODE_BASELINE = process.argv.includes("--baseline");
const MODE_SCAN = process.argv.includes("--scan");

// ── 관측 장치 ────────────────────────────────────────────────────────────────
// ★wrap 판정: 렌더러가 doc.text(line, x, y, { width, align }) 로 서명 줄을 그린다.
//  그 시점의 폰트로 widthOfString(line) 을 재서 width 를 넘으면 pdfkit 이 줄바꿈한다.
type SigDraw = { page: number; text: string; width: number; textWidth: number; wrapped: boolean; y: number; bottom: number };

let pageCount = 0;
let sigDraws: SigDraw[] = [];
let capturing = false;

interface DocLike {
  y?: number;
  page?: { height: number; margins: { bottom: number } };
  widthOfString: (s: string) => number;
}
type AnyFn = (this: DocLike, ...args: never[]) => unknown;
interface PatchTarget {
  addPage: (this: DocLike, ...args: unknown[]) => unknown;
  text: (this: DocLike, text: unknown, ...rest: unknown[]) => unknown;
}

const proto = PDFDocument.prototype as unknown as PatchTarget;
const origAddPage = proto.addPage;
const origText = proto.text;

proto.addPage = function (this: DocLike, ...args: unknown[]) {
  const r = (origAddPage as unknown as AnyFn).apply(this, args as never[]);
  if (capturing) pageCount++;
  return r;
};

// 서명 줄만 식별한다 — 두 tail 중 하나로 끝나는 줄이 signatures() 의 산물이다.
const TAILS = ["(서명 또는 인)", "(서 명)"];

proto.text = function (this: DocLike, text: unknown, ...rest: unknown[]) {
  if (capturing) {
    const s = String(text ?? "");
    if (TAILS.some((t) => s.endsWith(t)) && s.includes(" : ")) {
      const opts = (rest.find((r) => r && typeof r === "object") ?? {}) as { width?: number };
      const width = typeof opts.width === "number" ? opts.width : 0;
      let tw = 0;
      try { tw = this.widthOfString(s); } catch { tw = 0; }
      const y = typeof rest[0] === "number" && typeof rest[1] === "number" ? rest[1] : this.y;
      const page = this.page;
      sigDraws.push({
        page: pageCount, text: s, width, textWidth: tw,
        wrapped: width > 0 && tw > width,
        y: typeof y === "number" ? y : 0,
        bottom: page ? page.height - page.margins.bottom : 0,
      });
    }
  }
  return (origText as unknown as AnyFn).apply(this, [text, ...rest] as never[]);
};

const { renderPdfKit } = await import("../lib/pdf/pdfkitRenderer");

// ── 케이스 ───────────────────────────────────────────────────────────────────
const D0 = "2026-03-02";
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function dot(s: string) { return s.replace(/-/g, "."); }
function dowIdx(ymd: string) { const [y, m, d] = ymd.split("-").map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }

/** 사업체 담당자명 길이 변형 — 파일럿에서 companyManager 에 실명이 들어가므로 함께 흔든다. */
const CONTACT_NAMES = [
  { label: "2자", v: "김담" },
  { label: "3자", v: "김담당" },
  { label: "4자", v: "김담당자" },
  { label: "6자", v: "김담당자대리" },
  { label: "10자", v: "김담당자대리사업체총괄" },
];
const DAY_CASES = [28, 60, 100, 140, 200];
const START_OFFSETS = [
  { label: "월요일시작", offset: 0 },
  { label: "토요일시작", offset: 5 },
  { label: "일요일시작", offset: 6 },
];

function attendancePayload(startYmd: string, days: number, blank: string, contact: string) {
  const endYmd = addDays(startYmd, days - 1);
  const entries: { date: string; start: string; end: string; hours: number; multiHours: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(startYmd, i);
    if (dowIdx(d) >= 5) continue;
    entries.push({ date: d, start: "09:00", end: "18:00", hours: 8, multiHours: i % 3 === 0 ? 2 : 0 });
  }
  return {
    workerName: "이지도", workerPhone: "010-1234-5678", companyName: "파일럿 검증 사업체",
    periodStartYMD: dot(startYmd), periodEndYMD: dot(endYmd),
    totalDays: entries.length, totalHours: entries.length * 8,
    weeklyHolidayCount: 0, monthlyLeaveCount: 0, allowanceTotalWon: "0",
    oneToOneHours: entries.length * 8, oneToManyHours: 0, otOneToOneHours: 0, otOneToManyHours: 0,
    entries,
    signatures: { govAgent: { name: blank }, companyManager: { name: contact }, worker: { name: "이지도" } },
  };
}

function logRows(startYmd: string, days: number) {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(startYmd, i);
    if (dowIdx(d) >= 5) continue;
    rows.push({
      dateYMD: dot(d), attend: "출근", startTime: "09:00", endTime: "18:00",
      tasks: [{ name: "포장 보조", level: "수행" }, { name: "정리 정돈", level: "부분수행" }],
      note: "특이사항 없음", guidance: "1:1",
    });
  }
  return rows;
}

function trainingLogPayload(startYmd: string, days: number, blank: string, contact: string) {
  return {
    traineeName: "김훈련", companyName: "파일럿 검증 사업체",
    periodStartYMD: dot(startYmd), periodEndYMD: dot(addDays(startYmd, days - 1)),
    preStartYMD: dot(startYmd), rows: logRows(startYmd, days), issues: "특이사항 없음",
    signatures: { govAgent: { name: blank }, companyManager: { name: contact }, worker: { name: "이지도" } },
  };
}

function adaptationLogPayload(startYmd: string, days: number, blank: string) {
  return {
    traineeName: "김훈련", companyName: "파일럿 검증 사업체",
    periodStartYMD: dot(startYmd), periodEndYMD: dot(addDays(startYmd, days - 1)),
    adaptation: true, rows: logRows(startYmd, days), issues: "특이사항 없음",
    signatures: { worker: { name: "이지도" }, govAgent: { name: blank } },
  };
}

const DOCS = [
  { type: "ATTENDANCE_SHEET", label: "출근부", build: attendancePayload, hasContact: true },
  { type: "TRAINING_DAILY_LOG", label: "훈련일지", build: trainingLogPayload, hasContact: true },
  { type: "ADAPTATION_DAILY_LOG", label: "적응지도일지", build: (s: string, d: number, b: string) => adaptationLogPayload(s, d, b), hasContact: false },
];

type Obs = { id: string; doc: string; pages: number; sigRows: number; wrapped: number; overflow: number; minSlack: number; govWidth: number };

// ★govAgent 줄만 식별한다 — 공란이 실제로 폭을 차지하는지는 **그 줄의 폭**으로 재야 한다.
//  전체 최소여유(minSlack)는 담당자명 줄이 지배하므로 공란 변화에 반응하지 않는다.
const GOV_LABELS = ["(공단/위탁기관) 담당자", "위탁기관 담당자"];
function isGovLine(s: string) { return GOV_LABELS.some((l) => s.startsWith(`${l} : `)); }

async function run(blank: string): Promise<{ obs: Obs[]; renderFail: number }> {
  const obs: Obs[] = [];
  let renderFail = 0;
  for (const doc of DOCS) {
    for (const days of DAY_CASES) {
      for (const so of START_OFFSETS) {
        const contacts = doc.hasContact ? CONTACT_NAMES : [CONTACT_NAMES[1]];
        for (const c of contacts) {
          const start = addDays(D0, so.offset);
          const id = `${doc.type}|${days}d|${so.label}|${c.label}`;
          pageCount = 1; sigDraws = []; capturing = true;
          try {
            await renderPdfKit(doc.type as never, (doc.build as (...a: unknown[]) => unknown)(start, days, blank, c.v));
          } catch {
            renderFail++; capturing = false; continue;
          }
          capturing = false;
          if (sigDraws.length === 0) { renderFail++; continue; } // 서명 줄을 못 잡으면 관측 실패
          const wrapped = sigDraws.filter((d) => d.wrapped).length;
          const overflow = sigDraws.filter((d) => d.y > d.bottom).length;
          const minSlack = Math.min(...sigDraws.map((d) => d.width - d.textWidth));
          const gov = sigDraws.find((d) => isGovLine(d.text));
          obs.push({
            id, doc: doc.type, pages: pageCount, sigRows: sigDraws.length, wrapped, overflow,
            minSlack: +minSlack.toFixed(1),
            govWidth: gov ? +gov.textWidth.toFixed(2) : -1,
          });
        }
      }
    }
  }
  return { obs, renderFail };
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
const { PILOT_HANDWRITE_BLANK } = await import("../lib/pilot/docConstants");

if (MODE_SCAN) {
  console.log("=== 공란 폭 스캔 ===");
  console.log("  조건 ① 확보 폭 ≥ 33pt (한글 3자 ≈ 12mm — 손으로 이름을 적을 수 있어야 한다)");
  console.log("  조건 ② wrap 0 (서명 줄이 폭을 넘으면 페이지 분할 가드가 높이를 과소평가한다)\n");

  // ★양성 대조 — "wrap 0건"이 무결인지 감지기가 무감각한 것인지 가른다.
  for (const n of [200, 400]) {
    const { obs } = await run(" ".repeat(n));
    const w = obs.reduce((a, o) => a + o.wrapped, 0);
    console.log(`  [양성대조] 공백 x ${n} → wrap ${String(w).padStart(3)}건  ${w > 0 ? "✅ 감지됨" : "❌ 감지기 무감각 — 스윕을 신뢰할 수 없다"}`);
  }

  // ★공백이 실제로 폭을 차지하는가 — 눈으로 안 보이므로 이것부터 확인한다.
  //  빈 문자열일 때의 줄 폭과 대조해 증가분을 잰다. 증가하지 않으면 공백이 무시된 것이다.
  const { obs: obs0 } = await run("");
  // ★govAgent 줄의 폭을 기준으로 삼는다(전체 최소여유가 아니라).
  const govBase = obs0.length ? Math.max(...obs0.map((o) => o.govWidth)) : 0;
  const slackBase = obs0.length ? Math.min(...obs0.map((o) => o.minSlack)) : 0;
  console.log(`\n  기준(이름 빈 값) govAgent 줄 폭 : ${govBase.toFixed(2)}pt · 전체 최소여유 : ${slackBase.toFixed(1)}pt\n`);

  for (const n of [8, 12, 16, 20, 24, 28]) {
    const blank = " ".repeat(n);
    const { obs, renderFail } = await run(blank);
    const wrapped = obs.reduce((a, o) => a + o.wrapped, 0);
    const overflow = obs.reduce((a, o) => a + o.overflow, 0);
    const slack = obs.length ? Math.min(...obs.map((o) => o.minSlack)) : 0;
    const govW = obs.length ? Math.max(...obs.map((o) => o.govWidth)) : 0;
    const gained = govW - govBase;           // ★govAgent 줄이 실제로 넓어진 폭 = 확보된 기입 공간
    const wideEnough = gained >= 33;
    const okAll = wrapped === 0 && overflow === 0 && wideEnough;
    console.log(`  공백 x ${String(n).padStart(2)} → 확보폭 ${gained.toFixed(1).padStart(6)}pt ${wideEnough ? "✅" : "❌<33"} · wrap ${String(wrapped).padStart(3)} · 넘침 ${overflow} · 렌더실패 ${renderFail} · 최소여유 ${slack.toFixed(1).padStart(7)}pt  ${okAll ? "✅ 채택가능" : ""}`);
  }
  console.log("\n  ★확보폭이 0이면 pdfkit 이 공백을 무시한 것이므로 다른 방법을 찾아야 한다.");
  process.exit(0);
}

const { obs, renderFail } = await run(PILOT_HANDWRITE_BLANK);
const totals = {
  cases: obs.length,
  renderFail,
  wrapped: obs.reduce((a, o) => a + o.wrapped, 0),
  overflow: obs.reduce((a, o) => a + o.overflow, 0),
  maxPages: obs.length ? Math.max(...obs.map((o) => o.pages)) : 0,
  minSlack: obs.length ? Math.min(...obs.map((o) => o.minSlack)) : 0,
};

console.log("=== 파일럿 PDF 스윕 ===");
console.log(`  공란            : ${PILOT_HANDWRITE_BLANK.length}자(ASCII 공백)`);
console.log(`  케이스          : ${totals.cases}`);
console.log(`  렌더 실패       : ${totals.renderFail}`);
console.log(`  ★서명줄 wrap    : ${totals.wrapped}`);
console.log(`  ★서명 하단 넘침 : ${totals.overflow}`);
console.log(`  최대 페이지수   : ${totals.maxPages}`);
console.log(`  최소 폭 여유    : ${totals.minSlack}pt`);

// 문서별 최소 여유 — 가장 좁은 문서를 드러낸다.
const byDoc = new Map<string, number>();
for (const o of obs) byDoc.set(o.doc, Math.min(byDoc.get(o.doc) ?? Infinity, o.minSlack));
console.log("\n  문서별 최소 폭 여유:");
for (const d of DOCS) console.log(`    ${d.label.padEnd(7)} : ${byDoc.get(d.type)?.toFixed(1) ?? "-"}pt`);

if (MODE_BASELINE) {
  writeFileSync(BASELINE, JSON.stringify({ blank: PILOT_HANDWRITE_BLANK, totals, obs }, null, 2), "utf8");
  console.log(`\n✅ baseline 기록: ${BASELINE}`);
  process.exit(0);
}

// 절대 조건 — 이 둘은 baseline 과 무관하게 0이어야 한다.
let fail = 0;
if (totals.renderFail > 0) { console.log(`\n❌ 렌더 실패 ${totals.renderFail}건`); fail++; }
if (totals.wrapped > 0) { console.log(`\n❌ 서명줄 wrap ${totals.wrapped}건 — 공란을 줄여야 한다`); fail++; }
if (totals.overflow > 0) { console.log(`\n❌ 서명 블록이 페이지 하단을 넘음 ${totals.overflow}건`); fail++; }

if (!existsSync(BASELINE)) {
  console.log(`\n⚠️ baseline 없음 — 시각검증 통과 후 --baseline 으로 기록하세요.`);
  process.exit(fail > 0 ? 1 : 0);
}
const base = JSON.parse(readFileSync(BASELINE, "utf8")) as { blank: string; totals: typeof totals };
if (base.blank !== PILOT_HANDWRITE_BLANK) {
  console.log(`
❌ 공란 길이가 baseline(${base.blank.length}자)과 다릅니다(현재 ${PILOT_HANDWRITE_BLANK.length}자) — baseline 을 다시 기록해야 합니다.`);
  fail++;
}
for (const k of ["wrapped", "overflow", "renderFail", "maxPages"] as const) {
  if (totals[k] > base.totals[k]) { console.log(`\n❌ ${k} 악화: baseline ${base.totals[k]} → 현재 ${totals[k]}`); fail++; }
}
console.log(fail === 0 ? "\n=== ✅ baseline 대비 악화 없음 ===" : "\n=== ❌ 실패 ===");
process.exit(fail > 0 ? 1 : 0);
