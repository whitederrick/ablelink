// scripts/fix-worker-loginid.mts
// 기존 워커 loginId를 전화번호(숫자)로 교정 — 전화번호 로그인 정상화.
// 비파괴: loginId 필드만 갱신. `npx tsx scripts/fix-worker-loginid.mts`
import { prisma } from "../lib/prisma";

async function main() {
  const workers = await prisma.worker.findMany({ select: { id: true, loginId: true, phoneNumber: true, workerName: true } });
  let fixed = 0, skipped = 0, conflict = 0;
  for (const w of workers) {
    const want = (w.phoneNumber ?? "").replace(/-/g, "");
    if (!want) { skipped++; continue; }
    if (w.loginId === want) { skipped++; continue; }
    const clash = await prisma.worker.findUnique({ where: { loginId: want }, select: { id: true } });
    if (clash && clash.id !== w.id) {
      console.warn(`⚠️  충돌: ${w.workerName}(${w.id}) → ${want} 이미 사용중, 건너뜀`);
      conflict++; continue;
    }
    await prisma.worker.update({ where: { id: w.id }, data: { loginId: want } });
    console.log(`✔ ${w.workerName}: ${w.loginId} → ${want}`);
    fixed++;
  }
  console.log(`\n완료 — 교정 ${fixed} · 유지 ${skipped} · 충돌 ${conflict} (총 ${workers.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
