// app/api/upload/business-doc/route.ts
// 사업자 서류 업로드 (가입 전 인증 불필요)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const BUCKET_NAME = "business-docs";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
  return createClient(url, key);
}

function getExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg": return "jpg";
    case "image/png":  return "png";
    case "image/webp": return "webp";
    case "application/pdf": return "pdf";
    default: return "bin";
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { success: false, message: "file 필드가 필요합니다." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, message: "파일 크기는 10MB 이하여야 합니다." },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          message: "허용되지 않는 파일 형식입니다. (jpeg, png, webp, pdf만 허용)",
        },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // 버킷이 없으면 생성 시도 (이미 있으면 무시)
    const { error: bucketError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
    });
    // 이미 존재하는 경우 에러가 발생하지만 무시
    if (bucketError && !bucketError.message.includes("already exists")) {
      console.warn("[upload/business-doc] 버킷 생성 실패:", bucketError.message);
    }

    const ext = getExtension(file.type);
    const timestamp = Date.now();
    const randomHex = Math.random().toString(16).slice(2, 10);
    const filePath = `manager-signup/${timestamp}-${randomHex}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[upload/business-doc] 업로드 오류:", uploadError);
      return NextResponse.json(
        { success: false, message: "파일 업로드에 실패했습니다." },
        { status: 500 }
      );
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    // public URL이 없는 경우 signed URL 대신 경로만 반환
    const url = urlData?.publicUrl ?? filePath;

    return NextResponse.json({ success: true, url });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[upload/business-doc]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
