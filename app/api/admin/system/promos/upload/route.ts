// app/api/admin/system/promos/upload/route.ts
// 운영자: 광고 이미지 업로드 → 공개 버킷(promo-images)에 저장, 공개 URL 반환.
// 대시보드에서 무인증 노출되어야 하므로 public 버킷 사용.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/adminScope";

const BUCKET = "promo-images";
const MAX = 5 * 1024 * 1024; // 5MB
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
  return createClient(url, key);
}

let bucketEnsured = false;
async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>) {
  if (bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !error.message.includes("already exists")) console.warn("[promos/upload] 버킷 생성:", error.message);
  bucketEnsured = true;
}

export async function POST(req: Request) {
  try {
    await requireAdminSession(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, message: "파일이 없습니다." }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ success: false, message: "이미지는 5MB 이하만 가능합니다." }, { status: 400 });
    const ext = EXT[file.type];
    if (!ext) return NextResponse.json({ success: false, message: "JPG·PNG·WEBP·GIF 이미지만 가능합니다." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    await ensureBucket(supabase);
    const path = `promos/${randomUUID()}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: file.type, upsert: false });
    if (error) return NextResponse.json({ success: false, message: `업로드 실패: ${error.message}` }, { status: 500 });
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ success: true, url: data.publicUrl });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    return NextResponse.json({ success: false, message: e?.message || "업로드 실패" }, { status: 500 });
  }
}
