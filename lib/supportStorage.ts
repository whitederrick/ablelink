// lib/supportStorage.ts
// 운영자 문의 첨부파일 — 비공개 Supabase 버킷 저장(경로만 DB 보관) + 조회 시 signed URL.
// 계약서 양식(HWP/PDF)·오류 화면 캡쳐 등. (passbook/business-docs 패턴과 동일)

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const BUCKET = "support-attachments";
const SIGNED_URL_EXPIRES_SEC = 600; // 10분
export const SUPPORT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const SUPPORT_MAX_FILES = 5;

// 확장자 화이트리스트(MIME이 비어있는 HWP 등 대응 — 확장자로 검증)
const ALLOWED_EXT = new Set([
  "jpg", "jpeg", "png", "webp", "gif",          // 화면 캡쳐
  "pdf", "hwp", "hwpx", "doc", "docx",          // 문서·계약서 양식
  "xls", "xlsx", "ppt", "pptx", "txt", "zip",
]);

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  pdf: "application/pdf", txt: "text/plain", zip: "application/zip",
  hwp: "application/x-hwp", hwpx: "application/haansofthwp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

let bucketEnsured = false;
async function ensureBucket(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  if (bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
  if (error && !error.message.includes("already exists")) {
    console.warn("[support] 버킷 생성 실패:", error.message);
  }
  bucketEnsured = true;
}

export function extOfName(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export type SupportAttachment = { path: string; name: string; size: number; mime: string };

export type SupportUploadResult =
  | { ok: true; attachment: SupportAttachment }
  | { ok: false; status: number; message: string };

/** 문의 첨부파일 업로드 → 메타데이터(DB 저장용) 반환. */
export async function uploadSupportAttachment(agencyId: string, file: Blob, originalName: string): Promise<SupportUploadResult> {
  if (file.size > SUPPORT_MAX_FILE_SIZE) return { ok: false, status: 400, message: "파일 크기는 10MB 이하여야 합니다." };
  const ext = extOfName(originalName);
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, status: 400, message: "허용되지 않는 형식입니다. (이미지·PDF·한글(HWP)·Office 문서·zip)" };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, status: 500, message: "스토리지가 설정되지 않았습니다." };
  await ensureBucket(supabase);

  const mime = file.type || EXT_MIME[ext] || "application/octet-stream";
  const path = `${agencyId}/${Date.now()}-${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
  if (error) {
    console.error("[support] 업로드 오류:", error.message);
    return { ok: false, status: 500, message: "첨부파일 업로드에 실패했습니다." };
  }
  return { ok: true, attachment: { path, name: originalName.trim().slice(0, 200), size: file.size, mime } };
}

/** 저장 경로 → 조회용 signed URL (없으면 null). 구버전 http URL은 그대로 반환. */
export async function resolveSupportUrl(rawPath: string | null): Promise<string | null> {
  if (!rawPath) return null;
  if (rawPath.startsWith("http")) return rawPath;
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(rawPath, SIGNED_URL_EXPIRES_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** 외부 입력(JSON) → 안전한 SupportAttachment 배열로 정규화. */
export function normalizeAttachments(raw: any): SupportAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: SupportAttachment[] = [];
  for (const it of raw) {
    const path = typeof it?.path === "string" ? it.path.trim() : "";
    if (!path || path.startsWith("http")) continue; // 경로만 허용(외부 URL 주입 방지)
    out.push({
      path,
      name: typeof it?.name === "string" ? it.name.trim().slice(0, 200) : "첨부파일",
      size: Number.isFinite(it?.size) ? Number(it.size) : 0,
      mime: typeof it?.mime === "string" ? it.mime : "application/octet-stream",
    });
    if (out.length >= SUPPORT_MAX_FILES) break;
  }
  return out;
}
