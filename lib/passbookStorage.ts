// lib/passbookStorage.ts
// 급여 이체용 통장사본 — 비공개 Supabase 버킷 저장(경로만 DB 보관) + 조회 시 signed URL.
// 민감 PII이므로 public 버킷을 쓰지 않는다. (business-docs 패턴과 동일)

import { createClient } from "@supabase/supabase-js";

const BUCKET = "passbooks";
const SIGNED_URL_EXPIRES_SEC = 3600; // 1시간
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

let bucketEnsured = false;
async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>) {
  if (!supabase || bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
  if (error && !error.message.includes("already exists")) {
    console.warn("[passbook] 버킷 생성 실패:", error.message);
  }
  bucketEnsured = true;
}

function extOf(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png":  return "png";
    case "image/webp": return "webp";
    case "application/pdf": return "pdf";
    default: return "bin";
  }
}

export type PassbookUploadResult =
  | { ok: true; path: string }
  | { ok: false; status: number; message: string };

/** 통장사본 파일 업로드 → 저장 경로 반환(DB에 저장할 값). */
export async function uploadPassbook(workerId: string, file: Blob): Promise<PassbookUploadResult> {
  if (file.size > MAX_FILE_SIZE) return { ok: false, status: 400, message: "파일 크기는 10MB 이하여야 합니다." };
  if (!ALLOWED_MIME.includes(file.type)) return { ok: false, status: 400, message: "허용되지 않는 형식입니다. (jpg, png, webp, pdf)" };

  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, status: 500, message: "스토리지가 설정되지 않았습니다." };
  await ensureBucket(supabase);

  const path = `${workerId}/passbook_${Date.now()}.${extOf(file.type)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[passbook] 업로드 오류:", error.message);
    return { ok: false, status: 500, message: "통장사본 업로드에 실패했습니다." };
  }
  return { ok: true, path };
}

/** 저장 경로 → 조회용 signed URL (없으면 null). 구버전 http URL은 그대로 반환. */
export async function resolvePassbookUrl(rawPath: string | null): Promise<string | null> {
  if (!rawPath) return null;
  if (rawPath.startsWith("http")) return rawPath;
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(rawPath, SIGNED_URL_EXPIRES_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
