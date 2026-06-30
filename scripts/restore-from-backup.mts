// scripts/restore-from-backup.mts
// reset-data-keep-admin.mts 가 남긴 JSON 백업으로 DB를 복원한다.
// admins / _prisma_migrations 는 초기화 때 보존됐으므로 건드리지 않는다(중복 PK 방지).
// 실행: npx tsx scripts/restore-from-backup.mts <backup.json>
import { readFileSync } from "node:fs";
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
assertWritableDb("백업 복원(대량 write)");

const KEEP = new Set(["admins", "_prisma_migrations"]);

const file = process.argv[2];
if (!file) { console.error("사용법: npx tsx scripts/restore-from-backup.mts <backup.json>"); process.exit(1); }

type ColMeta = { dataType: string; udtName: string; hasSeq: boolean };

function esc(s: string) { return "'" + s.replace(/'/g, "''") + "'"; }

function lit(val: any, meta: ColMeta | undefined): string {
  if (val === null || val === undefined) return "NULL";
  const dt = meta?.dataType;
  const udt = meta?.udtName ?? "";
  if (dt === "ARRAY" || udt.startsWith("_")) {
    const arr = Array.isArray(val) ? val : [];
    const elemType = udt.replace(/^_/, "");
    const elems = arr.map((e) => '"' + String(e).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",");
    return esc("{" + elems + "}") + `::${elemType}[]`;
  }
  if (dt === "json" || dt === "jsonb") return esc(JSON.stringify(val)) + `::${dt}`;
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  return esc(String(val)); // bigint(문자열)·timestamp·text·numeric 등 → unknown 리터럴, 컬럼 타입으로 강제변환
}

async function main() {
  const path = join(process.cwd(), file);
  const backup: Record<string, any[]> = JSON.parse(readFileSync(path, "utf8"));
  console.log(`📦 백업 로드: ${file}`);

  // 컬럼 메타(타입·시퀀스 보유)
  const cols = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string; udt_name: string; column_default: string | null }[]>(
    `SELECT table_name, column_name, data_type, udt_name, column_default
     FROM information_schema.columns WHERE table_schema='public'`
  );
  const meta: Record<string, Record<string, ColMeta>> = {};
  for (const c of cols) {
    (meta[c.table_name] ??= {})[c.column_name] = {
      dataType: c.data_type, udtName: c.udt_name,
      hasSeq: !!c.column_default && c.column_default.startsWith("nextval("),
    };
  }

  // FK 제약을 잠시 제거(순서·자기참조·순환 무시) → 삽입 후 재생성. (테이블 소유자 권한이면 가능)
  const fks = await prisma.$queryRawUnsafe<{ tbl: string; conname: string; def: string }[]>(
    `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`
  );
  for (const fk of fks) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${fk.tbl} DROP CONSTRAINT "${fk.conname}"`);
  }
  console.log(`🔓 FK 제약 ${fks.length}개 임시 제거`);

  let totalRows = 0, totalTables = 0;
  for (const [table, rows] of Object.entries(backup)) {
    if (KEEP.has(table)) continue;
    if (!Array.isArray(rows) || rows.length === 0) continue;
    if (!meta[table]) { console.warn(`  · 스킵(테이블 없음): ${table}`); continue; }
    const colNames = Object.keys(rows[0]).filter((c) => meta[table][c]); // 현재 스키마에 있는 컬럼만
    const colList = colNames.map((c) => `"${c}"`).join(", ");
    const values = rows.map((r) => "(" + colNames.map((c) => lit(r[c], meta[table][c])).join(", ") + ")").join(",\n");
    await prisma.$executeRawUnsafe(`INSERT INTO "${table}" (${colList}) VALUES\n${values}`);
    totalRows += rows.length; totalTables++;
    console.log(`  ✓ ${table}: ${rows.length}행`);
  }

  // FK 제약 재생성
  for (const fk of fks) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${fk.tbl} ADD CONSTRAINT "${fk.conname}" ${fk.def}`);
  }
  console.log(`🔒 FK 제약 ${fks.length}개 재생성`);

  // 시퀀스 재설정
  for (const [table, columns] of Object.entries(meta)) {
    if (KEEP.has(table)) continue;
    for (const [col, m] of Object.entries(columns)) {
      if (!m.hasSeq) continue;
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', '${col}'), COALESCE((SELECT MAX("${col}") FROM "${table}"), 1), (SELECT COUNT(*) > 0 FROM "${table}"))`
      );
    }
  }

  console.log(`✅ 복원 완료: ${totalTables}개 테이블 · ${totalRows}행 · 시퀀스 재설정`);
}

main()
  .catch((e) => { console.error("복원 실패:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
