// scripts/fix-site-coords.mts
// 시드 현장 좌표가 임의값(한강 위)이라, 주소 구(區)에 맞는 실제 육지 좌표로 보정 + 근태 GPS 재생성.
import { prisma } from "../lib/prisma";

// 서울 자치구 대략 중심(육지)
const DISTRICTS: { key: string; lat: number; lon: number }[] = [
  { key: "성동구", lat: 37.5634, lon: 127.0369 },
  { key: "마포구", lat: 37.5563, lon: 126.9230 },
  { key: "노원구", lat: 37.6542, lon: 127.0568 },
  { key: "중구",   lat: 37.5610, lon: 126.9980 },
  { key: "강남구", lat: 37.5172, lon: 127.0473 },
];
const DEFAULT = { lat: 37.5665, lon: 126.9780 }; // 시청

function centerFor(address: string) {
  for (const d of DISTRICTS) if (address.includes(d.key)) return d;
  return DEFAULT;
}

async function main() {
  // 1) 현장 좌표 보정
  const sites = await prisma.site.findMany({ select: { id: true, address: true } });
  let siteFixed = 0;
  const siteCenter = new Map<string, { lat: number; lon: number }>();
  for (const s of sites) {
    const c = centerFor(s.address ?? "");
    // 같은 구 안에서 현장마다 흩어지도록 ~300m 지터(육지 유지)
    const lat = c.lat + (Math.random() - 0.5) * 0.005;
    const lon = c.lon + (Math.random() - 0.5) * 0.006;
    await prisma.site.update({ where: { id: s.id }, data: { gpsLat: lat, gpsLon: lon } as any });
    siteCenter.set(s.id.toString(), { lat, lon });
    siteFixed++;
  }

  // 2) 근태 GPS 재생성(보정된 현장 좌표 기준)
  const atts = await prisma.dailyAttendance.findMany({
    where: { startTime: { not: null } },
    select: { id: true, endTime: true, siteId: true, site: { select: { allowanceRange: true } } },
  });
  let attFixed = 0;
  for (const a of atts) {
    const c = a.siteId ? siteCenter.get(a.siteId.toString()) : null;
    if (!c) continue;
    const range = a.site?.allowanceRange ?? 100;
    const out = Number(a.id) % 7 === 0;
    const ang = Math.random() * 2 * Math.PI;
    const dist = out ? range + 100 + Math.random() * 150 : Math.random() * Math.min(range * 0.6, 60);
    const dLat = (dist * Math.cos(ang)) / 111000;
    const dLon = (dist * Math.sin(ang)) / (111000 * Math.cos((c.lat * Math.PI) / 180));
    await prisma.dailyAttendance.update({
      where: { id: a.id },
      data: {
        startLocLat: c.lat + dLat, startLocLon: c.lon + dLon,
        startDistanceM: Math.round(dist), withinRange: dist <= range, rangeM: range,
        ...(a.endTime ? { endLocLat: c.lat + dLat * 0.3, endLocLon: c.lon + dLon * 0.3, endDistanceM: Math.round(dist * 0.3) } : {}),
      } as any,
    });
    attFixed++;
  }
  console.log(`현장 좌표 보정 ${siteFixed}건 · 근태 GPS 재생성 ${attFixed}건`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
