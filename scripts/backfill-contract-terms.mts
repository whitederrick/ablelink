// scripts/backfill-contract-terms.mts
// 시드 계약에 업무내용·소정근로·임금·근무장소 채우기(데모용). 실제는 계약폼에서 필수 입력됨.
import { prisma } from "../lib/prisma";

const TIMES: Record<string, { s: string; e: string }> = {
  FULL_DAY: { s: "09:00", e: "18:00" },
  AM:       { s: "09:00", e: "14:30" },
  PM:       { s: "13:00", e: "18:00" },
  CUSTOM:   { s: "09:00", e: "18:00" },
};

async function main() {
  const cs = await prisma.employmentContract.findMany({
    select: { id: true, workType: true, siteName: true, workerFilledSiteName: true, jobDescription: true, wageAmount: true },
  });
  let n = 0;
  for (const c of cs) {
    if (c.jobDescription && c.wageAmount) continue; // 이미 채워진 건 건너뜀
    const t = TIMES[(c.workType as string) ?? "FULL_DAY"] ?? TIMES.FULL_DAY;
    await prisma.employmentContract.update({
      where: { id: c.id },
      data: {
        jobDescription: "장애인 직업재활 직무지도 및 현장 적응 지원",
        workStartTime: t.s,
        workEndTime: t.e,
        wageType: "HOURLY",
        wageAmount: 12000,
        workLocation: c.siteName || c.workerFilledSiteName || "근무 현장",
      } as any,
    });
    n++;
  }
  console.log(`계약 약정 항목 채움: ${n}건 (총 ${cs.length})`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
