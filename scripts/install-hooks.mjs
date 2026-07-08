// scripts/install-hooks.mjs
// npm install(prepare) 시 git 훅 경로를 .githooks로 설정. 비-git 환경(Vercel 등)에선 조용히 스킵.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
try {
  if (!existsSync(".git")) process.exit(0);
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
  console.log("[hooks] core.hooksPath → .githooks");
} catch { /* 비치명적 */ }
