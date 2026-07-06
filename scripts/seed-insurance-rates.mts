// scripts/seed-insurance-rates.mts
// 4대보험 근로자 부담 요율(연도별)을 lib/payroll/insuranceRateDefaults의 참고 기본값으로 upsert.
// InsuranceRates는 운영자 화면 입력값이지만, 초기 구축/누락 방지용으로 공식 참고값을 미리 넣어둔다.
//   · 입력 단위 환산: 기본값(%) ÷ 100 = 저장 분수. 급여계산은 grossPay × 분수.
//   · 산재(industrialAccident)는 업종별·전액 사업주라 생성 시 0, update 시엔 안 덮어씀(운영자 입력 보존).
//   · upsert라 멱등. insurance_rates 외 데이터는 건드리지 않음.
//
// 실행:
//   dev :  npx tsx scripts/seed-insurance-rates.mts
//   운영:  SEED_TARGET=prod CONFIRM_PROD=1 npx tsx scripts/seed-insurance-rates.mts
//          (운영 접속정보는 .env.prod.bak에서 읽고, ref가 운영과 일치하는지 확인 후에만 실행)
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { INSURANCE_RATE_DEFAULTS, INSURANCE_DEFAULT_YEARS } from "../lib/payroll/insuranceRateDefaults";

const PROD_REF = "gmfdmfmgeyvewugbqqiw";

function readEnv(file: string, key: string): string | null {
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return null;
}

const isProd = process.env.SEED_TARGET === "prod";
const url = isProd ? readEnv(".env.prod.bak", "DATABASE_URL") : readEnv(".env", "DATABASE_URL");
if (!url) { console.error(`DATABASE_URL을 ${isProd ? ".env.prod.bak" : ".env"}에서 못 찾음`); process.exit(1); }
const host = url.match(/@([^:/?]+)/)?.[1] ?? "(unknown)";
const ref = url.match(/postgres\.([a-z0-9]+):/)?.[1] ?? "(unknown)";
console.log(`[seed] 대상 host=${host} ref=${ref} (${isProd ? "운영" : "개발"})`);

if (isProd) {
  if (ref !== PROD_REF) { console.error(`⛔ 운영 ref 불일치(기대 ${PROD_REF}) — 중단`); process.exit(1); }
  if (process.env.CONFIRM_PROD !== "1") { console.error("⛔ 운영 반영은 CONFIRM_PROD=1 필요 — 중단"); process.exit(1); }
} else {
  if (ref === PROD_REF) { console.error("⛔ 개발 실행인데 운영 ref가 잡힘 — 중단"); process.exit(1); }
}

const pct = (n: number) => n / 100;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  for (const year of INSURANCE_DEFAULT_YEARS) {
    const d = INSURANCE_RATE_DEFAULTS[year];
    await prisma.insuranceRates.upsert({
      where: { year },
      create: {
        year,
        nationalPension: pct(d.nationalPension),
        healthInsurance: pct(d.healthInsurance),
        longTermCare: pct(d.longTermCare),
        employmentInsurance: pct(d.employmentInsurance),
        industrialAccident: 0,
        // 국민연금 기준소득월액 하한/상한은 **의도적으로 null**(종전 근사=지급액×요율 유지).
        //  잠정 고시값을 시드로 넣으면 노무사 확정 전 무단 clamp(저소득 과공제)가 되므로 넣지 않는다.
        //  운영자가 매년 7월 고시값을 확인해 설정 화면에서 직접 입력해야 clamp가 활성화된다. (B1/B2)
        pensionBaseMin: null,
        pensionBaseMax: null,
      } as any,
      update: {
        nationalPension: pct(d.nationalPension),
        healthInsurance: pct(d.healthInsurance),
        longTermCare: pct(d.longTermCare),
        employmentInsurance: pct(d.employmentInsurance),
        // industrialAccident는 운영자가 입력했을 수 있어 update에서 건드리지 않음.
      } as any,
    });
    console.log(`  ${year}: 연금${d.nationalPension} 건강${d.healthInsurance} 장기요양${d.longTermCare} 고용${d.employmentInsurance}${d.note ? "  · " + d.note : ""}`);
  }
  const total = await prisma.insuranceRates.count();
  console.log(`\n✅ 4대보험 요율 upsert 완료 — 총 ${total}개 연도 존재 (${isProd ? "운영" : "개발"}).`);
} finally {
  await prisma.$disconnect();
}
