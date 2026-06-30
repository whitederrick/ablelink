// scripts/_dbGuard.mts
// 운영 DB 보호 가드 — 파괴적 스크립트(seed/reset/restore/cleanup 등)가 운영 DB를 실수로 타격하는 것을 막는다.
//
// 규칙:
//   - .env의 DB_ENV === "development" 이면 자유 실행(개발 DB로 간주).
//   - 그 외(운영/미설정 등)면 차단. 정말 실행하려면 CONFIRM_DESTRUCTIVE=1 환경변수로 강제.
//   - 어느 경우든 대상 DB host를 출력해 사용자가 눈으로 확인하게 한다.
//
// 사용: 파괴적 작업 직전에  assertWritableDb()  호출.
//   - 개발 DB:   .env 에  DB_ENV=development  추가 → 그냥 실행
//   - 강제 실행: CONFIRM_DESTRUCTIVE=1 npx tsx scripts/xxx.mts   (운영이라도 강행)
import { readFileSync } from "node:fs";

let envLoaded = false;
function loadEnvOnce() {
  if (envLoaded) return;
  envLoaded = true;
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

function dbHost(): string {
  const url = process.env.DATABASE_URL || "";
  return url.match(/@([^:/?]+)/)?.[1] ?? "(unknown)";
}

/** 파괴적 작업 직전 호출. 운영/미확인 DB면 process.exit(1)로 중단. */
export function assertWritableDb(label = "파괴적 작업"): void {
  loadEnvOnce();
  const host = dbHost();
  const dbEnv = (process.env.DB_ENV || "").toLowerCase();
  const forced = process.env.CONFIRM_DESTRUCTIVE === "1";

  console.log(`[dbGuard] ${label} 대상 DB host: ${host}  (DB_ENV=${dbEnv || "미설정"})`);

  if (dbEnv === "development") return; // 개발 DB — 자유 실행

  if (forced) {
    console.warn(`[dbGuard] ⚠️ CONFIRM_DESTRUCTIVE=1 — DB_ENV='${dbEnv || "미설정"}'(운영/미확인) DB에 ${label}을 강행합니다.`);
    return;
  }

  console.error(
    `\n⛔ [dbGuard] ${label} 차단.\n` +
    `   대상 DATABASE_URL host = ${host}\n` +
    `   DB_ENV이 'development'가 아니어서(운영 또는 미확인 DB 가능성) 자동 차단했습니다.\n\n` +
    `   ▸ 개발 DB라면: .env 에  DB_ENV=development  를 추가하세요.\n` +
    `   ▸ 정말 이 DB에 강행하려면:  CONFIRM_DESTRUCTIVE=1 npx tsx <스크립트>\n`,
  );
  process.exit(1);
}
