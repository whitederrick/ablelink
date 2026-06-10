// lib/docs/managerSig.ts
// 스냅샷(DocumentVersion.sourceData) 렌더 시 매니저(위탁기관) 서명 주입 유틸.
//
// 배경: 제출 시점의 sourceData.signatures.govAgent / agencyAgent 슬롯은 비어 있고,
//   매니저 서명은 이후 sign 액션에서 DocumentRun.managerSignatureUrl 에만 저장된다.
//   따라서 스냅샷을 그대로 렌더하면 매니저 서명이 빠진다(문서보기·ZIP).
//   이 유틸로 렌더 직전에 run 의 매니저 서명을 payload.signatures 에 합쳐준다.
//   (govAgent=직업지도원/공단요원, agencyAgent=위탁기관요원 — 둘 다 위탁기관 서명으로 채움:
//    docs/preview 의 실시간 로직과 동일한 매핑.)

export const runtime = "nodejs";

const ALLOWED_IMG_HOST = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname; } catch { return ""; }
})();

// 서명 이미지 URL → base64 data URI (호스트 허용목록 + 5s 타임아웃)
export async function toSigDataUri(url?: string | null): Promise<string | undefined> {
  if (!url || !url.startsWith("http")) return url || undefined;
  try {
    const host = new URL(url).hostname;
    if (ALLOWED_IMG_HOST && host !== ALLOWED_IMG_HOST) return undefined;
  } catch { return undefined; }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const mime = res.headers.get("content-type") || "image/png";
    if (!mime.startsWith("image/")) return undefined;
    const buf = await res.arrayBuffer();
    return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch { return undefined; }
}

type ManagerSig = { managerSignatureUrl?: string | null; managerSignerName?: string | null };

/**
 * payload.signatures 의 govAgent / agencyAgent 슬롯에 매니저 서명을 주입한다.
 * - run 에 서명이 없으면 payload 를 그대로 반환(불변).
 * - 이미 서명 이미지가 채워진 슬롯은 덮어쓰지 않는다(스냅샷 우선).
 */
export async function injectManagerSignature<T extends { signatures?: any }>(payload: T, run: ManagerSig): Promise<T> {
  const url = run?.managerSignatureUrl;
  if (!url) return payload;
  const img = await toSigDataUri(url);
  if (!img) return payload;
  const name = run.managerSignerName || "";
  const sigs = { ...(payload.signatures ?? {}) };
  for (const slot of ["govAgent", "agencyAgent"] as const) {
    const cur = sigs[slot];
    if (!cur?.imageUrl) sigs[slot] = { name: cur?.name || name, imageUrl: img };
  }
  return { ...payload, signatures: sigs };
}
