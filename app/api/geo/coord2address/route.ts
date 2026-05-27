// admlink-admin/app/api/geo/coord2address/route.ts
// Kakao 좌표 -> 주소 변환 API 연동 (정규화 DTO + 입력값 검증 + no-store + 안정성 개선)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

const KAKAO_ENDPOINT = "https://dapi.kakao.com/v2/local/geo/coord2address.json";

type NormalizedCoord2Address = {
  x: number; // longitude
  y: number; // latitude
  input_coord: string;
  // 대표 주소(도로명 우선)
  addressName: string | null;
  roadAddressName: string | null;
  jibunAddressName: string | null;

  // 참고 정보(있으면)
  buildingName: string | null;
  region1DepthName: string | null;
  region2DepthName: string | null;
  region3DepthName: string | null;

  // 원본도 필요할 수 있어 선택적으로 포함 (디버깅 용)
  raw?: any;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, message, ...(extra ? extra : {}) },
    { status }
  );
}

function parseNumber(v: string | null) {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function inRange(n: number, min: number, max: number) {
  return n >= min && n <= max;
}

export async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = checkRateLimit(`geo-coord:${ip}`);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }

    // [개선] env는 요청 시점에 읽어(환경 반영/디버깅 용이)
    const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
    if (!KAKAO_KEY) {
      return jsonError("KAKAO_REST_API_KEY가 설정되지 않았습니다.", 500);
    }

    const { searchParams } = new URL(request.url);

    const xRaw = searchParams.get("x"); // longitude
    const yRaw = searchParams.get("y"); // latitude
    const inputCoord = (searchParams.get("input_coord") || "WGS84").trim();

    if (!xRaw || !yRaw) {
      return jsonError("x(경도), y(위도)가 필요합니다.", 400);
    }

    // [개선] 숫자/범위 검증
    const x = parseNumber(xRaw);
    const y = parseNumber(yRaw);

    if (x === null || y === null) {
      return jsonError("x(경도), y(위도)는 숫자여야 합니다.", 400, { x: xRaw, y: yRaw });
    }
    if (!inRange(x, -180, 180) || !inRange(y, -90, 90)) {
      return jsonError("좌표 범위가 올바르지 않습니다.", 400, { x, y });
    }

    const url =
      `${KAKAO_ENDPOINT}` +
      `?x=${encodeURIComponent(String(x))}` +
      `&y=${encodeURIComponent(String(y))}` +
      `&input_coord=${encodeURIComponent(inputCoord)}`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
      signal: controller.signal,
      cache: "no-store", // [개선] 캐시 방지(디버깅/일관성)
    }).finally(() => clearTimeout(t));

    const kakao = await res.json().catch(() => null);

    if (!res.ok) {
      return jsonError("Kakao API 오류", res.status, { kakao });
    }

    // Kakao 응답 구조:
    // documents[0].road_address / documents[0].address 를 주로 사용
    const doc = Array.isArray(kakao?.documents) ? kakao.documents[0] : null;
    const road = doc?.road_address || null;
    const jibun = doc?.address || null;

    const roadAddressName: string | null = road?.address_name ?? null;
    const jibunAddressName: string | null = jibun?.address_name ?? null;

    const normalized: NormalizedCoord2Address = {
      x,
      y,
      input_coord: inputCoord,
      addressName: roadAddressName || jibunAddressName || null, // 도로명 우선
      roadAddressName,
      jibunAddressName,

      buildingName: road?.building_name ?? null,
      region1DepthName: jibun?.region_1depth_name ?? null,
      region2DepthName: jibun?.region_2depth_name ?? null,
      region3DepthName: jibun?.region_3depth_name ?? null,
    };

    // 디버깅이 필요하면 raw 포함 가능(기본은 미포함)
    // normalized.raw = kakao;

    return NextResponse.json({ success: true, data: normalized });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      // timeout은 504가 더 의미상 적절
      return jsonError("Kakao API timeout", 504);
    }
    return jsonError("서버 오류", 500);
  }
}
