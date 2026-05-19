// app/api/geo/search-address/route.ts
// Kakao Local: 주소 검색(도로명/지번) + 키워드 검색(건물명/기관명 등) 자동 fallback

import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Kakao Local REST API base
const KAKAO_BASE = "https://dapi.kakao.com";

type NormalizedDoc = {
  addressName: string;
  x: string; // longitude
  y: string; // latitude
  roadAddress?: {
    addressName?: string;
    buildingName?: string;
  };
  jibunAddress?: {
    addressName?: string;
    region1DepthName?: string;
    region2DepthName?: string;
    region3DepthName?: string;
  };
  // 필요시 디버깅/구분용
  source?: "address" | "keyword";
};

function getAuthHeader() {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;
  return { Authorization: `KakaoAK ${key}` };
}

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { success: false, message, ...(extra ? extra : {}) },
    { status }
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const sizeRaw = url.searchParams.get("size") || "10";
    const pageRaw = url.searchParams.get("page") || "1";

    const size = Math.min(Math.max(parseInt(sizeRaw, 10) || 10, 1), 30);
    const page = Math.min(Math.max(parseInt(pageRaw, 10) || 1, 1), 45);

    if (!q) return jsonError("q(검색어)가 필요합니다.", 400);

    const auth = getAuthHeader();
    if (!auth) {
      return jsonError(
        "서버 환경변수 KAKAO_REST_API_KEY가 설정되지 않았습니다.",
        500
      );
    }

    // 1) 주소 검색(도로명/지번에 강함)
    const addressUrl = new URL(`${KAKAO_BASE}/v2/local/search/address.json`);
    addressUrl.searchParams.set("query", q);
    addressUrl.searchParams.set("size", String(size));
    addressUrl.searchParams.set("page", String(page));

    const addressRes = await fetch(addressUrl.toString(), {
      method: "GET",
      headers: {
        ...auth,
      },
      cache: "no-store",
    });

    const addressJson = await addressRes.json().catch(() => null);

    if (!addressRes.ok) {
      // Kakao 자체 에러(권한/서비스 활성화 등)
      return jsonError("Kakao API 오류(주소검색)", addressRes.status, {
        kakao: addressJson,
      });
    }

    const addrDocs = Array.isArray(addressJson?.documents)
      ? addressJson.documents
      : [];

    if (addrDocs.length > 0) {
      const documents: NormalizedDoc[] = addrDocs.map((d: any) => ({
        addressName: d?.address_name || "",
        x: d?.x || "",
        y: d?.y || "",
        roadAddress: d?.road_address
          ? {
              addressName: d.road_address?.address_name,
              buildingName: d.road_address?.building_name,
            }
          : undefined,
        jibunAddress: d?.address
          ? {
              addressName: d.address?.address_name,
              region1DepthName: d.address?.region_1depth_name,
              region2DepthName: d.address?.region_2depth_name,
              region3DepthName: d.address?.region_3depth_name,
            }
          : undefined,
        source: "address",
      }));

      return NextResponse.json({
        success: true,
        meta: addressJson?.meta ?? {
          is_end: true,
          pageable_count: documents.length,
          total_count: documents.length,
        },
        documents,
      });
    }

    // 2) 키워드 검색(건물명/기관명/일반 검색어에 강함) - address 검색 결과가 없을 때 fallback
    const keywordUrl = new URL(`${KAKAO_BASE}/v2/local/search/keyword.json`);
    keywordUrl.searchParams.set("query", q);
    keywordUrl.searchParams.set("size", String(size));
    keywordUrl.searchParams.set("page", String(page));

    const keywordRes = await fetch(keywordUrl.toString(), {
      method: "GET",
      headers: {
        ...auth,
      },
      cache: "no-store",
    });

    const keywordJson = await keywordRes.json().catch(() => null);

    if (!keywordRes.ok) {
      return jsonError("Kakao API 오류(키워드검색)", keywordRes.status, {
        kakao: keywordJson,
      });
    }

    const kwDocs = Array.isArray(keywordJson?.documents)
      ? keywordJson.documents
      : [];

    const documents: NormalizedDoc[] = kwDocs.map((d: any) => {
      // keyword search는 place 기반이라 "address" 구조가 다릅니다.
      // 앱/서버의 기존 응답 포맷을 유지하기 위해 최대한 매핑합니다.
      const addressName = d?.road_address_name || d?.address_name || d?.place_name || "";
      return {
        addressName,
        x: d?.x || "",
        y: d?.y || "",
        roadAddress: {
          addressName: d?.road_address_name || undefined,
          buildingName: d?.place_name || undefined,
        },
        jibunAddress: {
          addressName: d?.address_name || undefined,
        },
        source: "keyword",
      };
    });

    return NextResponse.json({
      success: true,
      meta: keywordJson?.meta ?? {
        is_end: true,
        pageable_count: documents.length,
        total_count: documents.length,
      },
      documents,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: "서버 오류", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
