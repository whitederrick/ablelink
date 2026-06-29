// scripts/backfill-attendance-gps.mts
// 시드 근태에 GPS 좌표 채우기 — 지도 뷰 시연용. 현장 좌표 기준 약간의 오차로 출근/퇴근 위치 생성.
// 약 1/7은 허용범위 밖(이탈)으로 만들어 지도에서 🟠로 표시되게 함.
import { prisma } from "../lib/prisma";

async function main() {
  const atts = await prisma.dailyAttendance.findMany({
    where: { startTime: { not: null } },
    select: { id: true, endTime: true, site: { select: { gpsLat: true, gpsLon: true, allowanceRange: true } } },
  });

  let updated = 0, skipped = 0;
  for (const a of atts) {
    if (!a.site?.gpsLat || !a.site?.gpsLon) { skipped++; continue; }
    const baseLat = Number(a.site.gpsLat), baseLon = Number(a.site.gpsLon);
    const range = a.site.allowanceRange ?? 100;
    const out = Number(a.id) % 7 === 0; // ~14% 이탈
    const ang = Math.random() * 2 * Math.PI;
    const dist = out ? range + 100 + Math.random() * 150 : Math.random() * Math.min(range * 0.6, 60);
    const dLat = (dist * Math.cos(ang)) / 111000;
    const dLon = (dist * Math.sin(ang)) / (111000 * Math.cos((baseLat * Math.PI) / 180));
    const sLat = baseLat + dLat, sLon = baseLon + dLon;
    const within = dist <= range;

    await prisma.dailyAttendance.update({
      where: { id: a.id },
      data: {
        startLocLat: sLat, startLocLon: sLon,
        startDistanceM: Math.round(dist),
        withinRange: within, rangeM: range,
        ...(a.endTime ? {
          endLocLat: baseLat + dLat * 0.3, endLocLon: baseLon + dLon * 0.3,
          endDistanceM: Math.round(dist * 0.3),
        } : {}),
      } as any,
    });
    updated++;
  }
  console.log(`GPS 채움 완료 — 갱신 ${updated} · 건너뜀(현장좌표없음) ${skipped} (총 ${atts.length})`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
