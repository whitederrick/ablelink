// admlink-admin/app/api/site/_utils.ts 
// Site 저장 전 검증 공통화

import { Prisma } from "@prisma/client";

// 문자열/number/Decimal 모두 받아서 number로 검증
function toNumber(v: unknown): number {
  if (v == null) return NaN;

  // Prisma.Decimal은 toString() 가능
  const s = typeof v === "string" ? v : (typeof v === "number" ? String(v) : String(v));
  const n = Number(s);
  return n;
}

// 저장은 Decimal로 통일
function toDecimal(n: number) {
  return new Prisma.Decimal(n);
}

/**
 * ✅ gpsLat/gpsLon 유효성 검증 + Decimal 변환
 * - null/undefined 방지
 * - NaN 방지
 * - 범위 체크
 */
export function assertValidGps(gpsLatRaw: unknown, gpsLonRaw: unknown) {
  const lat = toNumber(gpsLatRaw);
  const lon = toNumber(gpsLonRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("현장 기준점(GPS)이 설정되지 않았습니다. 현재 위치로 기준점을 확정해주세요.");
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error("GPS 좌표 범위가 올바르지 않습니다.");
  }

  return { gpsLat: toDecimal(lat), gpsLon: toDecimal(lon) };
}

/**
 * ✅ Prisma Decimal을 JSON 응답용 number로 변환
 * (Home API, site 조회 등에서 사용 권장)
 */
export function decimalToNumber(v: any): number | null {
  if (v == null) return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}