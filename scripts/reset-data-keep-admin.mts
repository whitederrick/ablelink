// scripts/reset-data-keep-admin.mts
// 운영자(admins) 계정만 남기고 전체 데이터 초기화 + ID 시퀀스 리셋.
// 실행 전 전체 JSON 백업을 backups/ 에 남긴다.
// 실행: npx tsx scripts/reset-data-keep-admin.mts
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// .env 로드
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

import { PrismaClient } from "@prisma/client";
import { assertWritableDb } from "./_dbGuard.mts";

const prisma = new PrismaClient();
assertWritableDb("전체 데이터 초기화(admins 외 TRUNCATE)");

// 보존할 테이블: 운영자 계정 + 마이그레이션 이력
const KEEP = new Set(["admins", "_prisma_migrations"]);

function jsonReplacer(_k: string, v: any) {
  return typeof v === "bigint" ? v.toString() : v;
}

async function main() {
  // 1) 전체 테이블 목록
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );
  const allTables = tables.map((t) => t.tablename);

  // 2) 전체 백업(JSON)
  const backup: Record<string, any[]> = {};
  for (const t of allTables) {
    backup[t] = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "${t}"`);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `db-backup-${ts}.json`);
  writeFileSync(file, JSON.stringify(backup, jsonReplacer, 0));
  const totalRows = Object.values(backup).reduce((a, r) => a + r.length, 0);
  console.log(`✅ 백업: ${file}`);
  console.log(`   테이블 ${allTables.length}개 · 총 ${totalRows}행`);

  // 3) 초기화 대상(보존 테이블 제외)
  const targets = allTables.filter((t) => !KEEP.has(t));
  if (targets.length === 0) {
    console.log("초기화할 테이블이 없습니다.");
    return;
  }
  const quoted = targets.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  console.log(`🧹 초기화: ${targets.length}개 테이블 TRUNCATE + ID 시퀀스 리셋`);
  console.log(`   보존: ${[...KEEP].join(", ")}`);

  // 4) 확인
  const [{ c: adminCount }] = await prisma.$queryRawUnsafe<{ c: number }[]>(
    `SELECT count(*)::int AS c FROM "admins"`,
  );
  const admins = await prisma.$queryRawUnsafe<{ login_id: string }[]>(
    `SELECT login_id FROM "admins" ORDER BY id`,
  );
  console.log(`👤 운영자 ${adminCount}명 보존: ${admins.map((a) => a.login_id).join(", ")}`);
}

main()
  .catch((e) => { console.error("초기화 실패:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
