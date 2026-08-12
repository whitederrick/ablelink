// scripts/verify-pdf-sweep.mts
// 출근부 PDF 페이지 분할 스윕 — 서명부 분할 회귀 감시(7단계 선행 P0).
//
// 실행:
//   npx tsx scripts/verify-pdf-sweep.mts --baseline   # 관측값을 baseline으로 기록(최초 1회)
//   npx tsx scripts/verify-pdf-sweep.mts              # baseline 대비 악화가 있는지 검사
//
// ★왜 필요한가
//  기존 `verify-pdf.mts`는 문서당 1케이스(총 5건)이고 출근부가 10일치라 **페이지가 나뉘지 않는다.**
//  2026-07-20에 실제로 터진 결함(서명부 2분할 = 6~7주 달, 3분할 캐스케이드)은 페이지 경계에서만
//  나타나므로 그 스크립트로는 영원히 못 잡는다. 기간을 28~200일까지 훑어 경계를 전부 밟는다.
//
// ★판정 기준(사용자 승인 2026-08-12)
//  - baseline은 **관측값 그대로** 기록한다. 0건을 만들려고 앱 코드를 고치지 않는다.
//  - 통과 = "baseline 대비 악화 없음". 새 이상이 생기거나 페이지 수가 늘면 실패.
//  - 이 스크립트는 **앱 코드·스키마를 건드리지 않는다.** 관측은 pdfkit 프로토타입을
//    테스트 쪽에서 감싸는 방식으로만 한다(렌더러는 자기가 감시당하는 줄 모른다).

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import PDFDocument from "pdfkit";

const OUT = "scripts/_pdfout";
// ★baseline은 커밋 대상이다 — `_pdfout/`은 .gitignore라 여기 두면 다음 세션에서 비교 기준이 사라진다.
const BASELINE = "scripts/pdf-sweep-baseline.json";

// ── 관측 장치 ────────────────────────────────────────────────────────────────
// pdfkit 프로토타입을 감싸 "무엇이 몇 페이지 어느 y에 그려졌는지"만 기록한다.
// 렌더러가 doc.text()에 넘기는 값은 **글리프 인코딩 전 원문 문자열**이라 확인문구·서명란을
// 문자열로 식별할 수 있다(PDF를 다시 파싱할 필요가 없다).
type Draw = { page: number; y: number; bottom: number; text: string };

let pageCount = 0;
let draws: Draw[] = [];
let capturing = false;

