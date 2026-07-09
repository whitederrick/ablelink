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

import { imageToDataUri } from "@/lib/signatureImage";

type ManagerSig = { managerSignatureUrl?: string | null; managerSignerName?: string | null };
type SigSlot = { name?: string | null; imageUrl?: string | null } | null | undefined;
type SigMap = Record<string, SigSlot>;

/**
 * payload.signatures 의 govAgent / agencyAgent 슬롯에 매니저 서명을 주입한다.
 * - run 에 서명이 없으면 payload 를 그대로 반환(불변).
 * - 이미 서명 이미지가 채워진 슬롯은 덮어쓰지 않는다(스냅샷 우선).
 */
export async function injectManagerSignature<T extends { signatures?: SigMap }>(
  payload: T,
  run: ManagerSig,
  // PERF-8: 요청 스코프 캐시(url→dataUri). 발송/ZIP처럼 여러 run이 같은 매니저 서명을 공유할 때
  //  같은 이미지를 run마다 재다운로드하지 않도록 호출부가 Map 하나를 만들어 넘긴다(선택).
  cache?: Map<string, string | null>,
): Promise<T> {
  const url = run?.managerSignatureUrl;
  if (!url) return payload;
  let img: string | null;
  if (cache?.has(url)) {
    img = cache.get(url) ?? null;
  } else {
    img = (await imageToDataUri(url)) ?? null;
    cache?.set(url, img);
  }
  if (!img) return payload;
  const name = run.managerSignerName || "";
  const sigs: SigMap = { ...(payload.signatures ?? {}) };
  for (const slot of ["govAgent", "agencyAgent"] as const) {
    const cur = sigs[slot];
    if (!cur?.imageUrl) sigs[slot] = { name: cur?.name || name, imageUrl: img };
  }
  return { ...payload, signatures: sigs };
}
