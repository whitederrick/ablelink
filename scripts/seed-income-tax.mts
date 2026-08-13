// scripts/seed-income-tax.mts
// 근로소득 간이세액표(홈택스 .xlsx 원본)를 파싱해 IncomeTaxTable로 upsert.
// 업로드 화면(app/api/admin/payroll/income-tax/upload)과 동일한 파서를 재사용 → 결과 동일.
//
// 실행:
//   dev :  TAX_FILE="C:/path/간이세액표.xlsx" TAX_YEAR=2026 npx tsx scripts/seed-income-tax.mts
//   운영:  TAX_FILE="..." TAX_YEAR=2026 SEED_TARGET=prod CONFIRM_PROD=1 npx tsx scripts/seed-income-tax.mts
//
// 필요 파일: 홈택스 '근로소득 간이세액표' 엑셀 원본(.xlsx). '간이세액표' 시트 + '별표2'(자녀공제) 포함.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
// ★.mts(ESM) → lib/*.ts(CJS) 인터롭: tsx 환경에서 named export가 감지되지 않아
//  (`Object.keys(ns)` = ['default']) 이름 import가 런타임에 실패한다. 리포 전역 조건이며
//  trainee/supervision·traineePlacement·assignmentOverlap도 동일하다. 타입은 정상(named)이라
//  tsc를 만족시키려면 namespace import 후 default가 있으면 그것을, 없으면 namespace 자체를 쓴다.
import * as incomeTaxNs from "../lib/payroll/incomeTax";
type IncomeTaxModule = typeof import("../lib/payroll/incomeTax");
const incomeTaxModule =
  (incomeTaxNs as unknown as { default?: IncomeTaxModule }).default ??
  (incomeTaxNs as unknown as IncomeTaxModule);
const { bracketsFromMatrix, extractChildCreditFromText, summarizeBrackets } = incomeTaxModule;

const PROD_REF = "gmfdmfmgeyvewugbqqiw";

function readEnvFile(file: string, key: string): string | null {
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return null;
}

const taxFile = process.env.TAX_FILE;
const year = Number(process.env.TAX_YEAR);
if (!taxFile) { console.error("⛔ TAX_FILE(엑셀 경로) 필요"); process.exit(1); }
if (!Number.isInteger(year) || year < 2000 || year > 2100) { console.error("⛔ TAX_YEAR(연도) 필요"); process.exit(1); }

const isProd = process.env.SEED_TARGET === "prod";
const url = isProd ? readEnvFile(".env.prod.bak", "DATABASE_URL") : readEnvFile(".env", "DATABASE_URL");
if (!url) { console.error(`DATABASE_URL을 ${isProd ? ".env.prod.bak" : ".env"}에서 못 찾음`); process.exit(1); }
const host = url.match(/@([^:/?]+)/)?.[1] ?? "(unknown)";
const ref = url.match(/postgres\.([a-z0-9]+):/)?.[1] ?? "(unknown)";
console.log(`[seed-tax] 파일=${taxFile} 연도=${year} 대상 host=${host} ref=${ref} (${isProd ? "운영" : "개발"})`);
if (isProd) {
  if (ref !== PROD_REF) { console.error(`⛔ 운영 ref 불일치(기대 ${PROD_REF}) — 중단`); process.exit(1); }
  if (process.env.CONFIRM_PROD !== "1") { console.error("⛔ 운영 반영은 CONFIRM_PROD=1 필요 — 중단"); process.exit(1); }
} else if (ref === PROD_REF) { console.error("⛔ 개발 실행인데 운영 ref가 잡힘 — 중단"); process.exit(1); }

const cellVal = (v: any) => {
  if (v == null) return null;
  if (typeof v === "object") return v.result ?? v.text ?? v.value ?? null;
  return v;
};

const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const buf = readFileSync(taxFile);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  if (wb.worksheets.length === 0) { console.error("⛔ 시트를 찾을 수 없음"); process.exit(1); }

  let brackets: ReturnType<typeof bracketsFromMatrix> = [];
  let usedSheet = "";
  const textParts: string[] = [];
  for (const ws of wb.worksheets) {
    const rows: any[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
      const mapped = vals.map(cellVal);
      rows.push(mapped);
      textParts.push(mapped.map(v => (v == null ? "" : String(v))).join(" "));
    });
    const b = bracketsFromMatrix(rows);
    if (b.length > brackets.length) { brackets = b; usedSheet = ws.name; }
  }
  if (brackets.length === 0) { console.error("⛔ 표 데이터 인식 실패 — '간이세액표' 시트 포함 파일인지 확인"); process.exit(1); }

  const childCredit = extractChildCreditFromText(textParts.join("\n"));
  if (!childCredit) { console.error("⛔ 자녀공제(별표2) 인식 실패 — '별표2' 시트 포함 홈택스 원본 필요"); process.exit(1); }

  await prisma.incomeTaxTable.upsert({
    where: { year },
    create: { year, data: brackets as any, meta: { childCredit } as any, rowCount: brackets.length },
    update: { data: brackets as any, meta: { childCredit } as any, rowCount: brackets.length },
  });
  const s = summarizeBrackets(brackets);
  console.log(`✅ ${year}년 간이세액표 저장 — 시트 '${usedSheet}', ${brackets.length}구간, 가족 ${s.maxDependents}열, 급여 ${s.minPayK}~${s.maxPayK}천원, 자녀공제 ${childCredit.c1}/${childCredit.c2}/+${childCredit.extraPer} (${isProd ? "운영" : "개발"})`);
} finally {
  await prisma.$disconnect();
}
