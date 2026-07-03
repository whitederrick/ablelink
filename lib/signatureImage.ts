// lib/signatureImage.ts
// 서명 이미지 접근 단일화 — 서명 버킷(signatures)을 private로 전환해도 동작하도록
// service-role로 다운로드/서명URL 생성. 저장값이 구(공개 URL)·신(경로) 어느 포맷이든 처리.
//  · 서버 렌더(PDF): imageToDataUri(stored) → base64 data URI
//  · 클라 표시: signatureDisplayUrl(stored) → 단기 signed URL
//  · 버킷이 아직 public이어도 service-role 다운로드는 동일 동작(무손실 전환 준비).
import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ALLOWED_IMG_HOST = (() => { try { return new URL(SUPABASE_URL).hostname; } catch { return ""; } })();
const SIG_BUCKET = "signatures";

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) _admin = createClient(SUPABASE_URL, SERVICE_KEY);
  return _admin;
}

/** 저장값(구 공개 URL / signed URL / 신 경로)에서 signatures 버킷 내부 객체 경로 추출. 서명 객체가 아니면 null. */
export function signaturePathFromStored(stored?: string | null): string | null {
  if (!stored) return null;
  const pub = `/object/public/${SIG_BUCKET}/`;
  let i = stored.indexOf(pub);
  if (i >= 0) return decodeURIComponent(stored.slice(i + pub.length).split("?")[0]);
  const signed = `/object/sign/${SIG_BUCKET}/`;
  i = stored.indexOf(signed);
  if (i >= 0) return decodeURIComponent(stored.slice(i + signed.length).split("?")[0]);
  // 비-URL(신 포맷 경로)로 간주
  if (!/^https?:\/\//i.test(stored) && !stored.startsWith("data:")) return stored.replace(/^\/+/, "");
  return null; // 서명 버킷과 무관한 http URL
}

/** 이미지(서명) → base64 data URI. 서명 버킷 객체는 service-role 다운로드, 그 외 허용호스트 이미지는 fetch. */
export async function imageToDataUri(url?: string | null): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;

  const sigPath = signaturePathFromStored(url);
  if (sigPath) {
    try {
      const { data, error } = await admin().storage.from(SIG_BUCKET).download(sigPath);
      if (error || !data) return undefined;
      const buf = Buffer.from(await data.arrayBuffer());
      const mime = data.type && data.type.startsWith("image/") ? data.type : "image/png";
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch { return undefined; }
  }

  // 서명 외 http 이미지 — 허용 호스트만(기존 동작 유지)
  if (!url.startsWith("http")) return undefined;
  try {
    const host = new URL(url).hostname;
    if (ALLOWED_IMG_HOST && host !== ALLOWED_IMG_HOST) return undefined;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    const mime = res.headers.get("content-type") || "image/png";
    if (!mime.startsWith("image/")) return undefined;
    return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch { return undefined; }
}

/** 클라이언트 표시용 단기 signed URL. 서명 객체가 아니거나 실패 시 원본 반환(하위호환). */
export async function signatureDisplayUrl(stored?: string | null, expiresSec = 3600): Promise<string | null> {
  if (!stored) return null;
  if (stored.startsWith("data:")) return stored;
  const path = signaturePathFromStored(stored);
  if (!path) return stored;
  try {
    const { data, error } = await admin().storage.from(SIG_BUCKET).createSignedUrl(path, expiresSec);
    if (error || !data?.signedUrl) return stored;
    return data.signedUrl;
  } catch { return stored; }
}
