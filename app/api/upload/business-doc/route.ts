// app/api/upload/business-doc/route.ts
// 사업자 서류 업로드 (가입 전 인증 불필요)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/rateLimit";

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

// 버킷 생성은 프로세스당 1회만 시도 (매 요청 네트워크 왕복 방지)
let bucketEnsured = false;

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>) {
  if (bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(BUCKET_NAME, { public: false });
  if (error && !error.message.includes("already exists")) {
    console.warn("[upload/business-doc] 버킷 생성 실패:", error.message);
  }
  bucketEnsured = true;
}

export async function POST(req: NextRequest) {
  try {
    // 미인증 공개 엔드포인트 — IP당 업로드 횟수 제한 (스토리지 남용/DoS 방어)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = await checkRateLimit(`upload-business-doc:${ip}`);
    if (!rl.allowed) {
      const secs = Math.ceil((rl.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { success: false, message: `업로드 요청이 너무 많습니다. ${secs}초 후 다시 시도하세요.` },
        { status: 429 }
      );
    }

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

    // 버킷이 없으면 Private으로 생성 (프로세스당 1회)
    await ensureBucket(supabase);

    const ext = getExtension(file.type);
    const filePath = `manager-signup/${Date.now()}-${randomUUID()}.${ext}`;

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

    // Private 버킷 — DB에는 경로만 저장, 표시 시 signed URL 생성
    return NextResponse.json({ success: true, url: filePath });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[upload/business-doc]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
