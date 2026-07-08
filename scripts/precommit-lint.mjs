// scripts/precommit-lint.mjs
// 원천 차단 게이트 — 스테이지된 .ts/.tsx/.mts의 '추가·변경된 라인'에 ESLint 에러가 있으면 커밋 차단.
// 레거시 라인(안 건드린 곳)은 통과 → 대규모 마이그레이션 없이 신규 위반 유입만 0으로.
// 경고(warn)는 차단하지 않음(에러만). 인프라 오류 시엔 fail-open(커밋 안 막음).
import { execSync } from "node:child_process";

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch (e) { return e.stdout ? e.stdout.toString() : ""; }
}

// 1) 스테이지된 대상 파일(추가/복사/수정), .claude/ 제외
const staged = sh("git diff --cached --name-only --diff-filter=ACM")
  .split("\n").map((s) => s.trim()).filter(Boolean)
  .filter((f) => /\.(ts|tsx|mts)$/.test(f) && !f.startsWith(".claude/"));
if (staged.length === 0) process.exit(0);

// 2) 파일별 '추가/변경된 라인' 집합(git diff --unified=0 헝크 파싱)
const added = {};
for (const f of staged) {
  const diff = sh(`git diff --cached --unified=0 -- "${f}"`);
  const set = new Set();
  for (const line of diff.split("\n")) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) set.add(start + i);
  }
  added[f] = set;
}

// 3) ESLint(JSON). eslint는 에러 시 비0 종료 → catch에서 stdout 회수.
let raw = "";
try {
  raw = execSync(`npx eslint -f json ${staged.map((f) => `"${f}"`).join(" ")}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  raw = e.stdout ? e.stdout.toString() : "";
}
if (!raw.trim()) { console.error("[pre-commit] ESLint 실행 실패 — 게이트 건너뜀(인프라 오류)."); process.exit(0); }

let report;
try { report = JSON.parse(raw); } catch { console.error("[pre-commit] ESLint 출력 파싱 실패 — 게이트 건너뜀."); process.exit(0); }

// 4) 변경 라인에 걸린 '에러'만 수집
const offenders = [];
for (const file of report) {
  const rel = file.filePath.replace(/\\/g, "/").replace(/.*\/ablelink\//, "");
  const key = staged.find((s) => rel.endsWith(s)) || rel;
  const lines = added[key];
  if (!lines) continue;
  for (const m of file.messages) {
    if (m.severity === 2 && m.line && lines.has(m.line)) {
      offenders.push(`${key}:${m.line}:${m.column}  ${m.ruleId || "error"}  ${m.message}`);
    }
  }
}

if (offenders.length) {
  console.error(`\n⛔ [pre-commit] 변경한 라인에 ESLint 에러 ${offenders.length}건 — 커밋 차단:\n`);
  for (const o of offenders) console.error("  " + o);
  console.error(`\n고치고 다시 커밋하세요. (레거시 라인은 대상 아님. 부득이하면 'git commit --no-verify')\n`);
  process.exit(1);
}
process.exit(0);