/** 관측에 필요한 최소 표면만 본다 — pdfkit 전체 타입에 의존하지 않는다. */
interface DocLike {
  y?: number;
  page?: { height: number; margins: { bottom: number } };
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

proto.text = function (this: DocLike, text: unknown, ...rest: unknown[]) {
  if (capturing) {
    // 호출형: text(str, x, y, opts) | text(str, opts) | text(str)
    const y = typeof rest[0] === "number" && typeof rest[1] === "number" ? rest[1] : this.y;
    const page = this.page;
    draws.push({
      page: pageCount,
      y: typeof y === "number" ? y : 0,
      bottom: page ? page.height - page.margins.bottom : 0,
      text: String(text ?? ""),
    });
  }
  return (origText as unknown as AnyFn).apply(this, [text, ...rest] as never[]);
};

// ★렌더러는 위 패치가 적용된 뒤에 import 되어야 한다(모듈 최상위에서 prototype을 캡처하지는
//  않지만, 순서를 명시해 두는 편이 안전하다).
const { renderPdfKit } = await import("../lib/pdf/pdfkitRenderer");

// ── 케이스 생성 ──────────────────────────────────────────────────────────────
const D0 = "2026-03-02"; // 월요일 기준점
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function dot(ymd: string): string { return ymd.replace(/-/g, "."); }
function dow(ymd: string): number { // 0=월 … 6=일
  const [y, m, d] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// 시작 요일 3종 — 주 경계 정렬의 양 끝과 중간을 밟는다.
//  월요일 = 주가 딱 맞아떨어져 주(週) 수가 최소, 일요일 = 앞 주가 6칸 비어 최대, 목요일 = 중간.
const START_OFFSETS: { label: string; offset: number }[] = [
  { label: "월", offset: 0 },
  { label: "목", offset: 3 },
  { label: "일", offset: 6 },
];
const DAY_MIN = 28, DAY_MAX = 200;

function buildPayload(startYmd: string, days: number) {
  const endYmd = addDays(startYmd, days - 1);
  const entries: { date: string; start: string; end: string; hours: number; multiHours: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(startYmd, i);
    const wd = dow(d);
    if (wd >= 5) continue; // 주말 제외 — 실제 출근부와 같은 모양
    entries.push({ date: d, start: "09:00", end: "18:00", hours: 8, multiHours: i % 3 === 0 ? 2 : 0 });
  }
  return {
    workerName: "홍길동", workerPhone: "010-1234-5678", companyName: "스윕 검증 사업체",
    periodStartYMD: dot(startYmd), periodEndYMD: dot(endYmd),
    totalDays: entries.length, totalHours: entries.length * 8,
    weeklyHolidayCount: 0, monthlyLeaveCount: 0, allowanceTotalWon: "0",
    oneToOneHours: entries.length * 8, oneToManyHours: 0, otOneToOneHours: 0, otOneToManyHours: 0,
    entries,
    signatures: {
      govAgent: { name: "김담당" }, companyManager: { name: "이사업" },
      worker: { name: "홍길동" }, agencyAgent: { name: "박기관" },
    },
  };
}

// ── 관측 판정 ────────────────────────────────────────────────────────────────
const SIG_TAIL = "(서명 또는 인)";
const CONFIRM = "위와 같이 근무(출근) 하였음을 확인함";
const DATE_RE = /^\d{4}년\s+\d{1,2}월\s+\d{1,2}일$/;

type Obs = {
  id: string; days: number; startDow: string;
  pages: number;
  /** ★감지기 자체가 살아 있는지 — 서명 3줄·확인문구·작성일을 실제로 봤는가.
   *  이 값이 비면 "이상 0건"은 무결이 아니라 **아무것도 못 본 것**이다. */
  sigLines: number; confirmFound: boolean; dateFound: boolean;
  /** 서명 3줄이 서로 다른 페이지로 쪼개짐 — 2026-07-20에 실제로 터진 결함 */
  sigSplit: boolean;
  /** 확인문구·작성일·서명이 한 블록으로 안 붙음 */
  blockSplit: boolean;
  /** 하단 여백 아래에 그려진 텍스트 — pdfkit 자동 흘림으로 레이아웃이 흩어지는 전조 */
  overflow: number;
  /** 아무것도 안 그려진 빈 페이지 */
  emptyPages: number;
};

function observe(id: string, days: number, startDow: string, src: Draw[], pages: number): Obs {
  const sigPages = new Set<number>();
  let confirmPage = -1, datePage = -1;
  let overflow = 0, sigLines = 0;
  const pagesWithText = new Set<number>();

  for (const d of src) {
    pagesWithText.add(d.page);
    if (d.y > d.bottom) overflow++;
    if (d.text.includes(SIG_TAIL)) { sigPages.add(d.page); sigLines++; }
    else if (d.text === CONFIRM) confirmPage = d.page;
    else if (DATE_RE.test(d.text.trim())) datePage = d.page;
  }

  // ★블록 분리 판정은 "확인문구·작성일·서명 3줄이 **전부 같은 페이지**인가"로 본다.
  //  처음엔 min(서명페이지)와 비교했는데, 블록이 페이지를 걸쳐 흐르면 확인문구와 첫 서명은
  //  같은 페이지라 통과해 버렸다(양성 대조에서 잡힘). 구성요소 전체의 페이지 집합으로 판정한다.
  const blockPages = new Set<number>(sigPages);
  if (confirmPage >= 0) blockPages.add(confirmPage);
  if (datePage >= 0) blockPages.add(datePage);

  let emptyPages = 0;
  for (let p = 1; p <= pages; p++) if (!pagesWithText.has(p)) emptyPages++;

  return {
    id, days, startDow,
    pages,
    sigLines, confirmFound: confirmPage >= 0, dateFound: datePage >= 0,
    sigSplit: sigPages.size > 1,
    blockSplit: blockPages.size > 1,
    overflow,
    emptyPages,
  };
}

// ── 감지기 양성 대조 ─────────────────────────────────────────────────────────
// ★"이상 0건"이 무결인지 무감각인지 가른다. 판정 로직에 **분할된 입력**을 직접 먹여서
//  실제로 잡아내는지 먼저 확인한다. 여기서 실패하면 스윕 결과는 읽을 가치가 없다.
function selfTest(): void {
  const B = 800; // 가짜 페이지 하단
  const split: Draw[] = [
    { page: 1, y: 700, bottom: B, text: CONFIRM },
    { page: 1, y: 730, bottom: B, text: "2026년 8월 12일" },
    { page: 1, y: 760, bottom: B, text: `(공단/위탁기관) 담당자 : 김담당    ${SIG_TAIL}` },
    { page: 2, y: 100, bottom: B, text: `사업체담당자 : 이사업    ${SIG_TAIL}` },
    { page: 2, y: 124, bottom: B, text: `직무지도원 : 홍길동    ${SIG_TAIL}` },
  ];
  const bad = observe("selftest-split", 0, "-", split, 2);
  const clean: Draw[] = [
    { page: 1, y: 700, bottom: B, text: CONFIRM },
    { page: 1, y: 730, bottom: B, text: "2026년 8월 12일" },
    { page: 1, y: 760, bottom: B, text: `(공단/위탁기관) 담당자 : 김담당    ${SIG_TAIL}` },
    { page: 1, y: 784, bottom: B, text: `사업체담당자 : 이사업    ${SIG_TAIL}` },
    { page: 1, y: 790, bottom: B, text: `직무지도원 : 홍길동    ${SIG_TAIL}` },
  ];
  const good = observe("selftest-clean", 0, "-", clean, 1);
  const overflowed = observe("selftest-overflow", 0, "-",
    [{ page: 1, y: 900, bottom: B, text: "하단 침범" }], 1);

  const checks: [string, boolean][] = [
    ["분할 입력 → sigSplit 감지", bad.sigSplit === true],
    ["분할 입력 → blockSplit 감지", bad.blockSplit === true],
    ["정상 입력 → 오탐 없음(양성 대조)", good.sigSplit === false && good.blockSplit === false],
    ["정상 입력 → 마커 3줄 인식", good.sigLines === 3 && good.confirmFound && good.dateFound],
    ["하단 침범 감지", overflowed.overflow === 1],
    ["빈 페이지 감지", observe("t", 0, "-", [{ page: 2, y: 1, bottom: B, text: "x" }], 2).emptyPages === 1],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (failed.length > 0) {
    console.log("\n⛔ 감지기 자체가 고장났다. 스윕 결과를 신뢰할 수 없다.");
    process.exit(1);
  }
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
const isBaselineRun = process.argv.includes("--baseline");
mkdirSync(OUT, { recursive: true });

console.log("[감지기 양성 대조]");
selfTest();
console.log("");

const results: Obs[] = [];
let renderFail = 0;

for (const { label, offset } of START_OFFSETS) {
  const startYmd = addDays(D0, offset);
  for (let days = DAY_MIN; days <= DAY_MAX; days++) {
    const id = `${label}-${days}`;
    pageCount = 0; draws = []; capturing = true;
    try {
      const buf = await renderPdfKit("ATTENDANCE_SHEET", buildPayload(startYmd, days));
      capturing = false;
      if (buf.slice(0, 5).toString() !== "%PDF-" || buf.length < 800) {
        renderFail++;
        console.log(`  ❌ ${id}: PDF가 아니거나 너무 작다(${buf.length}B)`);
        continue;
      }
      results.push(observe(id, days, label, draws, pageCount));
    } catch (e) {
      capturing = false;
      renderFail++;
      console.log(`  ❌ ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ★캡처 경로 검증 — 렌더 케이스에서 마커를 실제로 봤는가.
//  하나라도 놓쳤다면 그 케이스의 "이상 없음"은 무의미하다.
const blind = results.filter(r => r.sigLines !== 3 || !r.confirmFound || !r.dateFound);
if (blind.length > 0) {
  console.log(`\n⛔ 마커를 못 본 케이스 ${blind.length}건 — 감지기가 눈을 감았다.`);
  for (const b of blind.slice(0, 5)) console.log(`  - ${b.id}: sigLines=${b.sigLines} confirm=${b.confirmFound} date=${b.dateFound}`);
  process.exit(1);
}

const summary = {
  cases: results.length,
  renderFail,
  sigSplit: results.filter(r => r.sigSplit).length,
  blockSplit: results.filter(r => r.blockSplit).length,
  overflowCases: results.filter(r => r.overflow > 0).length,
  emptyPageCases: results.filter(r => r.emptyPages > 0).length,
  maxPages: results.reduce((a, r) => Math.max(a, r.pages), 0),
};

console.log("\n=== 스윕 결과 ===");
console.log(`  케이스        : ${summary.cases} (기대 ${START_OFFSETS.length * (DAY_MAX - DAY_MIN + 1)})`);
console.log(`  렌더 실패     : ${summary.renderFail}`);
console.log(`  서명 3줄 분할 : ${summary.sigSplit}`);
console.log(`  블록 분리     : ${summary.blockSplit}`);
console.log(`  하단 침범     : ${summary.overflowCases}`);
console.log(`  빈 페이지     : ${summary.emptyPageCases}`);
console.log(`  최대 페이지수 : ${summary.maxPages}`);

if (isBaselineRun) {
  writeFileSync(BASELINE, JSON.stringify({ summary, results }, null, 2));
  console.log(`\n✅ baseline 기록: ${BASELINE}`);
  console.log("   ★관측값 그대로 저장했다. 이 수치를 0으로 만들려고 앱 코드를 고치지 않는다.");
  process.exit(renderFail > 0 ? 1 : 0);
}

if (!existsSync(BASELINE)) {
  console.log(`\n⛔ baseline이 없다. 먼저 --baseline으로 1회 기록하라.`);
  process.exit(1);
}

// ── baseline 대비 악화 검사 ──────────────────────────────────────────────────
const base = JSON.parse(readFileSync(BASELINE, "utf8")) as { summary: typeof summary; results: Obs[] };
const baseById = new Map(base.results.map(r => [r.id, r]));
const regressions: string[] = [];

for (const cur of results) {
  const b = baseById.get(cur.id);
  if (!b) { regressions.push(`${cur.id}: baseline에 없는 케이스(스윕 범위가 바뀌었다)`); continue; }
  if (!b.sigSplit && cur.sigSplit)   regressions.push(`${cur.id}: 서명 3줄이 새로 분할됨`);
  if (!b.blockSplit && cur.blockSplit) regressions.push(`${cur.id}: 확인문구·작성일·서명 블록이 새로 분리됨`);
  if (cur.overflow > b.overflow)     regressions.push(`${cur.id}: 하단 침범 ${b.overflow}→${cur.overflow}`);
  if (cur.emptyPages > b.emptyPages) regressions.push(`${cur.id}: 빈 페이지 ${b.emptyPages}→${cur.emptyPages}`);
  if (cur.pages > b.pages)           regressions.push(`${cur.id}: 페이지 수 ${b.pages}→${cur.pages}`);
}
for (const b of base.results) if (!results.find(r => r.id === b.id)) regressions.push(`${b.id}: 이번 실행에서 누락`);

if (renderFail > 0) regressions.push(`렌더 실패 ${renderFail}건`);

if (regressions.length === 0) {
  console.log("\n=== ✅ baseline 대비 악화 없음 ===");
  process.exit(0);
}
console.log(`\n=== ❌ 악화 ${regressions.length}건 ===`);
for (const r of regressions.slice(0, 40)) console.log(`  - ${r}`);
if (regressions.length > 40) console.log(`  … 외 ${regressions.length - 40}건`);
process.exit(1);
